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

type FileManifest = Map<string, { size: number; mtimeMs: number }>;

export async function recoverGraphForResume(this: any,
  run: RunRecord,
  services: ExecutionServices): Promise<{ graph: RunGraph; waitingApprovalTaskId?: string }> {
    const pendingApprovals = await services.approvalManager.listPending(run.runId);
    const pendingApprovalTaskIds = new Set(pendingApprovals.map((request) => request.taskId));

    for (const request of pendingApprovals) {
      const currentGraph = await this.dependencies.runStore.getGraph(run.runId);
      const task = currentGraph?.tasks[request.taskId];
      if (task && task.status !== "awaiting_approval") {
        await this.dependencies.runStore.updateTaskStatus(run.runId, request.taskId, "awaiting_approval");
      }
    }

    const graph = (await this.dependencies.runStore.getGraph(run.runId)) as RunGraph | undefined;
    if (!graph) {
      throw new Error(`Run graph "${run.runId}" was not found.`);
    }

    for (const task of Object.values(graph.tasks) as TaskSpec[]) {
      if (pendingApprovalTaskIds.has(task.id)) {
        continue;
      }

      if (task.status === "awaiting_approval") {
        await this.dependencies.runStore.updateTaskStatus(run.runId, task.id, {
          status: "queued",
          finishedAt: null,
        });
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

export async function replanGraph(this: any,
  run: RunRecord,
  graph: RunGraph,
  task: TaskSpec,
  result: ValidationResult,
  attempts: number,
  services: ExecutionServices): Promise<RunGraph> {
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
        appendedTaskIds: patch.tasks?.map((plannedTask: TaskSpec) => plannedTask.id) ?? [],
        targetTaskIds: patch.targetTaskIds ?? [],
      }),
      services.blackboardStore,
    );

    return (await this.dependencies.runStore.getGraph(run.runId)) ?? patchedGraph;
  }

export async function archiveExecutionArtifacts(this: any,
  runId: string,
  taskId: string,
  invocation: InvocationPlan,
  finalEvent: RunEvent,
  beforeManifest: FileManifest,
  afterManifest: FileManifest,
  services: ExecutionServices): Promise<void> {
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

export async function recordArtifact(this: any,
  runId: string,
  taskId: string | undefined,
  kind: ArtifactRecord["kind"],
  services: ExecutionServices,
  uri: string,
  summary: string,
  metadata: Record<string, unknown>): Promise<ArtifactRecord> {
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

export async function appendProjectedEvent(this: any,
  event: RunEvent,
  blackboardStore: BlackboardStore): Promise<void> {
    await this.dependencies.eventStore.append(event);
    await this.projectEventToBlackboard(event, blackboardStore);
  }

export async function projectEventToBlackboard(this: any,
  event: RunEvent,
  blackboardStore: BlackboardStore): Promise<void> {
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

export function resolveBlackboardStore(this: any,
  workspacePath: string): BlackboardStore {
    return (
      this.dependencies.blackboardStore ??
      new FileBlackboardStore(resolvePath(".multi-agent/state", workspacePath))
    );
  }

export async function finalizeRun(this: any,
  run: RunRecord,
  status: "completed" | "failed",
  graph: RunGraph,
  services: ExecutionServices): Promise<RunRecord> {
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

export async function persistRunMemory(this: any,
  run: RunRecord,
  graph: RunGraph,
  services: ExecutionServices): Promise<void> {
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

export async function updateRunRecord(this: any,
  run: RunRecord,
  status: RunRecord["status"],
  currentTaskId?: string): Promise<RunRecord> {
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

export function resolveRunExecutionConfig(this: any,
  run: RunRecord,
  baseConfig?: MultiAgentConfig): MultiAgentConfig {
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

export function createEvent(this: any,
  type: RunEvent["type"],
  runId: string,
  payload: Record<string, unknown>): RunEvent {
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
