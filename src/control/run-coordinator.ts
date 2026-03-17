import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  ApprovalDecision,
  ArtifactRecord,
  InvocationPlan,
  MessageThreadRecord,
  RunEvent,
  RunGraph,
  RunInspection,
  RunRecord,
  RunRequest,
  SessionMessageRecord,
  TaskSpec,
  TaskSessionRecord,
  ValidationResult,
} from "../domain/models.js";
import {
  SCHEMA_VERSION,
  assertRunStatusTransition,
} from "../domain/models.js";
import type {
  AgentConfig,
  AgentProfileConfig,
  MultiAgentConfig,
} from "../domain/config.js";
import { createDefaultConfig } from "../config/default-config.js";
import { buildRunConfigForSelectedCli } from "../config/run-cli-config.js";
import { ConfiguredCliAdapter } from "../adapters/configured-cli-adapter.js";
import {
  DefaultContextAssembler,
  type ContextAssembler,
} from "../decision/context-assembler.js";
import { DefaultValidator, type Validator } from "../decision/validator.js";
import type { Planner } from "../decision/planner.js";
import {
  RuleBasedRouter,
  type Router,
} from "../decision/router.js";
import type { AdapterRegistry } from "../execution/adapter-registry.js";
import { createAdapterRegistry } from "../execution/create-adapter-registry.js";
import {
  FileApprovalManager,
  type ApprovalManager,
} from "../execution/approval-manager.js";
import {
  ProcessExecutionRuntime,
  type ExecutionRuntime,
} from "../execution/execution-runtime.js";
import { SafetyManager } from "../execution/safety-manager.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import { FileArtifactStore } from "../storage/artifact-store.js";
import type { BlackboardStore } from "../storage/blackboard-store.js";
import { FileBlackboardStore } from "../storage/blackboard-store.js";
import type { EventStore } from "../storage/event-store.js";
import type { ProjectMemoryStore } from "../storage/project-memory-store.js";
import type { RunStore } from "../storage/run-store.js";
import type { SessionStore } from "../storage/session-store.js";
import type { WorkspaceStateStore } from "../storage/workspace-state-store.js";
import { FileWorkspaceStateStore } from "../storage/workspace-state-store.js";
import { createId, isoNow, pathExists, resolvePath } from "../shared/runtime.js";
import { SELECTED_CLI_VALUES, type SelectedCli } from "../ui-api/selected-cli.js";
import { GraphManager } from "./graph-manager.js";
import { InspectionAggregator } from "./inspection-aggregator.js";
import { MemoryConsolidator } from "./memory-consolidator.js";
import { Scheduler } from "./scheduler.js";

export interface RunCoordinatorDependencies {
  planner: Planner;
  graphManager: GraphManager;
  runStore: RunStore;
  eventStore: EventStore;
  sessionStore: SessionStore;
  projectMemoryStore: ProjectMemoryStore;
  router?: Router;
  contextAssembler?: ContextAssembler;
  validator?: Validator;
  executionRuntime?: ExecutionRuntime;
  adapterRegistry?: AdapterRegistry;
  scheduler?: Scheduler;
  blackboardStore?: BlackboardStore;
  artifactStore?: ArtifactStore;
  workspaceStateStore?: WorkspaceStateStore;
  approvalManager?: ApprovalManager;
  safetyManager?: SafetyManager;
}

interface ExecutionServices {
  router: Router;
  contextAssembler: ContextAssembler;
  validator: Validator;
  executionRuntime: ExecutionRuntime;
  adapterRegistry: AdapterRegistry;
  scheduler: Scheduler;
  approvalManager: ApprovalManager;
  safetyManager: SafetyManager;
  blackboardStore: BlackboardStore;
  artifactStore: ArtifactStore;
  workspaceStateStore: WorkspaceStateStore;
}

interface TaskProcessingResult {
  graph: RunGraph;
  run: RunRecord;
  halted: boolean;
}

export interface PostThreadMessageInput {
  actorId: string;
  body: string;
  clientRequestId?: string;
  note?: string;
  replyToMessageId?: string;
}

export interface PostThreadMessageResult {
  run: RunRecord;
  thread: MessageThreadRecord;
  message: SessionMessageRecord;
  resumed: boolean;
}

interface DelegatedTaskTemplate {
  title?: unknown;
  goal?: unknown;
  instructions?: unknown;
  requiredCapabilities?: unknown;
  preferredAgent?: unknown;
  expectedArtifacts?: unknown;
  acceptanceCriteria?: unknown;
  riskLevel?: unknown;
  timeoutMs?: unknown;
  dependsOn?: unknown;
}

interface ManagerCoordinationOutput {
  delegatedTasks: DelegatedTaskTemplate[];
  managerReply?: string;
  managerDecision?: "continue" | "no_more_tasks";
}

interface DelegatedTaskDraft {
  template: DelegatedTaskTemplate;
  index: number;
  taskId: string;
  title: string;
}

type FileManifest = Map<string, { size: number; mtimeMs: number }>;
const DEFAULT_SELECTED_CLI: SelectedCli = "codex";
const DEFAULT_TASK_TIMEOUT_MS = 120_000;
const DEFAULT_DELEGATED_TASK_TIMEOUT_MS = 900_000;
const MAX_DELEGATED_TASKS = 12;
const MAX_MANAGER_COORDINATION_TASKS = 6;
const MANAGER_PRIMARY_SESSION_ID = "manager_primary";
const MANAGER_PRIMARY_THREAD_ID = "manager_primary";

export class RunCoordinator {
  constructor(private readonly dependencies: RunCoordinatorDependencies) {}

  async startRun(request: RunRequest): Promise<RunRecord> {
    const runId = createId("run");
    const timestamp = isoNow();
    const run: RunRecord = {
      schemaVersion: SCHEMA_VERSION,
      runId,
      goal: request.goal,
      status: "planning",
      workspacePath: request.workspacePath,
      configPath: request.configPath,
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: request.metadata ?? {},
    };
    const blackboardStore = this.resolveBlackboardStore(request.workspacePath);

    await this.dependencies.runStore.createRun(run);
    await this.appendProjectedEvent(
      this.createEvent("run_started", runId, {
        goal: request.goal,
        workspacePath: request.workspacePath,
      }),
      blackboardStore,
    );

    const memories = await this.dependencies.projectMemoryStore.recall({
      text: request.goal,
      scope: "project",
    });

    await this.appendProjectedEvent(
      this.createEvent("memory_recalled", runId, {
        count: memories.length,
      }),
      blackboardStore,
    );

    const plannerMode = resolvePlannerMode(request.metadata);
    const delegatedBootstrapEnabled =
      plannerMode === "delegated" && shouldUseDelegatedBootstrap(request.metadata);
    const tasks =
      delegatedBootstrapEnabled
        ? this.buildDelegatedBootstrapTasks(request)
        : await this.dependencies.planner.createInitialPlan({
            goal: request.goal,
            workspacePath: request.workspacePath,
            recalledMemories: memories,
            validationResults: [],
          });

    for (const task of tasks) {
      await this.appendProjectedEvent(
        this.createEvent("task_planned", runId, {
          taskId: task.id,
          title: task.title,
        }),
        blackboardStore,
      );
    }

    const graph = this.dependencies.graphManager.createGraph(runId, tasks);
    await this.dependencies.runStore.saveGraph(runId, graph);
    if (delegatedBootstrapEnabled) {
      await this.ensureDelegatedManagerSession(run, graph);
    }

    const nextRun: RunRecord = {
      ...run,
      status: "ready",
      updatedAt: isoNow(),
    };
    assertRunStatusTransition(run.status, nextRun.status);

    await this.dependencies.runStore.updateRun(nextRun);
    return nextRun;
  }

  async resumeRun(
    runId: string,
    options: { config?: MultiAgentConfig } = {},
  ): Promise<RunRecord> {
    const run = await this.dependencies.runStore.getRun(runId);
    const graph = await this.dependencies.runStore.getGraph(runId);

    if (!run || !graph) {
      throw new Error(`Run "${runId}" was not found.`);
    }

    if (
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "cancelled"
    ) {
      return run;
    }

    if (shouldUseDelegatedBootstrap(run.metadata)) {
      await this.ensureDelegatedManagerSession(run, graph);
    }

    const resolvedConfig = this.resolveRunExecutionConfig(run, options.config);
    const services = this.resolveExecutionServices(run, resolvedConfig);
    const drift = await services.workspaceStateStore.detectDrift(runId);

    if (drift.hasDrift) {
      await this.appendProjectedEvent(
        this.createEvent("workspace_drift_detected", runId, {
          severity: drift.severity,
          changedFiles: drift.changedFiles,
          unexpectedChanges: drift.unexpectedChanges,
          missingArtifacts: drift.missingArtifacts,
          branchChanged: drift.branchChanged,
          headChanged: drift.headChanged,
          reasons: drift.reasons,
        }),
        services.blackboardStore,
      );
      return this.updateRunRecord(run, "paused");
    }

    const recovered = await this.recoverGraphForResume(run, services);
    if (recovered.waitingApprovalTaskId) {
      return this.updateRunRecord(run, "waiting_approval", recovered.waitingApprovalTaskId);
    }

    const resumableRun =
      run.status === "paused" || run.status === "waiting_approval"
        ? await this.updateRunRecord(run, "ready")
        : run;

    return this.executeReadyTasks(resumableRun, recovered.graph, resolvedConfig);
  }

  async inspectRun(runId: string): Promise<RunInspection> {
    const run = await this.dependencies.runStore.getRun(runId);
    const graph = await this.dependencies.runStore.getGraph(runId);

    if (!run || !graph) {
      throw new Error(`Run "${runId}" is incomplete or missing.`);
    }

    const events = await this.dependencies.eventStore.list(runId);
    const services = this.resolveExecutionServices(
      run,
      createDefaultConfig(run.workspacePath),
    );
    const aggregator = new InspectionAggregator({
      artifactStore: services.artifactStore,
      blackboardStore: services.blackboardStore,
      approvalManager: services.approvalManager,
    });

    return aggregator.build(run, graph, events);
  }

  async listPendingApprovals(runId: string) {
    const run = await this.dependencies.runStore.getRun(runId);
    if (!run) {
      throw new Error(`Run "${runId}" was not found.`);
    }

    const services = this.resolveExecutionServices(
      run,
      createDefaultConfig(run.workspacePath),
    );
    return services.approvalManager.listPending(runId);
  }

