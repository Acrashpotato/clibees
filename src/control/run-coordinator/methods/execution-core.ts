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

export async function executeReadyTasks(this: any,
  run: RunRecord,
  graph: RunGraph,
  config: MultiAgentConfig | undefined): Promise<RunRecord> {
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

export async function handleTaskProcessingFailure(this: any,
  run: RunRecord,
  graph: RunGraph,
  task: TaskSpec,
  error: unknown,
  services: ExecutionServices): Promise<RunRecord> {
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

export function resolveExecutionServices(this: any,
  run: RunRecord,
  config: MultiAgentConfig): ExecutionServices {
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

export async function processTask(this: any,
  run: RunRecord,
  graph: RunGraph,
  task: TaskSpec,
  runConfig: MultiAgentConfig,
  services: ExecutionServices,
  options: { bypassApproval?: boolean } = {}): Promise<TaskProcessingResult> {
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

    const executedGraph = await this.executeInvocation(
      run,
      plannedGraph,
      currentTask,
      invocation,
      runConfig,
      services,
    );
    const executedTask = executedGraph.tasks[task.id];
    if (executedTask?.status === "awaiting_approval") {
      return {
        graph: executedGraph,
        run: await this.updateRunRecord(run, "waiting_approval", task.id),
        halted: true,
      };
    }

    return {
      graph: executedGraph,
      run,
      halted: false,
    };
  }

export async function planTaskInvocation(this: any,
  run: RunRecord,
  graph: RunGraph,
  task: TaskSpec,
  services: ExecutionServices,
  options: { trackTransitions: boolean }): Promise<{ graph: RunGraph; invocation: InvocationPlan }> {
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
