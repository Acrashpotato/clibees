import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  ApprovalDecision,
  ArtifactRecord,
  InvocationPlan,
  RunEvent,
  RunGraph,
  RunInspection,
  RunRecord,
  RunRequest,
  TaskSpec,
  ValidationResult,
} from "../domain/models.js";
import {
  SCHEMA_VERSION,
  assertRunStatusTransition,
} from "../domain/models.js";
import type { MultiAgentConfig } from "../domain/config.js";
import { createDefaultConfig } from "../config/default-config.js";
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
import type { WorkspaceStateStore } from "../storage/workspace-state-store.js";
import { FileWorkspaceStateStore } from "../storage/workspace-state-store.js";
import { createId, isoNow, pathExists, resolvePath } from "../shared/runtime.js";
import { GraphManager } from "./graph-manager.js";
import { InspectionAggregator } from "./inspection-aggregator.js";
import { MemoryConsolidator } from "./memory-consolidator.js";
import { Scheduler } from "./scheduler.js";

export interface RunCoordinatorDependencies {
  planner: Planner;
  graphManager: GraphManager;
  runStore: RunStore;
  eventStore: EventStore;
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

type FileManifest = Map<string, { size: number; mtimeMs: number }>;

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

    const tasks = await this.dependencies.planner.createInitialPlan({
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

    const resolvedConfig = options.config ?? createDefaultConfig(run.workspacePath);
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

    const resolvedConfig = options.config ?? createDefaultConfig(run.workspacePath);
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
      services,
      { bypassApproval: true },
    );

    return this.executeReadyTasks(outcome.run, outcome.graph, resolvedConfig);
  }

  private async executeReadyTasks(
    run: RunRecord,
    graph: RunGraph,
    config: MultiAgentConfig | undefined,
  ): Promise<RunRecord> {
    const resolvedConfig = config ?? createDefaultConfig(run.workspacePath);
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
      const outcome = await this.processTask(currentRun, currentGraph, task, services);
      currentRun = outcome.run;
      currentGraph = outcome.graph;

      if (outcome.halted) {
        return currentRun;
      }
    }
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
      return this.validateTask(run, graph, task, invocation, attempts, services);
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
      currentGraph = services.scheduler.onTaskCompleted(currentGraph, task.id);
      await this.dependencies.runStore.saveGraph(run.runId, currentGraph);
      await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
        status: "completed",
        attempts,
        finishedAt: isoNow(),
      });
      return (await this.dependencies.runStore.getGraph(run.runId)) ?? currentGraph;
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
    if (run.status !== status) {
      assertRunStatusTransition(run.status, status);
    }

    const nextRun: RunRecord = {
      ...run,
      status,
      ...(currentTaskId ? { currentTaskId } : { currentTaskId: undefined }),
      updatedAt: isoNow(),
    };
    await this.dependencies.runStore.updateRun(nextRun);
    return nextRun;
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