  async decideApproval(
    runId: string,
    requestId: string,
    decision: ApprovalDecision,
    actor: string,
    note?: string,
    options: { config?: MultiAgentConfig } = {},
  ): Promise<RunRecord> {
    const run = await this.dependencies.runStore.getRun(runId);
    const graph = await this.dependencies.runStore.getGraph(runId);

    if (!run || !graph) {
      throw new Error(`Run "${runId}" was not found.`);
    }

    const resolvedConfig = this.resolveRunExecutionConfig(run, options.config);
    const services = this.resolveExecutionServices(run, resolvedConfig);
    const request = (await services.approvalManager.listPending(runId)).find(
      (candidate) => candidate.id === requestId,
    );
    if (!request) {
      throw new Error(`Pending approval request "${requestId}" was not found for run "${runId}".`);
    }

    const decisionRecord = await services.approvalManager.decide(
      requestId,
      decision,
      actor,
      note,
    );
    await this.appendProjectedEvent(
      this.createEvent("approval_decided", runId, {
        taskId: request.taskId,
        requestId,
        decision,
        actor,
        ...(note ? { note } : {}),
      }),
      services.blackboardStore,
    );
    await this.recordArtifact(
      runId,
      request.taskId,
      "approval_record",
      services,
      `artifact://run/${runId}/task/${request.taskId}/approval/${requestId}/decision`,
      `Approval ${decision} for request ${requestId}.`,
      {
        requestId,
        decision,
        actor,
        ...(note ? { note } : {}),
        decisionRecord,
      },
    );

    if (decision === "rejected") {
      await this.dependencies.runStore.updateTaskStatus(runId, request.taskId, {
        status: "blocked",
        finishedAt: isoNow(),
      });
      await this.appendProjectedEvent(
        this.createEvent("task_blocked", runId, {
          taskId: request.taskId,
          requestId,
          reasons: [
            `Approval request \"${requestId}\" was rejected by ${actor}.`,
            ...(note ? [note] : []),
          ],
        }),
        services.blackboardStore,
      );
      return this.finalizeRun(
        run,
        "failed",
        {
          ...graph,
          failedTaskIds: [...new Set([...graph.failedTaskIds, request.taskId])],
        },
        services,
      );
    }

    const resumedRun =
      run.status === "waiting_approval"
        ? await this.updateRunRecord(run, "running", request.taskId)
        : run;
    const resumedTask = graph.tasks[request.taskId];
    if (!resumedTask) {
      throw new Error(`Task "${request.taskId}" referenced by approval "${requestId}" was not found.`);
    }

    const outcome = await this.processTask(
      resumedRun,
      graph,
      resumedTask,
      resolvedConfig,
      services,
      { bypassApproval: true },
    );

    return this.executeReadyTasks(outcome.run, outcome.graph, resolvedConfig);
  }

  async postThreadMessage(
    runId: string,
    threadId: string,
    input: PostThreadMessageInput,
  ): Promise<PostThreadMessageResult> {
    const run = await this.dependencies.runStore.getRun(runId);
    const graph = await this.dependencies.runStore.getGraph(runId);
    if (!run || !graph) {
      throw new Error(`Run "${runId}" was not found.`);
    }
    if (isTerminalRunStatus(run.status)) {
      throw new Error(`Run "${runId}" is ${run.status} and cannot accept new messages.`);
    }

    const thread = await this.dependencies.sessionStore.getThread(runId, threadId);
    if (!thread) {
      throw new Error(`Thread "${threadId}" was not found in run "${runId}".`);
    }

    const session =
      typeof thread.sessionId === "string" && thread.sessionId.length > 0
        ? await this.dependencies.sessionStore.getSession(runId, thread.sessionId)
        : null;
    const runConfig = this.resolveRunExecutionConfig(run, createDefaultConfig(run.workspacePath));
    const services = this.resolveExecutionServices(run, runConfig);
    const message = await this.appendThreadMessageWithAudit(
      run,
      services,
      {
        runId,
        threadId,
        role: this.resolveIncomingMessageRole(run, session, input.actorId),
        body: input.body.trim(),
        actorId: input.actorId.trim() || "console-user",
        ...(session ? { sessionId: session.sessionId } : {}),
        ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
        metadata: {
          source: "thread_api",
          ...(input.note ? { note: input.note } : {}),
        },
      },
      session?.taskId,
    );

    let latestRun = (await this.dependencies.runStore.getRun(runId)) ?? run;
    let latestGraph = (await this.dependencies.runStore.getGraph(runId)) ?? graph;
    let resumed = false;

    if (thread.scope === "manager_primary" && shouldUseDelegatedBootstrap(run.metadata)) {
      latestGraph = await this.enqueueManagerCoordinationTask(
        latestRun,
        latestGraph,
        message,
        services,
      );
      latestRun = (await this.dependencies.runStore.getRun(runId)) ?? latestRun;
      if (isAutoResumableRunStatus(latestRun.status)) {
        try {
          latestRun = await this.resumeRun(runId, { config: runConfig });
          resumed = true;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await this.appendThreadMessageWithAudit(
            latestRun,
            services,
            {
              runId,
              threadId,
              role: "system",
              body: `Auto resume attempted but failed: ${errorMessage}`,
              actorId: "system",
              sessionId: session?.sessionId,
              clientRequestId: `resume-failed:${createId("request")}`,
              metadata: {
                source: "auto_resume",
                error: errorMessage,
              },
            },
            session?.taskId,
          );
          latestRun = (await this.dependencies.runStore.getRun(runId)) ?? latestRun;
        }
      }
    }

    return {
      run: latestRun,
      thread,
      message,
      resumed,
    };
  }

  async interactSession(
    runId: string,
    sessionId: string,
    input: PostThreadMessageInput,
  ): Promise<PostThreadMessageResult> {
    const session = await this.dependencies.sessionStore.getSession(runId, sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" was not found in run "${runId}".`);
    }
    return this.postThreadMessage(runId, session.threadId, input);
  }

  async ensureManagerSession(
    runId: string,
  ): Promise<{ session: TaskSessionRecord; thread: MessageThreadRecord }> {
    const run = await this.dependencies.runStore.getRun(runId);
    const graph = await this.dependencies.runStore.getGraph(runId);
    if (!run || !graph) {
      throw new Error(`Run "${runId}" was not found.`);
    }
    return this.ensureDelegatedManagerSession(run, graph);
  }

  private async ensureDelegatedManagerSession(
    run: RunRecord,
    graph: RunGraph,
  ): Promise<{ session: TaskSessionRecord; thread: MessageThreadRecord }> {
    const managerAgentId =
      readNonEmptyString(run.metadata.plannerAgentId) ??
      Object.values(graph.tasks).find((task) => isDelegationManagerTask(task))?.preferredAgent ??
      "manager";
    const now = isoNow();
    const thread: MessageThreadRecord = {
      schemaVersion: SCHEMA_VERSION,
      threadId: MANAGER_PRIMARY_THREAD_ID,
      runId: run.runId,
      scope: "manager_primary",
      sessionId: MANAGER_PRIMARY_SESSION_ID,
      createdAt: now,
      updatedAt: now,
      metadata: {
        owner: "manager",
      },
    };
    const session: TaskSessionRecord = {
      schemaVersion: SCHEMA_VERSION,
      sessionId: MANAGER_PRIMARY_SESSION_ID,
      runId: run.runId,
      scope: "manager_primary",
      role: "manager",
      threadId: MANAGER_PRIMARY_THREAD_ID,
      agentId: managerAgentId,
      createdAt: now,
      updatedAt: now,
      metadata: {
        owner: "manager",
      },
    };

    const persistedThread = await this.dependencies.sessionStore.upsertThread(thread);
    const persistedSession = await this.dependencies.sessionStore.upsertSession(session);
    return {
      session: persistedSession,
      thread: persistedThread,
    };
  }

  private resolveIncomingMessageRole(
    run: RunRecord,
    session: TaskSessionRecord | null,
    actorId: string,
  ): SessionMessageRecord["role"] {
    const normalizedActor = actorId.trim().toLowerCase();
    if (normalizedActor === "system") {
      return "system";
    }
    if (
      normalizedActor === "manager" ||
      readNonEmptyString(run.metadata.plannerAgentId) === actorId ||
      (session?.role === "manager" && session.agentId === actorId)
    ) {
      return "manager";
    }
    if (
      normalizedActor.startsWith("worker") ||
      normalizedActor.includes("-worker") ||
      session?.role === "worker"
    ) {
      return "worker";
    }
    return "user";
  }

  private async appendThreadMessageWithAudit(
    run: RunRecord,
    services: ExecutionServices,
    input: {
      runId: string;
      threadId: string;
      role: SessionMessageRecord["role"];
      body: string;
      actorId: string;
      sessionId?: string;
      replyToMessageId?: string;
      clientRequestId?: string;
      metadata?: Record<string, unknown>;
    },
    taskId?: string,
  ): Promise<SessionMessageRecord> {
    const trimmedBody = input.body.trim();
    if (!trimmedBody) {
      throw new Error("Message body cannot be empty.");
    }

    const message = await this.dependencies.sessionStore.appendMessage({
      ...input,
      body: trimmedBody,
    });
    await this.appendProjectedEvent(
      this.createEvent("agent_message", run.runId, {
        ...(taskId ? { taskId } : {}),
        agentId: input.actorId,
        message: trimmedBody,
        stream: input.role === "system" ? "stderr" : "stdout",
        threadId: input.threadId,
        sessionId: input.sessionId,
        messageId: message.messageId,
        role: input.role,
      }),
      services.blackboardStore,
    );
    return message;
  }

  private async enqueueManagerCoordinationTask(
    run: RunRecord,
    graph: RunGraph,
    triggerMessage: SessionMessageRecord,
    services: ExecutionServices,
  ): Promise<RunGraph> {
    if (!shouldUseDelegatedBootstrap(run.metadata)) {
      return graph;
    }
    const coordinationTaskCount = Object.values(graph.tasks).filter((task) =>
      isManagerCoordinationTask(task),
    ).length;
    if (coordinationTaskCount >= MAX_MANAGER_COORDINATION_TASKS) {
      return graph;
    }
    if (hasActiveDelegationManagerTask(graph)) {
      return graph;
    }

    const existingManager = await this.ensureDelegatedManagerSession(run, graph);
    const recentMessages = await this.dependencies.sessionStore.listMessages(
      run.runId,
      existingManager.thread.threadId,
    );
    const managerTask = this.buildManagerCoordinationTask(
      run,
      graph,
      triggerMessage,
      recentMessages,
    );
    const patch = {
      operation: "append_tasks" as const,
      reason: `Manager coordination triggered by message "${triggerMessage.messageId}".`,
      tasks: [managerTask],
    };
    const patchedGraph = this.dependencies.graphManager.applyPatch(graph, patch);
    await this.dependencies.runStore.saveGraph(run.runId, patchedGraph);
    await this.appendProjectedEvent(
      this.createEvent("replan_applied", run.runId, {
        operation: patch.operation,
        reason: patch.reason,
        appendedTaskIds: [managerTask.id],
        targetTaskIds: [],
      }),
      services.blackboardStore,
    );
    await this.appendProjectedEvent(
      this.createEvent("task_planned", run.runId, {
        taskId: managerTask.id,
        title: managerTask.title,
        delegatedBy: "manager_coordination",
      }),
      services.blackboardStore,
    );

    return (await this.dependencies.runStore.getGraph(run.runId)) ?? patchedGraph;
  }

  private buildManagerCoordinationTask(
    run: RunRecord,
    graph: RunGraph,
    triggerMessage: SessionMessageRecord,
    recentMessages: SessionMessageRecord[],
  ): TaskSpec {
    const managerAgentId = readNonEmptyString(run.metadata.plannerAgentId);
    const workerAgentIds = readStringArray(run.metadata.agentIds).filter(
      (agentId) => agentId !== managerAgentId,
    );
    const recentContext = recentMessages
      .slice(-6)
      .map((message) => {
        const compactBody = message.body.replace(/\s+/g, " ").trim();
        return `[${message.role}] ${message.actorId}: ${compactBody.slice(0, 320)}`;
      })
      .join("\n");

    return {
      id: createId("task"),
      title: "Manager coordination",
      kind: "plan",
      goal: buildDelegationManagerGoal(run.goal, workerAgentIds),
      instructions: [
        "Review the latest manager thread conversation and coordinate follow-up work.",
        "Return JSON only with managerReply, managerDecision, and delegatedTasks.",
        "Use dependsOn when a delegated worker task must wait for another delegated task.",
        "Use managerDecision=no_more_tasks when no further worker delegation is needed.",
      ],
      inputs: [
        `Trigger message ${triggerMessage.messageId} from ${triggerMessage.actorId}: ${triggerMessage.body}`,
        `Recent manager thread context:\n${recentContext || "(no prior messages)"}`,
      ],
      dependsOn: [],
      requiredCapabilities: ["planning", "delegation"],
      ...(managerAgentId ? { preferredAgent: managerAgentId } : {}),
      workingDirectory: run.workspacePath,
      expectedArtifacts: ["Structured manager decision output with delegatedTasks."],
      acceptanceCriteria: [
        "managerDecision is explicit (continue or no_more_tasks).",
        "managerReply summarizes what was decided.",
      ],
      validator: { mode: "none" },
      riskLevel: "low",
      allowedActions: [],
      timeoutMs: DEFAULT_DELEGATED_TASK_TIMEOUT_MS,
      retryPolicy: {
        maxAttempts: 1,
        backoffMs: 0,
        retryOn: [],
      },
      status: "pending",
    };
  }

