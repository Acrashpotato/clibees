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
import {
  createStateLayout,
  getTaskTranscriptPath,
} from "../../../storage/state-layout.js";
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

export async function startRun(this: any,
  request: RunRequest): Promise<RunRecord> {
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

export async function resumeRun(this: any,
  runId: string,
  options: { config?: MultiAgentConfig } = {}): Promise<RunRecord> {
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
    let latestRun = run;
    let latestGraph = graph;
    latestRun = await this.autoPauseStalledRunIfNeeded(
      latestRun,
      latestGraph,
      services,
      "resume",
    );
    latestRun = (await this.dependencies.runStore.getRun(runId)) ?? latestRun;
    latestGraph = (await this.dependencies.runStore.getGraph(runId)) ?? latestGraph;
    if (run.status === "running" && latestRun.status === "paused") {
      return latestRun;
    }

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
      return this.updateRunRecord(latestRun, "paused");
    }

    const recovered = await this.recoverGraphForResume(latestRun, services);
    if (recovered.waitingApprovalTaskId) {
      return this.updateRunRecord(
        latestRun,
        "waiting_approval",
        recovered.waitingApprovalTaskId,
      );
    }

    const resumableRun =
      latestRun.status === "paused" || latestRun.status === "waiting_approval"
        ? await this.updateRunRecord(latestRun, "ready")
        : latestRun;

    return this.executeReadyTasks(resumableRun, recovered.graph, resolvedConfig);
  }

export async function inspectRun(this: any,
  runId: string): Promise<RunInspection> {
    const run = await this.dependencies.runStore.getRun(runId);
    const graph = await this.dependencies.runStore.getGraph(runId);

    if (!run || !graph) {
      throw new Error(`Run "${runId}" is incomplete or missing.`);
    }

    const services = this.resolveExecutionServices(
      run,
      createDefaultConfig(run.workspacePath),
    );
    const stabilizedRun = await this.autoPauseStalledRunIfNeeded(
      run,
      graph,
      services,
      "inspect",
    );
    const effectiveRun = (await this.dependencies.runStore.getRun(runId)) ?? stabilizedRun;
    const effectiveGraph = (await this.dependencies.runStore.getGraph(runId)) ?? graph;
    const events = await this.dependencies.eventStore.list(runId);
    const aggregator = new InspectionAggregator({
      artifactStore: services.artifactStore,
      blackboardStore: services.blackboardStore,
      approvalManager: services.approvalManager,
    });

    return aggregator.build(effectiveRun, effectiveGraph, events);
  }

export async function listPendingApprovals(this: any,
  runId: string) {
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

export async function decideApproval(this: any,
  runId: string,
  requestId: string,
  decision: ApprovalDecision,
  actor: string,
  note?: string,
  options: { config?: MultiAgentConfig } = {}): Promise<RunRecord> {
    const run = await this.dependencies.runStore.getRun(runId);
    const graph = await this.dependencies.runStore.getGraph(runId);

    if (!run || !graph) {
      throw new Error(`Run "${runId}" was not found.`);
    }

    const resolvedConfig = this.resolveRunExecutionConfig(run, options.config);
    const services = this.resolveExecutionServices(run, resolvedConfig);
    const request = (await services.approvalManager.listPending(runId)).find(
      (candidate: { id: string }) => candidate.id === requestId,
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

    if (outcome.halted) {
      return outcome.run;
    }

    return this.executeReadyTasks(outcome.run, outcome.graph, resolvedConfig);
  }

