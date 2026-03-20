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
} from "../../../domain/models.js";
import {
  SCHEMA_VERSION,
  assertRunStatusTransition,
} from "../../../domain/models.js";
import type {
  AgentConfig,
  AgentProfileConfig,
  MultiAgentConfig,
} from "../../../domain/config.js";
import { createDefaultConfig } from "../../../config/default-config.js";
import { buildRunConfigForSelectedCli } from "../../../config/run-cli-config.js";
import { ConfiguredCliAdapter } from "../../../adapters/configured-cli-adapter.js";
import {
  DefaultContextAssembler,
  type ContextAssembler,
} from "../../../decision/context-assembler.js";
import { DefaultValidator, type Validator } from "../../../decision/validator.js";
import type { Planner } from "../../../decision/planner.js";
import {
  RuleBasedRouter,
  type Router,
} from "../../../decision/router.js";
import type { AdapterRegistry } from "../../../execution/adapter-registry.js";
import { createAdapterRegistry } from "../../../execution/create-adapter-registry.js";
import {
  FileApprovalManager,
  type ApprovalManager,
} from "../../../execution/approval-manager.js";
import {
  ProcessExecutionRuntime,
  type ExecutionRuntime,
} from "../../../execution/execution-runtime.js";
import { SafetyManager } from "../../../execution/safety-manager.js";
import type { ArtifactStore } from "../../../storage/artifact-store.js";
import { FileArtifactStore } from "../../../storage/artifact-store.js";
import type { BlackboardStore } from "../../../storage/blackboard-store.js";
import { FileBlackboardStore } from "../../../storage/blackboard-store.js";
import type { EventStore } from "../../../storage/event-store.js";
import type { ProjectMemoryStore } from "../../../storage/project-memory-store.js";
import type { RunStore } from "../../../storage/run-store.js";
import type { SessionStore } from "../../../storage/session-store.js";
import type { WorkspaceStateStore } from "../../../storage/workspace-state-store.js";
import { FileWorkspaceStateStore } from "../../../storage/workspace-state-store.js";
import { createId, isoNow, pathExists, resolvePath } from "../../../shared/runtime.js";
import { SELECTED_CLI_VALUES, type SelectedCli } from "../../../ui-api/selected-cli.js";
import { GraphManager } from "../../graph-manager.js";
import { InspectionAggregator } from "../../inspection-aggregator.js";
import { MemoryConsolidator } from "../../memory-consolidator.js";
import { Scheduler } from "../../scheduler.js";
import type {
  DelegatedTaskTemplate,
  ExecutionServices,
  ManagerCoordinationOutput,
  PostThreadMessageInput,
  PostThreadMessageResult,
  TaskProcessingResult,
} from "../core.js";
import {
  DEFAULT_DELEGATED_TASK_TIMEOUT_MS,
  DEFAULT_SELECTED_CLI,
  DEFAULT_TASK_TIMEOUT_MS,
  MANAGER_PRIMARY_SESSION_ID,
  MANAGER_PRIMARY_THREAD_ID,
  MAX_DELEGATED_TASKS,
  MAX_MANAGER_COORDINATION_TASKS,
} from "../core.js";
import {
  addDelegatedTaskReference,
  applyWorkspaceWritePolicyOverride,
  buildBlackboardProjection,
  buildDelegatedTaskDraft,
  buildDelegatedTaskInstructions,
  buildDelegatedTaskReferenceMap,
  buildDelegationManagerGoal,
  buildDelegationTaskTitle,
  capitalize,
  captureFileManifest,
  classifyManagerUserMessageIntent,
  countActiveManagerCoordinationTasks,
  dedupeAgentConfigs,
  dedupeStrings,
  diffFileManifest,
  extractStructuredOutputFromPayload,
  findCommonPathRoot,
  getActiveDelegationManagerTaskIds,
  hasCompatibleWorkerForCapabilities,
  hasMeaningfulGraphPatch,
  isAgentCompatibleWithCapabilities,
  isAutoResumableRunStatus,
  isDelegationManagerTask,
  isManagerCoordinationTask,
  isTaskTerminalStatus,
  isPathInsideRoot,
  isPlainObject,
  isSelectedCli,
  isTerminalRunStatus,
  mapValidationOutcomeToTaskStatus,
  mergeDynamicAgentsIntoConfig,
  normalizeCostTier,
  normalizeDelegatedTaskReference,
  normalizeRiskLevel,
  normalizeTimeoutMs,
  pickWorkerAgentForCapabilities,
  readAgentProfiles,
  readDynamicAgents,
  type ManagerUserMessageIntent,
  readNonEmptyString,
  readOptionalBoolean,
  readStringArray,
  resolveDelegatedDependencyTaskIds,
  resolveDelegatedWorkingDirectory,
  resolveExpectedArtifactDirectories,
  resolvePlannerMode,
  resolveSelectedCli,
  shouldFallbackToDefaultSelectedCli,
  shouldKeepDelegatedConfigForSelectedCli,
  shouldUseDelegatedBootstrap,
  summarizeApprovalReason,
  summarizeCommandResult,
  toCapabilitySlug,
} from "../helpers/index.js";
import {
  findManagerCoordinationByTriggerMessageId,
  summarizeNonTerminalTasksForCoordination,
} from "./coordination-helpers.js";