  private async reportWorkerCompletionToManager(
    run: RunRecord,
    graph: RunGraph,
    task: TaskSpec,
    services: ExecutionServices,
  ): Promise<RunGraph> {
    if (!shouldUseDelegatedBootstrap(run.metadata)) {
      return graph;
    }

    const { session } = await this.ensureDelegatedManagerSession(run, graph);
    const workerActor = task.assignedAgent ?? task.preferredAgent ?? "worker";
    const completionMessage = await this.appendThreadMessageWithAudit(
      run,
      services,
      {
        runId: run.runId,
        threadId: session.threadId,
        sessionId: session.sessionId,
        role: "worker",
        actorId: workerActor,
        body: `Task "${task.title}" is completed. Please review and decide whether there is a next task.`,
        clientRequestId: `worker-complete:${task.id}:${isoNow()}`,
        metadata: {
          source: "worker_completion",
          taskId: task.id,
        },
      },
      task.id,
    );
    return this.enqueueManagerCoordinationTask(run, graph, completionMessage, services);
  }

  private async executeReadyTasks(
    run: RunRecord,
    graph: RunGraph,
    config: MultiAgentConfig | undefined,
  ): Promise<RunRecord> {
    const resolvedConfig = this.resolveRunExecutionConfig(run, config);
    const services = this.resolveExecutionServices(run, resolvedConfig);

    let currentRun = run;
    let currentGraph = graph;

    if (currentRun.status !== "running") {
      currentRun = await this.updateRunRecord(currentRun, "running");
    }

    while (true) {
      const task = services.scheduler.pickNext(currentGraph);
      if (!task) {
        const terminalStatus =
          currentGraph.failedTaskIds.length > 0 ? "failed" : "completed";
        return this.finalizeRun(currentRun, terminalStatus, currentGraph, services);
      }

      currentRun = await this.updateRunRecord(currentRun, "running", task.id);
      let outcome: TaskProcessingResult;
      try {
        outcome = await this.processTask(
          currentRun,
          currentGraph,
          task,
          resolvedConfig,
          services,
        );
      } catch (error) {
        return this.handleTaskProcessingFailure(
          currentRun,
          currentGraph,
          task,
          error,
          services,
        );
      }
      currentRun = outcome.run;
      currentGraph = outcome.graph;

      if (outcome.halted) {
        return currentRun;
      }
    }
  }

