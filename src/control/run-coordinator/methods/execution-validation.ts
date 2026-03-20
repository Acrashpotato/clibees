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
  classifyExecutionFailure,
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
  shouldRetryExecutionFailure,
  shouldFallbackToDefaultSelectedCli,
  shouldKeepDelegatedConfigForSelectedCli,
  shouldUseDelegatedBootstrap,
  summarizeApprovalReason,
  summarizeCommandResult,
  toCapabilitySlug,
} from "../helpers/index.js";

export async function executeInvocation(this: any,
  run: RunRecord,
  graph: RunGraph,
  task: TaskSpec,
  invocation: InvocationPlan,
  runConfig: MultiAgentConfig,
  services: ExecutionServices): Promise<RunGraph> {
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

    const failure = classifyExecutionFailure(finalEvent);
    if (failure.kind === "policy_blocked") {
      const actionPlan = {
        id: createId("action"),
        kind: "runtime_policy_override",
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.cwd,
        targets: task.expectedArtifacts,
        riskLevel: "high" as const,
        requiresApproval: true,
        reason: failure.summary,
      };
      const request = await services.approvalManager.createRequest(
        run.runId,
        task.id,
        [actionPlan],
        summarizeApprovalReason([actionPlan]),
        invocation,
      );
      await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
        status: "awaiting_approval",
        attempts,
        finishedAt: null,
      });
      await this.appendProjectedEvent(
        this.createEvent("approval_requested", run.runId, {
          taskId: task.id,
          requestId: request.id,
          reason: request.reason,
          actionKinds: [actionPlan.kind],
          actionCount: 1,
          source: "runtime_failure",
          failureKind: failure.kind,
          markers: failure.markers,
        }),
        services.blackboardStore,
      );
      await this.recordArtifact(
        run.runId,
        task.id,
        "approval_record",
        services,
        `artifact://run/${run.runId}/task/${task.id}/approval/${request.id}/request`,
        "Approval requested after runtime sandbox/policy failure.",
        {
          requestId: request.id,
          reason: request.reason,
          actionPlans: [actionPlan],
          invocation,
          runtimeFailure: {
            kind: failure.kind,
            summary: failure.summary,
            markers: failure.markers,
            payload: finalEvent.payload,
          },
        },
      );
      return (await this.dependencies.runStore.getGraph(run.runId)) ?? graph;
    }

    const nextStatus = shouldRetryExecutionFailure(task, attempts, failure)
      ? "failed_retryable"
      : "failed_terminal";
    await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
      status: nextStatus,
      attempts,
      finishedAt: finalEvent.timestamp,
    });
    return (await this.dependencies.runStore.getGraph(run.runId)) ?? graph;
  }

export async function validateTask(this: any,
  run: RunRecord,
  graph: RunGraph,
  task: TaskSpec,
  invocation: InvocationPlan,
  attempts: number,
  runConfig: MultiAgentConfig,
  services: ExecutionServices): Promise<RunGraph> {
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
      if (currentGraph.tasks[task.id]?.status === "awaiting_approval") {
        return currentGraph;
      }
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