export async function interactSession(this: any,
  runId: string,
  sessionId: string,
  input: PostThreadMessageInput): Promise<PostThreadMessageResult> {
    const session = await this.dependencies.sessionStore.getSession(runId, sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" was not found in run "${runId}".`);
    }
    return this.postThreadMessage(runId, session.threadId, input);
  }

export async function ensureManagerSession(this: any,
  runId: string): Promise<{ session: TaskSessionRecord; thread: MessageThreadRecord }> {
    const run = await this.dependencies.runStore.getRun(runId);
    const graph = await this.dependencies.runStore.getGraph(runId);
    if (!run || !graph) {
      throw new Error(`Run "${runId}" was not found.`);
    }
    return this.ensureDelegatedManagerSession(run, graph);
  }

export async function ensureDelegatedManagerSession(this: any,
  run: RunRecord,
  graph: RunGraph): Promise<{ session: TaskSessionRecord; thread: MessageThreadRecord }> {
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

export function resolveIncomingMessageRole(this: any,
  run: RunRecord,
  session: TaskSessionRecord | null,
  actorId: string): SessionMessageRecord["role"] {
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

export async function appendThreadMessageWithAudit(this: any,
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
  taskId?: string): Promise<SessionMessageRecord> {
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

export async function enqueueManagerCoordinationTask(this: any,
  run: RunRecord,
  graph: RunGraph,
  triggerMessage: SessionMessageRecord,
  services: ExecutionServices,
  options: {
    activeManagerStrategy?: "skip_if_active" | "append_followup";
    triggerIntent?: ManagerUserMessageIntent;
  } = {}): Promise<RunGraph> {
    if (!shouldUseDelegatedBootstrap(run.metadata)) {
      return graph;
    }
    const activeManagerStrategy = options.activeManagerStrategy ?? "skip_if_active";
    if (findManagerCoordinationByTriggerMessageId(graph, triggerMessage.messageId)) {
      return graph;
    }
    const activeCoordinationTaskCount = countActiveManagerCoordinationTasks(graph);
    const historicalCoordinationTaskCount = Object.values(graph.tasks).filter((task) =>
      isManagerCoordinationTask(task),
    ).length;
    const hasReachedCoordinationLimit =
      activeManagerStrategy === "append_followup"
        ? activeCoordinationTaskCount >= MAX_MANAGER_COORDINATION_TASKS
        : historicalCoordinationTaskCount >= MAX_MANAGER_COORDINATION_TASKS;
    if (hasReachedCoordinationLimit) {
      return graph;
    }
    const activeManagerTaskIds = getActiveDelegationManagerTaskIds(graph);
    if (activeManagerStrategy === "skip_if_active" && activeManagerTaskIds.length > 0) {
      return graph;
    }
    const managerTaskDependencies =
      activeManagerStrategy === "append_followup"
        ? [...new Set(activeManagerTaskIds)]
        : [];

    const existingManager = await this.ensureDelegatedManagerSession(run, graph);
    const recentMessages = await this.dependencies.sessionStore.listMessages(
      run.runId,
      existingManager.thread.threadId,
    );
    const availableSkillSummary = await this.buildAvailableSkillSummary(
      run,
      services,
    );
    const triggerIntent =
      options.triggerIntent ??
      (triggerMessage.role === "user"
        ? classifyManagerUserMessageIntent(triggerMessage.body)
        : "other");
    const managerTask = this.buildManagerCoordinationTask(
      run,
      graph,
      triggerMessage,
      recentMessages,
      availableSkillSummary,
      {
        dependsOn: managerTaskDependencies,
        triggerIntent,
      },
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

export function buildManagerCoordinationTask(this: any,
  run: RunRecord,
  graph: RunGraph,
  triggerMessage: SessionMessageRecord,
  recentMessages: SessionMessageRecord[],
  availableSkillSummary: string[] = [],
  options: {
    dependsOn?: string[];
    triggerIntent?: ManagerUserMessageIntent;
  } = {}): TaskSpec {
    const managerAgentId = readNonEmptyString(run.metadata.plannerAgentId);
    const workerAgentIds = readStringArray(run.metadata.agentIds).filter(
      (agentId) => agentId !== managerAgentId,
    );
    const triggerSource =
      typeof triggerMessage.metadata?.source === "string" &&
      triggerMessage.metadata.source.trim().length > 0
        ? triggerMessage.metadata.source.trim()
        : "unknown";
    const recentContext = recentMessages
      .slice(-6)
      .map((message) => {
        const compactBody = message.body.replace(/\s+/g, " ").trim();
        return `[${message.role}] ${message.actorId}: ${compactBody.slice(0, 320)}`;
      })
      .join("\n");
    const availableSkillIds = availableSkillSummary
      .map((item) => item.split(":")[0]?.trim())
      .filter((item): item is string => Boolean(item));
    const triggerIntent = options.triggerIntent ?? "other";
    const nonTerminalTaskSummary = summarizeNonTerminalTasksForCoordination(graph);
    const intentGuardInstruction =
      triggerIntent === "progress_query"
        ? "This trigger is a progress query. You must set managerDecision=no_more_tasks and provide status-only managerReply."
        : triggerIntent === "other"
          ? "Unless the trigger clearly requests requirement changes, prefer managerDecision=no_more_tasks with a concise status reply."
          : "If existing non-terminal tasks already cover the goal, avoid duplicate delegation and prefer managerDecision=no_more_tasks.";

    return {
      id: createId("task"),
      title: "Manager coordination",
      kind: "plan",
      goal: buildDelegationManagerGoal(run.goal, workerAgentIds, availableSkillIds),
      instructions: [
        "Review the latest manager thread conversation and coordinate follow-up work.",
        "Inspect current non-terminal tasks first and avoid delegating duplicate work.",
        "Return JSON only with managerReply, managerDecision, and delegatedTasks.",
        "Use dependsOn when a delegated worker task must wait for another delegated task.",
        "Use managerDecision=no_more_tasks when no further worker delegation is needed.",
        intentGuardInstruction,
      ],
      inputs: [
        `Trigger message ${triggerMessage.messageId} from ${triggerMessage.actorId}: ${triggerMessage.body}`,
        `Trigger intent classification: ${triggerIntent}`,
        `Current non-terminal task summary:\n${nonTerminalTaskSummary}`,
        `Recent manager thread context:\n${recentContext || "(no prior messages)"}`,
        `Available workflow skills:\n${availableSkillSummary.length > 0 ? availableSkillSummary.join("\n") : "(none)"}`,
      ],
      dependsOn: [...new Set(options.dependsOn ?? [])],
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
      metadata: {
        triggerMessageId: triggerMessage.messageId,
        triggerRole: triggerMessage.role,
        triggerActorId: triggerMessage.actorId,
        triggerSource,
        triggerIntent,
      },
      status: "pending",
    };
  }

export async function reportWorkerCompletionToManager(this: any,
  run: RunRecord,
  graph: RunGraph,
  task: TaskSpec,
  services: ExecutionServices): Promise<RunGraph> {
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
    const hasRunnableNonManagerTasks = Object.values(graph.tasks).some((candidate) => {
      if (candidate.id === task.id) {
        return false;
      }
      if (isDelegationManagerTask(candidate)) {
        return false;
      }
      return (
        candidate.status === "ready" ||
        candidate.status === "pending" ||
        candidate.status === "running"
      );
    });
    if (hasRunnableNonManagerTasks) {
      return (await this.dependencies.runStore.getGraph(run.runId)) ?? graph;
    }
    return this.enqueueManagerCoordinationTask(run, graph, completionMessage, services, {
      activeManagerStrategy: "skip_if_active",
    });
  }