  private async handleTaskProcessingFailure(
    run: RunRecord,
    graph: RunGraph,
    task: TaskSpec,
    error: unknown,
    services: ExecutionServices,
  ): Promise<RunRecord> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
      status: "failed_terminal",
      finishedAt: isoNow(),
    });
    await this.appendProjectedEvent(
      this.createEvent("task_failed", run.runId, {
        taskId: task.id,
        error: errorMessage,
        source: "coordinator",
      }),
      services.blackboardStore,
    );

    if (shouldUseDelegatedBootstrap(run.metadata)) {
      try {
        const latestGraph = (await this.dependencies.runStore.getGraph(run.runId)) ?? graph;
        const { session } = await this.ensureDelegatedManagerSession(run, latestGraph);
        await this.appendThreadMessageWithAudit(
          run,
          services,
          {
            runId: run.runId,
            threadId: session.threadId,
            sessionId: session.sessionId,
            role: "system",
            actorId: "system",
            body: `Task "${task.title}" failed before completion: ${errorMessage}`,
            clientRequestId: `task-failed:${task.id}:${isoNow()}`,
            metadata: {
              source: "coordinator_error",
              taskId: task.id,
            },
          },
          task.id,
        );
      } catch {
        // Best effort notification for manager timeline.
      }
    }

    const latestGraph = (await this.dependencies.runStore.getGraph(run.runId)) ?? graph;
    return this.finalizeRun(run, "failed", latestGraph, services);
  }

  private resolveExecutionServices(
    run: RunRecord,
    config: MultiAgentConfig,
  ): ExecutionServices {
    const stateRootDir = resolvePath(".multi-agent/state", run.workspacePath);
    const adapterRegistry =
      this.dependencies.adapterRegistry ?? createAdapterRegistry(config);
    const blackboardStore =
      this.dependencies.blackboardStore ?? new FileBlackboardStore(stateRootDir);
    const artifactStore =
      this.dependencies.artifactStore ?? new FileArtifactStore(stateRootDir);
    const workspaceStateStore =
      this.dependencies.workspaceStateStore ??
      new FileWorkspaceStateStore({
        stateRootDir,
        workspaceRootDir: run.workspacePath,
      });

    return {
      adapterRegistry,
      router:
        this.dependencies.router ??
        new RuleBasedRouter({
          adapterRegistry,
          agents: config.agents,
          routing: config.routing,
        }),
      contextAssembler:
        this.dependencies.contextAssembler ??
        new DefaultContextAssembler({
          blackboardStore,
          artifactStore,
          projectMemoryStore: this.dependencies.projectMemoryStore,
          workspaceStateStore,
        }),
      validator:
        this.dependencies.validator ??
        new DefaultValidator({
          defaultTimeoutMs: config.validation.defaultTimeoutMs,
        }),
      executionRuntime:
        this.dependencies.executionRuntime ??
        new ProcessExecutionRuntime({
          eventStore: this.dependencies.eventStore,
          stateRootDir,
        }),
      scheduler: this.dependencies.scheduler ?? new Scheduler(),
      approvalManager:
        this.dependencies.approvalManager ?? new FileApprovalManager(stateRootDir),
      safetyManager:
        this.dependencies.safetyManager ??
        new SafetyManager({
          approvalThreshold: config.safety.approvalThreshold,
          blockedActions: config.safety.blockedActions,
          approvalPolicyByAction: config.safety.approvalPolicyByAction,
        }),
      blackboardStore,
      artifactStore,
      workspaceStateStore,
    };
  }

  private async processTask(
    run: RunRecord,
    graph: RunGraph,
    task: TaskSpec,
    runConfig: MultiAgentConfig,
    services: ExecutionServices,
    options: { bypassApproval?: boolean } = {},
  ): Promise<TaskProcessingResult> {
    const { graph: plannedGraph, invocation } = await this.planTaskInvocation(
      run,
      graph,
      task,
      services,
      { trackTransitions: !options.bypassApproval },
    );
    const currentTask = plannedGraph.tasks[task.id] ?? task;
    const review = services.safetyManager.review(currentTask, invocation);

    if (review.blocked) {
      const reasons = review.actions
        .filter((action) => action.blocked)
        .flatMap((action) => action.reasons);
      await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
        status: "blocked",
        finishedAt: isoNow(),
      });
      await this.appendProjectedEvent(
        this.createEvent("task_blocked", run.runId, {
          taskId: task.id,
          reasons,
          actionKinds: review.actions.filter((action) => action.blocked).map((action) => action.action.kind),
        }),
        services.blackboardStore,
      );
      return {
        graph: (await this.dependencies.runStore.getGraph(run.runId)) ?? plannedGraph,
        run,
        halted: false,
      };
    }

    if (review.requiresApproval && !options.bypassApproval) {
      const approvalActions = review.actions
        .filter((action) => action.requiresApproval)
        .map((action) => action.action);
      const request = await services.approvalManager.createRequest(
        run.runId,
        task.id,
        approvalActions,
        summarizeApprovalReason(approvalActions),
        invocation,
      );
      await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, "awaiting_approval");
      await this.appendProjectedEvent(
        this.createEvent("approval_requested", run.runId, {
          taskId: task.id,
          requestId: request.id,
          reason: request.reason,
          actionKinds: approvalActions.map((action) => action.kind),
          actionCount: approvalActions.length,
        }),
        services.blackboardStore,
      );
      await this.recordArtifact(
        run.runId,
        task.id,
        "approval_record",
        services,
        `artifact://run/${run.runId}/task/${task.id}/approval/${request.id}/request`,
        `Approval requested for ${approvalActions.length} action(s).`,
        {
          requestId: request.id,
          reason: request.reason,
          actionPlans: approvalActions,
          invocation,
        },
      );
      return {
        graph: (await this.dependencies.runStore.getGraph(run.runId)) ?? plannedGraph,
        run: await this.updateRunRecord(run, "waiting_approval", task.id),
        halted: true,
      };
    }

    return {
      graph: await this.executeInvocation(
        run,
        plannedGraph,
        currentTask,
        invocation,
        runConfig,
        services,
      ),
      run,
      halted: false,
    };
  }

  private async planTaskInvocation(
    run: RunRecord,
    graph: RunGraph,
    task: TaskSpec,
    services: ExecutionServices,
    options: { trackTransitions: boolean },
  ): Promise<{ graph: RunGraph; invocation: InvocationPlan }> {
    let currentGraph = graph;

    if (options.trackTransitions) {
      await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, "routing");
      currentGraph = (await this.dependencies.runStore.getGraph(run.runId)) ?? graph;
    }

    const selection = await services.router.selectAgent(currentGraph.tasks[task.id] ?? task);
    currentGraph.tasks[task.id] = {
      ...currentGraph.tasks[task.id],
      assignedAgent: selection.agentId,
    };
    await this.dependencies.runStore.saveGraph(run.runId, currentGraph);
    await this.appendProjectedEvent(
      this.createEvent("agent_selected", run.runId, {
        taskId: task.id,
        agentId: selection.agentId,
        profileId: selection.profileId,
        reason: selection.reason,
      }),
      services.blackboardStore,
    );

    if (options.trackTransitions) {
      await this.dependencies.runStore.updateTaskStatus(
        run.runId,
        task.id,
        "context_building",
      );
      currentGraph = (await this.dependencies.runStore.getGraph(run.runId)) ?? currentGraph;
    }

    const context = await services.contextAssembler.buildContext({
      task: currentGraph.tasks[task.id] ?? task,
      selection,
      graph: currentGraph,
    });
    await this.appendProjectedEvent(
      this.createEvent("context_built", run.runId, {
        taskId: task.id,
        agentId: selection.agentId,
        profileId: selection.profileId,
        relevantFacts: context.relevantFacts.length,
        relevantDecisions: context.relevantDecisions.length,
        artifactSummaries: context.artifactSummaries.length,
        transcriptRefs: context.transcriptRefs.length,
        budget: context.budget?.maxInputChars ?? null,
      }),
      services.blackboardStore,
    );

    const adapter = services.adapterRegistry.get(selection.agentId);
    const invocation = await adapter.planInvocation(
      currentGraph.tasks[task.id] ?? task,
      context,
      selection,
    );
    await this.appendProjectedEvent(
      this.createEvent("invocation_planned", run.runId, {
        taskId: task.id,
        agentId: invocation.agentId,
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.cwd,
        actionPlanCount: invocation.actionPlans.length,
      }),
      services.blackboardStore,
    );

    return { graph: currentGraph, invocation };
  }

  private async executeInvocation(
    run: RunRecord,
    graph: RunGraph,
    task: TaskSpec,
    invocation: InvocationPlan,
    runConfig: MultiAgentConfig,
    services: ExecutionServices,
  ): Promise<RunGraph> {
    const existingRecord = await this.dependencies.runStore.getTaskRecord(run.runId, task.id);
    const attempts = (existingRecord?.attempts ?? 0) + 1;
    await services.workspaceStateStore.captureBeforeTask(
      run.runId,
      task.id,
      task.workingDirectory,
    );
    const beforeManifest = await captureFileManifest(task.workingDirectory);
    await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, "queued");
    await this.appendProjectedEvent(
      this.createEvent("task_queued", run.runId, {
        taskId: task.id,
        agentId: invocation.agentId,
      }),
      services.blackboardStore,
    );
    await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
      status: "running",
      attempts,
      startedAt: existingRecord?.startedAt ?? isoNow(),
      finishedAt: null,
    });

    let finalEvent: RunEvent | null = null;
    for await (const event of services.executionRuntime.execute(
      run.runId,
      graph.tasks[task.id] ?? task,
      invocation,
    )) {
      await this.projectEventToBlackboard(event, services.blackboardStore);
      if (event.type === "task_completed" || event.type === "task_failed") {
        finalEvent = event;
      }
    }

    if (!finalEvent) {
      throw new Error(`Task "${task.id}" completed execution without a terminal event.`);
    }

    const afterManifest = await captureFileManifest(task.workingDirectory);
    await this.archiveExecutionArtifacts(
      run.runId,
      task.id,
      invocation,
      finalEvent,
      beforeManifest,
      afterManifest,
      services,
    );
    await services.workspaceStateStore.captureAfterTask(
      run.runId,
      task.id,
      task.workingDirectory,
    );

    if (finalEvent.type === "task_completed") {
      await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, "validating");
      return this.validateTask(run, graph, task, invocation, attempts, runConfig, services);
    }

    if (isDelegationManagerTask(task)) {
      await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
        status: "validating",
        attempts,
        finishedAt: null,
      });
      return this.validateTask(run, graph, task, invocation, attempts, runConfig, services);
    }

    const nextStatus =
      attempts < task.retryPolicy.maxAttempts ? "failed_retryable" : "failed_terminal";
    await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
      status: nextStatus,
      attempts,
      finishedAt: finalEvent.timestamp,
    });
    return (await this.dependencies.runStore.getGraph(run.runId)) ?? graph;
  }

  private async validateTask(
    run: RunRecord,
    graph: RunGraph,
    task: TaskSpec,
    invocation: InvocationPlan,
    attempts: number,
    runConfig: MultiAgentConfig,
    services: ExecutionServices,
  ): Promise<RunGraph> {
    await this.appendProjectedEvent(
      this.createEvent("validation_started", run.runId, {
        taskId: task.id,
        validatorMode: task.validator.mode,
      }),
      services.blackboardStore,
    );

    const artifacts = await services.artifactStore.list(run.runId, { taskId: task.id });
    const result = await services.validator.validate({
      task: (graph.tasks[task.id] ?? task) as TaskSpec,
      invocation,
      artifacts,
    });

    await this.recordArtifact(
      run.runId,
      task.id,
      "validation_result",
      services,
      `artifact://run/${run.runId}/task/${task.id}/validation/${createId("validation")}`,
      result.summary,
      {
        outcome: result.outcome,
        details: result.details,
        createdArtifacts: result.createdArtifacts,
        validator: task.validator,
      },
    );

    if (result.outcome === "pass") {
      await this.appendProjectedEvent(
        this.createEvent("validation_passed", run.runId, {
          taskId: task.id,
          summary: result.summary,
          details: result.details,
        }),
        services.blackboardStore,
      );
      let currentGraph = (await this.dependencies.runStore.getGraph(run.runId)) ?? graph;
      currentGraph = await this.appendDelegatedTasksIfNeeded(
        run,
        currentGraph,
        task,
        artifacts,
        runConfig,
        services,
      );
      currentGraph = services.scheduler.onTaskCompleted(currentGraph, task.id);
      await this.dependencies.runStore.saveGraph(run.runId, currentGraph);
      await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
        status: "completed",
        attempts,
        finishedAt: isoNow(),
      });
      const afterCompletionGraph =
        (await this.dependencies.runStore.getGraph(run.runId)) ?? currentGraph;
      if (!isDelegationManagerTask(task)) {
        return this.reportWorkerCompletionToManager(
          run,
          afterCompletionGraph,
          task,
          services,
        );
      }
      return afterCompletionGraph;
    }

    await this.appendProjectedEvent(
      this.createEvent("validation_failed", run.runId, {
        taskId: task.id,
        outcome: result.outcome,
        summary: result.summary,
        details: result.details,
      }),
      services.blackboardStore,
    );

    if (result.outcome === "fail_replan_needed") {
      return this.replanGraph(run, graph, task, result, attempts, services);
    }

    const nextStatus = mapValidationOutcomeToTaskStatus(
      result,
      task,
      attempts,
    );
    await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
      status: nextStatus,
      attempts,
      finishedAt: isoNow(),
    });
    if (nextStatus === "blocked") {
      await this.appendProjectedEvent(
        this.createEvent("task_blocked", run.runId, {
          taskId: task.id,
          reasons: [result.summary, ...result.details],
        }),
        services.blackboardStore,
      );
    }

    return (await this.dependencies.runStore.getGraph(run.runId)) ?? graph;
  }

  private buildDelegatedBootstrapTasks(request: RunRequest): TaskSpec[] {
    const metadata = request.metadata ?? {};
    const managerAgentId = readNonEmptyString(metadata.plannerAgentId);
    const workerAgentIds = readStringArray(metadata.agentIds).filter(
      (agentId) => agentId !== managerAgentId,
    );

    return [
      {
        id: createId("task"),
        title: buildDelegationTaskTitle(request.goal),
        kind: "plan",
        goal: buildDelegationManagerGoal(request.goal, workerAgentIds),
        instructions: [
          "Understand the user goal and break it into executable worker tasks.",
          "Respond with structured JSON only using managerReply, managerDecision, and delegatedTasks.",
          "Use dependsOn when a delegated worker task must wait for another delegated task.",
          "Do not execute implementation directly in this manager task.",
        ],
        inputs: [`Original user goal: ${request.goal}`],
        dependsOn: [],
        requiredCapabilities: ["planning", "delegation"],
        preferredAgent: managerAgentId,
        workingDirectory: request.workspacePath,
        expectedArtifacts: ["Structured output with managerDecision and delegatedTasks[]."],
        acceptanceCriteria: [
          "A manager decision is explicit and worker tasks can be derived when needed.",
        ],
        validator: { mode: "none" },
        riskLevel: "low",
        allowedActions: [],
        timeoutMs: DEFAULT_TASK_TIMEOUT_MS,
        retryPolicy: {
          maxAttempts: 1,
          backoffMs: 0,
          retryOn: [],
        },
        status: "pending",
      },
    ];
  }

  private async appendDelegatedTasksIfNeeded(
    run: RunRecord,
    graph: RunGraph,
    task: TaskSpec,
    artifacts: ArtifactRecord[],
    runConfig: MultiAgentConfig,
    services: ExecutionServices,
  ): Promise<RunGraph> {
    if (!isDelegationManagerTask(task)) {
      return graph;
    }

    const isCoordinationTask = isManagerCoordinationTask(task);
    const managerOutput = this.extractManagerCoordinationOutput(
      this.extractLatestStructuredOutput(artifacts),
    );
    const delegatedTemplates =
      managerOutput.managerDecision === "no_more_tasks"
        ? []
        : managerOutput.delegatedTasks.slice(0, MAX_DELEGATED_TASKS);
    const resolvedConfig = this.resolveRunExecutionConfig(run, runConfig);
    const provisioned = await this.ensureCapabilityWorkersForDelegatedTasks(
      run,
      delegatedTemplates,
      resolvedConfig,
      services,
    );
    const activeRun = provisioned.run;
    const activeConfig = provisioned.config;
    const knownAgentIds = readStringArray(activeRun.metadata.agentIds);
    const allowOutsideWorkspaceWrites =
      readOptionalBoolean(activeRun.metadata.allowOutsideWorkspaceWrites) ??
      activeConfig.workspace.allowOutsideWorkspaceWrites;
    const managerAgentId =
      task.assignedAgent ??
      task.preferredAgent ??
      readNonEmptyString(activeRun.metadata.plannerAgentId) ??
      activeConfig.planner.agentId;
    const delegatedTaskDrafts = delegatedTemplates.map((template, index) =>
      buildDelegatedTaskDraft(template, index),
    );
    const delegatedTaskReferenceMap = buildDelegatedTaskReferenceMap(
      delegatedTaskDrafts,
      task,
    );
    const existingTaskIds = new Set(Object.keys(graph.tasks));
    const fallbackWorkerId =
      knownAgentIds.find((agentId) =>
        agentId !== managerAgentId &&
        isAgentCompatibleWithCapabilities(
          activeConfig.agents.find((candidate) => candidate.id === agentId),
          ["planning"],
        )
      ) ??
      knownAgentIds.find((agentId) => agentId !== managerAgentId);

    if (managerOutput.managerReply) {
      const { session } = await this.ensureDelegatedManagerSession(run, graph);
      await this.appendThreadMessageWithAudit(
        run,
        services,
        {
          runId: run.runId,
          threadId: session.threadId,
          sessionId: session.sessionId,
          role: "manager",
          actorId: managerAgentId ?? session.agentId ?? "manager",
          body: managerOutput.managerReply,
          clientRequestId: `manager-reply:${task.id}:${isoNow()}`,
          metadata: {
            source: "manager_task_output",
            taskId: task.id,
            managerDecision: managerOutput.managerDecision ?? "continue",
          },
        },
        task.id,
      );
    }

    if (
      managerOutput.managerDecision === "no_more_tasks" &&
      !managerOutput.managerReply
    ) {
      const { session } = await this.ensureDelegatedManagerSession(run, graph);
      await this.appendThreadMessageWithAudit(
        run,
        services,
        {
          runId: run.runId,
          threadId: session.threadId,
          sessionId: session.sessionId,
          role: "manager",
          actorId: managerAgentId ?? session.agentId ?? "manager",
          body: "Current message queue is complete. There are no follow-up tasks right now.",
          clientRequestId: `manager-no-more:${task.id}:${isoNow()}`,
          metadata: {
            source: "manager_task_output",
            taskId: task.id,
            managerDecision: "no_more_tasks",
          },
        },
        task.id,
      );
    }

    const delegatedTasks = delegatedTaskDrafts
      .map((draft) =>
        this.toDelegatedTaskSpec(draft.template, {
          run: activeRun,
          managerTask: task,
          allowOutsideWorkspaceWrites,
          defaultWorkerAgentId: fallbackWorkerId,
          knownAgentIds,
          plannerAgentId: managerAgentId,
          agentCatalog: activeConfig.agents,
          index: draft.index,
          taskId: draft.taskId,
          title: draft.title,
          dependencyTaskIds: resolveDelegatedDependencyTaskIds({
            dependencyRefs: readStringArray(draft.template.dependsOn),
            currentTaskId: draft.taskId,
            managerTaskId: task.id,
            existingTaskIds,
            referenceMap: delegatedTaskReferenceMap,
          }),
        }),
      )
      .filter((candidate): candidate is TaskSpec => candidate !== null);

    if (
      delegatedTasks.length === 0 &&
      fallbackWorkerId &&
      managerOutput.managerDecision !== "no_more_tasks" &&
      !isCoordinationTask
    ) {
      delegatedTasks.push(
        this.buildFallbackDelegatedTask(activeRun, task, fallbackWorkerId),
      );
    }

    if (
      delegatedTasks.length === 0 &&
      isCoordinationTask &&
      !managerOutput.managerReply &&
      managerOutput.managerDecision !== "no_more_tasks"
    ) {
      const { session } = await this.ensureDelegatedManagerSession(run, graph);
      await this.appendThreadMessageWithAudit(
        run,
        services,
        {
          runId: run.runId,
          threadId: session.threadId,
          sessionId: session.sessionId,
          role: "manager",
          actorId: managerAgentId ?? session.agentId ?? "manager",
          body: "Current cycle has no additional delegated tasks.",
          clientRequestId: `manager-coordination-empty:${task.id}:${isoNow()}`,
          metadata: {
            source: "manager_task_output",
            taskId: task.id,
            managerDecision: "no_more_tasks",
          },
        },
        task.id,
      );
    }

    if (delegatedTasks.length === 0) {
      return graph;
    }

    const patch = {
      operation: "append_tasks" as const,
      reason: `Delegated by manager task "${task.id}".`,
      tasks: delegatedTasks,
    };
    const patchedGraph = this.dependencies.graphManager.applyPatch(graph, patch);
    await this.dependencies.runStore.saveGraph(run.runId, patchedGraph);
    await this.appendProjectedEvent(
      this.createEvent("replan_applied", run.runId, {
        taskId: task.id,
        operation: patch.operation,
        reason: patch.reason,
        appendedTaskIds: delegatedTasks.map((delegatedTask) => delegatedTask.id),
        targetTaskIds: [],
      }),
      services.blackboardStore,
    );
    for (const delegatedTask of delegatedTasks) {
      await this.appendProjectedEvent(
        this.createEvent("task_planned", run.runId, {
          taskId: delegatedTask.id,
          title: delegatedTask.title,
          parentTaskId: task.id,
          delegatedBy: task.assignedAgent ?? task.preferredAgent ?? "manager",
        }),
        services.blackboardStore,
      );
    }

    return (await this.dependencies.runStore.getGraph(run.runId)) ?? patchedGraph;
  }

  private buildFallbackDelegatedTask(
    run: RunRecord,
    managerTask: TaskSpec,
    workerAgentId: string,
  ): TaskSpec {
    return {
      id: createId("task"),
      title: "Worker execution",
      kind: "execute",
      goal: run.goal,
      instructions: [
        `Deliver the user goal directly: ${run.goal}`,
        "Produce concrete implementation output in the workspace.",
      ],
      inputs: [
        `Delegated by manager task "${managerTask.id}".`,
        `Original run goal: ${run.goal}`,
      ],
      dependsOn: [managerTask.id],
      requiredCapabilities: ["planning"],
      preferredAgent: workerAgentId,
      workingDirectory: managerTask.workingDirectory,
      expectedArtifacts: ["Implementation output matching the original user goal."],
      acceptanceCriteria: [`The user goal is completed: ${run.goal}`],
      validator: { mode: "none" },
      riskLevel: "low",
      allowedActions: [],
      timeoutMs: DEFAULT_DELEGATED_TASK_TIMEOUT_MS,
      retryPolicy: {
        maxAttempts: 1,
        backoffMs: 0,
        retryOn: [],
      },
      status: "pending",
    };
  }

  private extractLatestStructuredOutput(artifacts: ArtifactRecord[]): unknown {
    const structuredArtifact = [...artifacts]
      .reverse()
      .find((artifact) => artifact.kind === "structured_output");
    if (!structuredArtifact) {
      return undefined;
    }

    const metadata = structuredArtifact.metadata as Record<string, unknown>;
    if ("output" in metadata) {
      return metadata.output;
    }
    if ("structuredOutput" in metadata) {
      return metadata.structuredOutput;
    }
    return undefined;
  }

  private extractManagerCoordinationOutput(value: unknown): ManagerCoordinationOutput {
    if (!isPlainObject(value)) {
      return {
        delegatedTasks: [],
      };
    }

    const managerReply = readNonEmptyString(value.managerReply);
    const managerDecision =
      value.managerDecision === "continue" || value.managerDecision === "no_more_tasks"
        ? value.managerDecision
        : undefined;

    return {
      delegatedTasks: this.extractDelegatedTaskTemplates(value),
      ...(managerReply ? { managerReply } : {}),
      ...(managerDecision ? { managerDecision } : {}),
    };
  }

  private extractDelegatedTaskTemplates(value: unknown): DelegatedTaskTemplate[] {
    if (!isPlainObject(value)) {
      return [];
    }

    const rootDelegated = value.delegatedTasks;
    if (Array.isArray(rootDelegated)) {
      return rootDelegated.filter(isPlainObject);
    }

    const rootTasks = value.tasks;
    if (Array.isArray(rootTasks)) {
      return rootTasks.filter(isPlainObject);
    }

    const delegate = value.delegate;
    if (isPlainObject(delegate) && Array.isArray(delegate.tasks)) {
      return delegate.tasks.filter(isPlainObject);
    }

    return [];
  }

  private async ensureCapabilityWorkersForDelegatedTasks(
    run: RunRecord,
    delegatedTemplates: DelegatedTaskTemplate[],
    config: MultiAgentConfig,
    services: ExecutionServices,
  ): Promise<{ run: RunRecord; config: MultiAgentConfig }> {
    if (delegatedTemplates.length === 0) {
      return { run, config };
    }

    const plannerAgentId =
      readNonEmptyString(run.metadata.plannerAgentId) ?? config.planner.agentId;
    let nextConfig = config;
    const existingAgentIds = new Set(nextConfig.agents.map((agent) => agent.id));
    const createdAgents: AgentConfig[] = [];

    for (const template of delegatedTemplates) {
      const requiredCapabilities = dedupeStrings(
        readStringArray(template.requiredCapabilities).length > 0
          ? readStringArray(template.requiredCapabilities)
          : ["planning"],
      );
      if (
        hasCompatibleWorkerForCapabilities(
          nextConfig.agents,
          plannerAgentId,
          requiredCapabilities,
        )
      ) {
        continue;
      }

      const worker = this.buildProvisionedWorkerAgent(
        run,
        nextConfig,
        plannerAgentId,
        requiredCapabilities,
        existingAgentIds,
      );
      if (!worker) {
        continue;
      }

      createdAgents.push(worker);
      existingAgentIds.add(worker.id);
      nextConfig = {
        ...nextConfig,
        agents: [...nextConfig.agents, worker],
      };
    }

    if (createdAgents.length === 0) {
      return { run, config: nextConfig };
    }

    const registeredAgentIds = new Set(
      services.adapterRegistry.list().map((adapter) => adapter.agentId),
    );
    for (const worker of createdAgents) {
      if (registeredAgentIds.has(worker.id)) {
        continue;
      }
      services.adapterRegistry.register(new ConfiguredCliAdapter(worker));
      registeredAgentIds.add(worker.id);
    }
    services.router = new RuleBasedRouter({
      adapterRegistry: services.adapterRegistry,
      agents: nextConfig.agents,
      routing: nextConfig.routing,
    });

    const existingMetadataAgentIds = readStringArray(run.metadata.agentIds);
    const existingDynamicAgents = readDynamicAgents(run.metadata.dynamicAgents);
    const nextRun: RunRecord = {
      ...run,
      metadata: {
        ...run.metadata,
        agentIds: dedupeStrings([
          ...existingMetadataAgentIds,
          ...createdAgents.map((agent) => agent.id),
        ]),
        dynamicAgents: dedupeAgentConfigs([
          ...existingDynamicAgents,
          ...createdAgents,
        ]),
      },
      updatedAt: isoNow(),
    };
    await this.dependencies.runStore.updateRun(nextRun);
    return {
      run: nextRun,
      config: nextConfig,
    };
  }

  private buildProvisionedWorkerAgent(
    run: RunRecord,
    config: MultiAgentConfig,
    plannerAgentId: string | undefined,
    requiredCapabilities: string[],
    existingAgentIds: Set<string>,
  ): AgentConfig | null {
    const selectedCli = resolveSelectedCli(run.metadata.selectedCli);
    const templateAgent =
      config.agents.find((agent) => selectedCli && agent.id === selectedCli) ??
      config.agents.find((agent) => plannerAgentId && agent.id !== plannerAgentId) ??
      config.agents.find((agent) => agent.id === plannerAgentId) ??
      config.agents[0];
    const templateProfile = templateAgent?.profiles[0];
    if (!templateAgent || !templateProfile) {
      return null;
    }

    const normalizedCapabilities = dedupeStrings([
      "planning",
      ...requiredCapabilities,
    ]);
    const capabilitySlug = toCapabilitySlug(normalizedCapabilities);
    const idBase = `${templateAgent.id}-worker-${capabilitySlug}`;
    let nextId = idBase;
    let suffix = 2;
    while (existingAgentIds.has(nextId)) {
      nextId = `${idBase}-${suffix}`;
      suffix += 1;
    }

    const workerProfile: AgentProfileConfig = {
      id: "worker",
      label: `Worker (${normalizedCapabilities.join(", ")})`,
      capabilities: normalizedCapabilities,
      ...(templateProfile.defaultArgs
        ? { defaultArgs: [...templateProfile.defaultArgs] }
        : {}),
      defaultCwd: templateProfile.defaultCwd ?? run.workspacePath,
      costTier: templateProfile.costTier,
    };

    return {
      id: nextId,
      command: templateAgent.command,
      ...(typeof templateAgent.priority === "number"
        ? { priority: templateAgent.priority + 1 }
        : {}),
      profiles: [workerProfile],
    };
  }

  private toDelegatedTaskSpec(
    template: DelegatedTaskTemplate,
    options: {
      run: RunRecord;
      managerTask: TaskSpec;
      allowOutsideWorkspaceWrites: boolean;
      defaultWorkerAgentId?: string;
      knownAgentIds: string[];
      plannerAgentId?: string;
      agentCatalog: AgentConfig[];
      index: number;
      taskId: string;
      title: string;
      dependencyTaskIds: string[];
    },
  ): TaskSpec | null {
    const goal = readNonEmptyString(template.goal) ?? options.run.goal;
    const title = options.title;
    if (!goal) {
      return null;
    }

    const baseInstructions =
      readStringArray(template.instructions).length > 0
        ? readStringArray(template.instructions)
        : [`Deliver the delegated goal: ${goal}`];
    const requiredCapabilities = dedupeStrings(
      readStringArray(template.requiredCapabilities).length > 0
        ? readStringArray(template.requiredCapabilities)
        : ["planning"],
    );
    const preferredAgentCandidate = readNonEmptyString(template.preferredAgent);
    const preferredAgent = pickWorkerAgentForCapabilities({
      requiredCapabilities,
      preferredAgentCandidate,
      defaultWorkerAgentId: options.defaultWorkerAgentId,
      knownAgentIds: options.knownAgentIds,
      plannerAgentId: options.plannerAgentId,
      agents: options.agentCatalog,
    });
    const expectedArtifacts =
      readStringArray(template.expectedArtifacts).length > 0
        ? readStringArray(template.expectedArtifacts)
        : ["Output that satisfies the delegated goal."];
    const instructions = buildDelegatedTaskInstructions({
      instructions: baseInstructions,
      expectedArtifacts,
      workspacePath: options.run.workspacePath,
      allowOutsideWorkspaceWrites: options.allowOutsideWorkspaceWrites,
    });
    const workingDirectory = resolveDelegatedWorkingDirectory({
      expectedArtifacts,
      fallbackWorkingDirectory: options.managerTask.workingDirectory,
      workspacePath: options.run.workspacePath,
      allowOutsideWorkspaceWrites: options.allowOutsideWorkspaceWrites,
    });
    const acceptanceCriteria =
      readStringArray(template.acceptanceCriteria).length > 0
        ? readStringArray(template.acceptanceCriteria)
        : [`Delegated goal completed: ${goal}`];
    const riskLevel = normalizeRiskLevel(template.riskLevel);
    const timeoutMs = normalizeTimeoutMs(
      template.timeoutMs,
      DEFAULT_DELEGATED_TASK_TIMEOUT_MS,
    );

    return {
      id: options.taskId,
      title,
      kind: "execute",
      goal,
      instructions,
      inputs: [
        `Delegated by manager task "${options.managerTask.id}".`,
        `Original run goal: ${options.run.goal}`,
      ],
      dependsOn: options.dependencyTaskIds,
      requiredCapabilities,
      ...(preferredAgent ? { preferredAgent } : {}),
      workingDirectory,
      expectedArtifacts,
      acceptanceCriteria,
      validator: { mode: "none" },
      riskLevel,
      allowedActions: [],
      timeoutMs,
      retryPolicy: {
        maxAttempts: 1,
        backoffMs: 0,
        retryOn: [],
      },
      status: "pending",
    };
  }

  private async recoverGraphForResume(
    run: RunRecord,
    services: ExecutionServices,
  ): Promise<{ graph: RunGraph; waitingApprovalTaskId?: string }> {
    const pendingApprovals = await services.approvalManager.listPending(run.runId);
    const pendingApprovalTaskIds = new Set(pendingApprovals.map((request) => request.taskId));

    for (const request of pendingApprovals) {
      const currentGraph = await this.dependencies.runStore.getGraph(run.runId);
      const task = currentGraph?.tasks[request.taskId];
      if (task && task.status !== "awaiting_approval") {
        await this.dependencies.runStore.updateTaskStatus(run.runId, request.taskId, "awaiting_approval");
      }
    }

    const graph = await this.dependencies.runStore.getGraph(run.runId);
    if (!graph) {
      throw new Error(`Run graph "${run.runId}" was not found.`);
    }

    for (const task of Object.values(graph.tasks)) {
      if (pendingApprovalTaskIds.has(task.id)) {
        continue;
      }

      if (
        task.status === "routing" ||
        task.status === "context_building" ||
        task.status === "queued" ||
        task.status === "running" ||
        task.status === "validating" ||
        task.status === "failed_retryable"
      ) {
        await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
          status: "queued",
          finishedAt: null,
        });
      }
    }

    return {
      graph: (await this.dependencies.runStore.getGraph(run.runId)) ?? graph,
      ...(pendingApprovals[0] ? { waitingApprovalTaskId: pendingApprovals[0].taskId } : {}),
    };
  }

  private async replanGraph(
    run: RunRecord,
    graph: RunGraph,
    task: TaskSpec,
    result: ValidationResult,
    attempts: number,
    services: ExecutionServices,
  ): Promise<RunGraph> {
    const currentGraph = (await this.dependencies.runStore.getGraph(run.runId)) ?? graph;
    const recalledMemories = await this.dependencies.projectMemoryStore.recall({
      text: `${run.goal} ${task.title} ${result.summary}`,
      scope: "project",
    });

    await this.appendProjectedEvent(
      this.createEvent("replan_requested", run.runId, {
        taskId: task.id,
        summary: result.summary,
        details: result.details,
      }),
      services.blackboardStore,
    );

    const patch = await this.dependencies.planner.replan({
      goal: run.goal,
      graph: currentGraph,
      recalledMemories,
      validationResults: [result],
    });

    if (!hasMeaningfulGraphPatch(patch)) {
      await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
        status: "failed_terminal",
        attempts,
        finishedAt: isoNow(),
      });
      return (await this.dependencies.runStore.getGraph(run.runId)) ?? currentGraph;
    }

    await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
      status: "cancelled",
      attempts,
      finishedAt: isoNow(),
    });

    const graphForPatch = (await this.dependencies.runStore.getGraph(run.runId)) ?? currentGraph;
    const patchedGraph = this.dependencies.graphManager.applyPatch(graphForPatch, patch);
    await this.dependencies.runStore.saveGraph(run.runId, patchedGraph);

    await this.appendProjectedEvent(
      this.createEvent("replan_applied", run.runId, {
        taskId: task.id,
        operation: patch.operation,
        reason: patch.reason,
        appendedTaskIds: patch.tasks?.map((plannedTask) => plannedTask.id) ?? [],
        targetTaskIds: patch.targetTaskIds ?? [],
      }),
      services.blackboardStore,
    );

    return (await this.dependencies.runStore.getGraph(run.runId)) ?? patchedGraph;
  }

  private async archiveExecutionArtifacts(
    runId: string,
    taskId: string,
    invocation: InvocationPlan,
    finalEvent: RunEvent,
    beforeManifest: FileManifest,
    afterManifest: FileManifest,
    services: ExecutionServices,
  ): Promise<void> {
    const payload = finalEvent.payload as Record<string, unknown>;
    const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
    await this.recordArtifact(
      runId,
      taskId,
      "command_result",
      services,
      `artifact://run/${runId}/task/${taskId}/command-result/${finalEvent.id}`,
      summarizeCommandResult(finalEvent.type, exitCode),
      {
        eventType: finalEvent.type,
        invocation,
        payload,
      },
    );

    const structuredOutput = extractStructuredOutputFromPayload(payload);
    if (structuredOutput !== undefined) {
      await this.recordArtifact(
        runId,
        taskId,
        "structured_output",
        services,
        `artifact://run/${runId}/task/${taskId}/structured-output/${finalEvent.id}`,
        "Structured output captured from task result.",
        {
          output: structuredOutput,
        },
      );
    }

    const fileChanges = diffFileManifest(beforeManifest, afterManifest);
    for (const change of fileChanges) {
      await this.recordArtifact(
        runId,
        taskId,
        "file_change",
        services,
        `workspace://${change.path}`,
        `${capitalize(change.changeType)} file ${change.path}.`,
        change,
      );
    }
  }

  private async recordArtifact(
    runId: string,
    taskId: string | undefined,
    kind: ArtifactRecord["kind"],
    services: ExecutionServices,
    uri: string,
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<ArtifactRecord> {
    const artifact: ArtifactRecord = {
      id: createId("artifact"),
      runId,
      ...(taskId ? { taskId } : {}),
      kind,
      uri,
      summary,
      createdAt: isoNow(),
      metadata,
    };
    await services.artifactStore.record(artifact);
    await this.appendProjectedEvent(
      this.createEvent("artifact_created", runId, {
        taskId,
        artifactId: artifact.id,
        kind,
        uri,
        summary,
      }),
      services.blackboardStore,
    );
    return artifact;
  }

  private async appendProjectedEvent(
    event: RunEvent,
    blackboardStore: BlackboardStore,
  ): Promise<void> {
    await this.dependencies.eventStore.append(event);
    await this.projectEventToBlackboard(event, blackboardStore);
  }

  private async projectEventToBlackboard(
    event: RunEvent,
    blackboardStore: BlackboardStore,
  ): Promise<void> {
    const projection = buildBlackboardProjection(event);
    if (!projection) {
      return;
    }

    await blackboardStore.upsert({
      id: projection.id,
      runId: event.runId,
      ...(event.taskId ? { taskId: event.taskId } : {}),
      scope: projection.scope,
      summary: projection.summary,
      references: projection.references,
      updatedAt: event.timestamp,
    });
  }

  private resolveBlackboardStore(workspacePath: string): BlackboardStore {
    return (
      this.dependencies.blackboardStore ??
      new FileBlackboardStore(resolvePath(".multi-agent/state", workspacePath))
    );
  }

  private async finalizeRun(
    run: RunRecord,
    status: "completed" | "failed",
    graph: RunGraph,
    services: ExecutionServices,
  ): Promise<RunRecord> {
    const finishedRun = await this.updateRunRecord(run, status);
    await this.appendProjectedEvent(
      this.createEvent("run_finished", finishedRun.runId, {
        status,
        completedTaskIds: graph.completedTaskIds,
        failedTaskIds: graph.failedTaskIds,
      }),
      services.blackboardStore,
    );
    await this.persistRunMemory(finishedRun, graph, services);
    return finishedRun;
  }

  private async persistRunMemory(
    run: RunRecord,
    graph: RunGraph,
    services: ExecutionServices,
  ): Promise<void> {
    if (run.status !== "completed" && run.status !== "failed") {
      return;
    }

    const [events, artifacts, blackboardEntries] = await Promise.all([
      this.dependencies.eventStore.list(run.runId),
      services.artifactStore.list(run.runId),
      services.blackboardStore.list(run.runId),
    ]);
    const consolidator = new MemoryConsolidator(this.dependencies.projectMemoryStore);
    await consolidator.consolidate({
      run,
      graph,
      events,
      artifacts,
      blackboardEntries,
    });
  }

  private async updateRunRecord(
    run: RunRecord,
    status: RunRecord["status"],
    currentTaskId?: string,
  ): Promise<RunRecord> {
    const latestRun = await this.dependencies.runStore.getRun(run.runId);
    const baseRun = latestRun ?? run;

    if (baseRun.status !== status) {
      assertRunStatusTransition(baseRun.status, status);
    }

    const nextRun: RunRecord = {
      ...baseRun,
      status,
      ...(currentTaskId ? { currentTaskId } : { currentTaskId: undefined }),
      updatedAt: isoNow(),
    };
    await this.dependencies.runStore.updateRun(nextRun);
    return nextRun;
  }

  private resolveRunExecutionConfig(
    run: RunRecord,
    baseConfig?: MultiAgentConfig,
  ): MultiAgentConfig {
    const sourceConfig = applyWorkspaceWritePolicyOverride(
      mergeDynamicAgentsIntoConfig(
        baseConfig ?? createDefaultConfig(run.workspacePath),
        run.metadata,
      ),
      run.metadata,
    );
    const selectedCli = resolveSelectedCli(run.metadata.selectedCli);
    if (
      selectedCli &&
      resolvePlannerMode(run.metadata) === "delegated" &&
      shouldKeepDelegatedConfigForSelectedCli(
        run.metadata,
        selectedCli,
        sourceConfig,
      )
    ) {
      return sourceConfig;
    }
    if (selectedCli) {
      return buildRunConfigForSelectedCli(sourceConfig, selectedCli, run.workspacePath);
    }
    if (shouldFallbackToDefaultSelectedCli(run.metadata)) {
      return buildRunConfigForSelectedCli(
        sourceConfig,
        DEFAULT_SELECTED_CLI,
        run.workspacePath,
      );
    }
    return sourceConfig;
  }

  private createEvent(
    type: RunEvent["type"],
    runId: string,
    payload: Record<string, unknown>,
  ): RunEvent {
    const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;

    return {
      schemaVersion: SCHEMA_VERSION,
      id: createId("event"),
      type,
      runId,
      taskId,
      timestamp: isoNow(),
      payload,
    };
  }
}

