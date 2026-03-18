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
  dedupeAgentConfigs,
  dedupeStrings,
  diffFileManifest,
  extractStructuredOutputFromPayload,
  findCommonPathRoot,
  hasActiveDelegationManagerTask,
  hasCompatibleWorkerForCapabilities,
  hasMeaningfulGraphPatch,
  isAgentCompatibleWithCapabilities,
  isAutoResumableRunStatus,
  isDelegationManagerTask,
  isManagerCoordinationTask,
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

export function buildDelegatedBootstrapTasks(this: any,
  request: RunRequest): TaskSpec[] {
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

export async function appendDelegatedTasksIfNeeded(this: any,
  run: RunRecord,
  graph: RunGraph,
  task: TaskSpec,
  artifacts: ArtifactRecord[],
  runConfig: MultiAgentConfig,
  services: ExecutionServices): Promise<RunGraph> {
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
    const delegatedTaskDrafts = delegatedTemplates.map((template: DelegatedTaskTemplate, index: number) =>
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
          activeConfig.agents.find((candidate: AgentConfig) => candidate.id === agentId),
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
      .map((draft: (typeof delegatedTaskDrafts)[number]) =>
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
      .filter((candidate: TaskSpec | null): candidate is TaskSpec => candidate !== null);

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
        appendedTaskIds: delegatedTasks.map((delegatedTask: TaskSpec) => delegatedTask.id),
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

export function buildFallbackDelegatedTask(this: any,
  run: RunRecord,
  managerTask: TaskSpec,
  workerAgentId: string): TaskSpec {
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

export function extractLatestStructuredOutput(this: any,
  artifacts: ArtifactRecord[]): unknown {
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

export function extractManagerCoordinationOutput(this: any,
  value: unknown): ManagerCoordinationOutput {
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

export function extractDelegatedTaskTemplates(this: any,
  value: unknown): DelegatedTaskTemplate[] {
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