function resolvePlannerMode(
  metadata: Record<string, unknown> | undefined,
): "static" | "delegated" {
  return metadata?.plannerMode === "delegated" ? "delegated" : "static";
}

function applyWorkspaceWritePolicyOverride(
  config: MultiAgentConfig,
  metadata: Record<string, unknown> | undefined,
): MultiAgentConfig {
  const allowOutsideWorkspaceWrites = readOptionalBoolean(
    metadata?.allowOutsideWorkspaceWrites,
  );
  if (allowOutsideWorkspaceWrites === undefined) {
    return config;
  }

  return {
    ...config,
    workspace: {
      ...config.workspace,
      allowOutsideWorkspaceWrites,
    },
  };
}

function shouldUseDelegatedBootstrap(
  metadata: Record<string, unknown> | undefined,
): boolean {
  if (resolvePlannerMode(metadata) !== "delegated") {
    return false;
  }

  const selectedCli = resolveSelectedCli(metadata?.selectedCli);
  if (!selectedCli) {
    return true;
  }

  const plannerAgentId = readNonEmptyString(metadata?.plannerAgentId);
  const configuredAgentIds = readStringArray(metadata?.agentIds);
  return (
    Boolean(plannerAgentId) &&
    plannerAgentId === selectedCli &&
    configuredAgentIds.includes(plannerAgentId)
  );
}

function buildDelegationTaskTitle(goal: string): string {
  const compactGoal = goal.replace(/\s+/g, " ").trim();
  if (!compactGoal) {
    return "Manager dispatch";
  }
  return compactGoal.length <= 72
    ? `Manager dispatch: ${compactGoal}`
    : `Manager dispatch: ${compactGoal.slice(0, 69)}...`;
}

function buildDelegationManagerGoal(
  goal: string,
  workerAgentIds: string[],
): string {
  const workerLine =
    workerAgentIds.length > 0
      ? `Prefer assigning preferredAgent from this list: ${workerAgentIds.join(", ")}.`
      : "Assign preferredAgent only if a worker id is known.";

  return [
    "You are the CLI manager.",
    "Coordinate work and return JSON only.",
    "Response format:",
    "{\"managerReply\":\"...\",\"managerDecision\":\"continue|no_more_tasks\",\"delegatedTasks\":[{\"title\":\"...\",\"goal\":\"...\",\"preferredAgent\":\"...\",\"dependsOn\":[\"upstream task title\"],\"instructions\":[\"...\"],\"requiredCapabilities\":[\"planning\"],\"expectedArtifacts\":[\"...\"],\"acceptanceCriteria\":[\"...\"]}]}",
    "Rules:",
    "- Return a valid JSON object.",
    "- managerDecision must be either continue or no_more_tasks.",
    "- If managerDecision is no_more_tasks, return delegatedTasks as an empty array.",
    "- If managerDecision is continue, delegatedTasks should contain concrete worker tasks.",
    "- Use dependsOn when one delegated task must wait for another delegated task.",
    "- In dependsOn, reference delegatedTasks by their title exactly as returned in this same JSON response.",
    "- managerReply should summarize what to do next for the user and workers.",
    "- Do not include markdown fences or extra prose.",
    workerLine,
    `User goal: ${goal}`,
  ].join("\n");
}

function isDelegationManagerTask(task: TaskSpec): boolean {
  return (
    task.kind === "plan" &&
    task.requiredCapabilities.includes("planning") &&
    task.requiredCapabilities.includes("delegation")
  );
}

function isManagerCoordinationTask(task: TaskSpec): boolean {
  return (
    isDelegationManagerTask(task) &&
    task.title.toLowerCase().includes("manager coordination")
  );
}

function hasActiveDelegationManagerTask(graph: RunGraph): boolean {
  return Object.values(graph.tasks).some(
    (task) =>
      isDelegationManagerTask(task) &&
      task.status !== "completed" &&
      task.status !== "failed_terminal" &&
      task.status !== "cancelled",
  );
}

function isTerminalRunStatus(status: RunRecord["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isAutoResumableRunStatus(status: RunRecord["status"]): boolean {
  return status === "ready" || status === "paused" || status === "waiting_approval";
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => readNonEmptyString(item))
    .filter((item): item is string => Boolean(item));
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeAgentConfigs(agents: AgentConfig[]): AgentConfig[] {
  const byId = new Map<string, AgentConfig>();
  for (const agent of agents) {
    if (!byId.has(agent.id)) {
      byId.set(agent.id, agent);
    }
  }
  return [...byId.values()];
}

function isAgentCompatibleWithCapabilities(
  agent: AgentConfig | undefined,
  requiredCapabilities: string[],
): boolean {
  if (!agent) {
    return false;
  }
  return agent.profiles.some((profile) =>
    requiredCapabilities.every((capability) =>
      profile.capabilities.includes(capability),
    ),
  );
}

function hasCompatibleWorkerForCapabilities(
  agents: AgentConfig[],
  plannerAgentId: string | undefined,
  requiredCapabilities: string[],
): boolean {
  return agents.some(
    (agent) =>
      agent.id !== plannerAgentId &&
      isAgentCompatibleWithCapabilities(agent, requiredCapabilities),
  );
}

function pickWorkerAgentForCapabilities(options: {
  requiredCapabilities: string[];
  preferredAgentCandidate?: string;
  defaultWorkerAgentId?: string;
  knownAgentIds: string[];
  plannerAgentId?: string;
  agents: AgentConfig[];
}): string | undefined {
  const compatibleWorkerIds = options.knownAgentIds.filter(
    (agentId) =>
      agentId !== options.plannerAgentId &&
      isAgentCompatibleWithCapabilities(
        options.agents.find((agent) => agent.id === agentId),
        options.requiredCapabilities,
      ),
  );

  if (
    options.preferredAgentCandidate &&
    compatibleWorkerIds.includes(options.preferredAgentCandidate)
  ) {
    return options.preferredAgentCandidate;
  }
  if (
    options.defaultWorkerAgentId &&
    compatibleWorkerIds.includes(options.defaultWorkerAgentId)
  ) {
    return options.defaultWorkerAgentId;
  }
  if (compatibleWorkerIds.length > 0) {
    return compatibleWorkerIds[0];
  }
  if (
    options.preferredAgentCandidate &&
    options.knownAgentIds.includes(options.preferredAgentCandidate)
  ) {
    return options.preferredAgentCandidate;
  }
  return (
    options.defaultWorkerAgentId ??
    options.knownAgentIds.find((agentId) => agentId !== options.plannerAgentId)
  );
}

function toCapabilitySlug(capabilities: string[]): string {
  const normalized = capabilities
    .map((capability) => capability.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
    .map((capability) => capability.replace(/^-+|-+$/g, ""))
    .filter((capability) => capability.length > 0);
  return normalized.join("-") || "planning";
}

function mergeDynamicAgentsIntoConfig(
  sourceConfig: MultiAgentConfig,
  metadata: Record<string, unknown>,
): MultiAgentConfig {
  const dynamicAgents = readDynamicAgents(metadata.dynamicAgents);
  if (dynamicAgents.length === 0) {
    return sourceConfig;
  }

  const existingAgentIds = new Set(sourceConfig.agents.map((agent) => agent.id));
  const mergedAgents = [...sourceConfig.agents];
  for (const dynamicAgent of dynamicAgents) {
    if (existingAgentIds.has(dynamicAgent.id)) {
      continue;
    }
    mergedAgents.push(dynamicAgent);
    existingAgentIds.add(dynamicAgent.id);
  }

  return mergedAgents.length === sourceConfig.agents.length
    ? sourceConfig
    : {
        ...sourceConfig,
        agents: mergedAgents,
      };
}

function readDynamicAgents(value: unknown): AgentConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: AgentConfig[] = [];
  for (const candidate of value) {
    if (!isPlainObject(candidate)) {
      continue;
    }
    const id = readNonEmptyString(candidate.id);
    const command = readNonEmptyString(candidate.command);
    if (!id || !command) {
      continue;
    }

    const profiles = readAgentProfiles(candidate.profiles);
    if (profiles.length === 0) {
      continue;
    }

    const priority =
      typeof candidate.priority === "number" &&
      Number.isFinite(candidate.priority)
        ? Math.floor(candidate.priority)
        : undefined;
    parsed.push({
      id,
      command,
      ...(priority !== undefined ? { priority } : {}),
      profiles,
    });
  }

  return dedupeAgentConfigs(parsed);
}

function readAgentProfiles(value: unknown): AgentProfileConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const profiles: AgentProfileConfig[] = [];
  for (const candidate of value) {
    if (!isPlainObject(candidate)) {
      continue;
    }

    const id = readNonEmptyString(candidate.id);
    const label = readNonEmptyString(candidate.label);
    const capabilities = dedupeStrings(readStringArray(candidate.capabilities));
    const costTier = normalizeCostTier(candidate.costTier);
    if (!id || !label || capabilities.length === 0 || !costTier) {
      continue;
    }

    const defaultArgs = readStringArray(candidate.defaultArgs);
    const defaultCwd = readNonEmptyString(candidate.defaultCwd);
    profiles.push({
      id,
      label,
      capabilities,
      ...(defaultArgs.length > 0 ? { defaultArgs } : {}),
      ...(defaultCwd ? { defaultCwd } : {}),
      costTier,
    });
  }

  return profiles;
}

function normalizeCostTier(value: unknown): AgentProfileConfig["costTier"] | undefined {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : undefined;
}

function normalizeRiskLevel(value: unknown): TaskSpec["riskLevel"] {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "low";
}

function normalizeTimeoutMs(
  value: unknown,
  fallbackMs = DEFAULT_TASK_TIMEOUT_MS,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallbackMs;
  }
  return Math.floor(value);
}

function buildDelegatedTaskDraft(
  template: DelegatedTaskTemplate,
  index: number,
): DelegatedTaskDraft {
  return {
    template,
    index,
    taskId: createId("task"),
    title:
      readNonEmptyString(template.title) ?? `Delegated worker task ${index + 1}`,
  };
}

function buildDelegatedTaskReferenceMap(
  drafts: DelegatedTaskDraft[],
  managerTask: TaskSpec,
): Map<string, string[]> {
  const referenceMap = new Map<string, string[]>();

  addDelegatedTaskReference(referenceMap, managerTask.id, managerTask.id);
  addDelegatedTaskReference(referenceMap, managerTask.title, managerTask.id);

  for (const draft of drafts) {
    addDelegatedTaskReference(referenceMap, draft.taskId, draft.taskId);
    addDelegatedTaskReference(referenceMap, draft.title, draft.taskId);
  }

  return referenceMap;
}

function addDelegatedTaskReference(
  referenceMap: Map<string, string[]>,
  reference: string,
  taskId: string,
): void {
  const normalizedReference = normalizeDelegatedTaskReference(reference);
  if (!normalizedReference) {
    return;
  }

  const existing = referenceMap.get(normalizedReference) ?? [];
  if (!existing.includes(taskId)) {
    referenceMap.set(normalizedReference, [...existing, taskId]);
  }
}

function normalizeDelegatedTaskReference(reference: string): string {
  return reference.trim().replace(/\s+/g, " ").toLowerCase();
}

function resolveDelegatedDependencyTaskIds(options: {
  dependencyRefs: string[];
  currentTaskId: string;
  managerTaskId: string;
  existingTaskIds: Set<string>;
  referenceMap: Map<string, string[]>;
}): string[] {
  const resolvedDependencies = [options.managerTaskId];

  for (const dependencyRef of options.dependencyRefs) {
    const trimmedDependencyRef = dependencyRef.trim();
    if (!trimmedDependencyRef) {
      continue;
    }

    if (options.existingTaskIds.has(trimmedDependencyRef)) {
      if (trimmedDependencyRef !== options.currentTaskId) {
        resolvedDependencies.push(trimmedDependencyRef);
      }
      continue;
    }

    const matches = options.referenceMap.get(
      normalizeDelegatedTaskReference(trimmedDependencyRef),
    );
    if (!matches || matches.length !== 1) {
      continue;
    }

    const dependencyTaskId = matches[0];
    if (dependencyTaskId !== options.currentTaskId) {
      resolvedDependencies.push(dependencyTaskId);
    }
  }

  return dedupeStrings(resolvedDependencies);
}

function buildDelegatedTaskInstructions(options: {
  instructions: string[];
  expectedArtifacts: string[];
  workspacePath: string;
  allowOutsideWorkspaceWrites: boolean;
}): string[] {
  const instructions = options.instructions
    .map((instruction) => instruction.trim())
    .filter((instruction) => instruction.length > 0);
  const expectedArtifacts = options.expectedArtifacts
    .map((artifact) => artifact.trim())
    .filter((artifact) => artifact.length > 0);
  const expectedArtifactDirectories = resolveExpectedArtifactDirectories(
    expectedArtifacts,
    options.workspacePath,
  );

  if (expectedArtifacts.length > 0) {
    instructions.push(`Expected artifacts (exact target paths): ${expectedArtifacts.join(", ")}`);
    instructions.push("Do not replace the requested target paths with alternative folders.");
  }

  if (expectedArtifactDirectories.length > 0) {
    instructions.push(`Primary working directory should be: ${expectedArtifactDirectories[0]}.`);
  }

  if (options.allowOutsideWorkspaceWrites) {
    instructions.push(
      `Outside-workspace writes are allowed for this run. If expected artifacts are outside ${options.workspacePath}, write directly to those target paths.`,
    );
  } else {
    instructions.push(`Do not write outside workspace root: ${options.workspacePath}.`);
  }

  instructions.push(
    "Stay within the delegated task scope and avoid unrelated repository-wide checks unless explicitly required.",
  );

  return dedupeStrings(instructions);
}

function resolveDelegatedWorkingDirectory(options: {
  expectedArtifacts: string[];
  fallbackWorkingDirectory: string;
  workspacePath: string;
  allowOutsideWorkspaceWrites: boolean;
}): string {
  const expectedArtifactDirectories = resolveExpectedArtifactDirectories(
    options.expectedArtifacts,
    options.workspacePath,
  );
  if (expectedArtifactDirectories.length === 0) {
    return options.fallbackWorkingDirectory;
  }

  const commonDirectory = findCommonPathRoot(expectedArtifactDirectories);
  if (!commonDirectory) {
    return options.fallbackWorkingDirectory;
  }

  if (options.allowOutsideWorkspaceWrites) {
    return commonDirectory;
  }

  return isPathInsideRoot(options.workspacePath, commonDirectory)
    ? commonDirectory
    : options.fallbackWorkingDirectory;
}

function resolveExpectedArtifactDirectories(
  expectedArtifacts: string[],
  workspacePath: string,
): string[] {
  const resolvedDirectories = expectedArtifacts
    .map((artifact) => artifact.trim())
    .filter((artifact) => artifact.length > 0)
    .map((artifact) =>
      path.isAbsolute(artifact)
        ? path.resolve(artifact)
        : path.resolve(workspacePath, artifact),
    )
    .map((artifactPath) => path.dirname(artifactPath));
  return dedupeStrings(resolvedDirectories);
}

function findCommonPathRoot(paths: string[]): string | undefined {
  if (paths.length === 0) {
    return undefined;
  }

  let commonRoot = path.resolve(paths[0]!);
  for (const candidate of paths.slice(1)) {
    const resolvedCandidate = path.resolve(candidate);
    while (!isPathInsideRoot(commonRoot, resolvedCandidate)) {
      const parent = path.dirname(commonRoot);
      if (parent === commonRoot) {
        return undefined;
      }
      commonRoot = parent;
    }
  }

  return commonRoot;
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const relativePath = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasMeaningfulGraphPatch(patch: RunGraph["metadata"] extends never ? never : import("../domain/models.js").GraphPatch): boolean {
  switch (patch.operation) {
    case "append_tasks":
      return (patch.tasks?.length ?? 0) > 0;
    case "cancel_pending_tasks":
      return (patch.targetTaskIds?.length ?? 0) > 0;
    case "replace_pending_subgraph":
      return (patch.targetTaskIds?.length ?? 0) > 0 && (patch.tasks?.length ?? 0) > 0;
    default:
      return false;
  }
}

function summarizeApprovalReason(
  actions: Array<{ kind: string; reason: string }>,
): string {
  const descriptions = actions.map((action) => `${action.kind}: ${action.reason}`);
  return `Approval required for actions: ${descriptions.join("; ")}`;
}

function mapValidationOutcomeToTaskStatus(
  result: ValidationResult,
  task: TaskSpec,
  attempts: number,
): TaskSpec["status"] {
  if (result.outcome === "blocked") {
    return "blocked";
  }
  if (result.outcome === "fail_retryable" && attempts < task.retryPolicy.maxAttempts) {
    return "failed_retryable";
  }
  return "failed_terminal";
}

function summarizeCommandResult(
  eventType: RunEvent["type"],
  exitCode: number | null,
): string {
  if (eventType === "task_completed") {
    return `Command completed with exit code ${exitCode ?? 0}.`;
  }
  return `Command failed with exit code ${exitCode ?? -1}.`;
}

function extractStructuredOutputFromPayload(
  payload: Record<string, unknown>,
): unknown {
  if ("structuredOutput" in payload) {
    return payload.structuredOutput;
  }
  if ("structured_output" in payload) {
    return payload.structured_output;
  }
  if ("output" in payload) {
    return payload.output;
  }
  return undefined;
}

function buildBlackboardProjection(
  event: RunEvent,
):
  | {
      id: string;
      scope: "planner" | "agent" | "validation" | "approval";
      summary: string;
      references: string[];
    }
  | null {
  const payload = event.payload as Record<string, unknown>;
  const eventRef = `event://${event.runId}/${event.id}`;

  switch (event.type) {
    case "task_planned":
      return {
        id: `planner:${event.taskId ?? "run"}:task_planned`,
        scope: "planner",
        summary: `Planned task ${String(payload.title ?? event.taskId ?? "unknown")}.`,
        references: [eventRef],
      };
    case "agent_selected":
      return {
        id: `agent:${event.taskId ?? "run"}:agent_selected`,
        scope: "agent",
        summary: `Selected agent ${String(payload.agentId ?? "unknown")} for ${event.taskId ?? "run"}.`,
        references: [eventRef],
      };
    case "context_built":
      return {
        id: `agent:${event.taskId ?? "run"}:context_built`,
        scope: "agent",
        summary: `Built context with ${String(payload.relevantFacts ?? 0)} facts and ${String(payload.artifactSummaries ?? 0)} artifact summaries.`,
        references: [eventRef],
      };
    case "invocation_planned":
      return {
        id: `agent:${event.taskId ?? "run"}:invocation_planned`,
        scope: "agent",
        summary: `Planned invocation ${String(payload.command ?? "unknown")} for ${event.taskId ?? "run"}.`,
        references: [eventRef],
      };
    case "approval_requested":
      return {
        id: `approval:${event.taskId ?? "run"}:approval_requested`,
        scope: "approval",
        summary: `Approval requested for ${String(payload.actionCount ?? 0)} action(s).`,
        references: [eventRef],
      };
    case "approval_decided":
      return {
        id: `approval:${event.taskId ?? "run"}:approval_decided`,
        scope: "approval",
        summary: `Approval ${String(payload.decision ?? "unknown")} by ${String(payload.actor ?? "unknown")}.`,
        references: [eventRef],
      };
    case "validation_started":
      return {
        id: `validation:${event.taskId ?? "run"}:validation_started`,
        scope: "validation",
        summary: `Validation started in ${String(payload.validatorMode ?? "unknown")} mode.`,
        references: [eventRef],
      };
    case "validation_passed":
      return {
        id: `validation:${event.taskId ?? "run"}:validation_passed`,
        scope: "validation",
        summary: String(payload.summary ?? "Validation passed."),
        references: [eventRef],
      };
    case "validation_failed":
      return {
        id: `validation:${event.taskId ?? "run"}:validation_failed`,
        scope: "validation",
        summary: String(payload.summary ?? `Validation failed with ${String(payload.outcome ?? "unknown")}.`),
        references: [eventRef],
      };
    case "replan_requested":
      return {
        id: `planner:${event.taskId ?? "run"}:replan_requested`,
        scope: "planner",
        summary: String(payload.summary ?? "Replan requested."),
        references: [eventRef],
      };
    case "replan_applied":
      return {
        id: `planner:${event.taskId ?? "run"}:replan_applied`,
        scope: "planner",
        summary: `Applied ${String(payload.operation ?? "unknown")} patch.`,
        references: [eventRef],
      };
    default:
      return null;
  }
}

async function captureFileManifest(rootDir: string): Promise<FileManifest> {
  const manifest: FileManifest = new Map();
  const ignoredDirectories = new Set([".git", ".multi-agent", "dist", "node_modules"]);

  const visit = async (directoryPath: string): Promise<void> => {
    if (!(await pathExists(directoryPath))) {
      return;
    }

    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join("/");

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }
        await visit(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        const fileStat = await stat(absolutePath);
        manifest.set(relativePath, {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
        });
      }
    }
  };

  await visit(rootDir);
  return manifest;
}

function diffFileManifest(before: FileManifest, after: FileManifest): Array<{
  path: string;
  changeType: "added" | "modified" | "deleted";
}> {
  const changes: Array<{ path: string; changeType: "added" | "modified" | "deleted" }> = [];
  const allPaths = [...new Set([...before.keys(), ...after.keys()])].sort();

  for (const filePath of allPaths) {
    const previous = before.get(filePath);
    const current = after.get(filePath);
    if (!previous && current) {
      changes.push({ path: filePath, changeType: "added" });
      continue;
    }
    if (previous && !current) {
      changes.push({ path: filePath, changeType: "deleted" });
      continue;
    }
    if (
      previous &&
      current &&
      (previous.size !== current.size || previous.mtimeMs !== current.mtimeMs)
    ) {
      changes.push({ path: filePath, changeType: "modified" });
    }
  }

  return changes;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function resolveSelectedCli(value: unknown): SelectedCli | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();
  if (isSelectedCli(normalizedValue)) {
    return normalizedValue;
  }

  return undefined;
}

function shouldFallbackToDefaultSelectedCli(
  metadata: Record<string, unknown>,
): boolean {
  return (
    metadata.selectedCli === undefined &&
    metadata.plannerMode === undefined &&
    metadata.plannerAgentId === undefined &&
    metadata.agentIds === undefined
  );
}

function shouldKeepDelegatedConfigForSelectedCli(
  metadata: Record<string, unknown>,
  selectedCli: SelectedCli,
  sourceConfig: MultiAgentConfig,
): boolean {
  const plannerAgentId = readNonEmptyString(metadata.plannerAgentId);
  if (!plannerAgentId || plannerAgentId !== selectedCli) {
    return false;
  }

  const configuredAgentIds = readStringArray(metadata.agentIds);
  if (!configuredAgentIds.includes(plannerAgentId)) {
    return false;
  }

  const availableAgentIds = new Set(sourceConfig.agents.map((agent) => agent.id));
  if (!availableAgentIds.has(plannerAgentId)) {
    return false;
  }

  return configuredAgentIds.some(
    (agentId) => agentId !== plannerAgentId && availableAgentIds.has(agentId),
  );
}

function isSelectedCli(value: string): value is SelectedCli {
  return (SELECTED_CLI_VALUES as readonly string[]).includes(value);
}






