import { createDefaultConfig } from "../../../config/default-config.js";
import type {
MultiAgentConfig
} from "../../../domain/config.js";
import type {
ApprovalDecision,
RunInspection,
RunRecord,
RunRequest
} from "../../../domain/models.js";
import {
SCHEMA_VERSION,
assertRunStatusTransition,
deriveRunName,
} from "../../../domain/models.js";
import { createId,isoNow } from "../../../shared/runtime.js";
import { InspectionAggregator } from "../../inspection-aggregator.js";
import type { RunCoordinatorMethodThis } from "../internal-types.js";
import {
resolvePlannerMode,
shouldUseDelegatedBootstrap
} from "../helpers/index.js";

export async function startRun(this: RunCoordinatorMethodThis,
  request: RunRequest): Promise<RunRecord> {
    const runId = createId("run");
    const timestamp = isoNow();
    const runName = deriveRunName(request.name ?? request.goal);
    const run: RunRecord = {
      schemaVersion: SCHEMA_VERSION,
      runId,
      name: runName,
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
        name: runName,
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

export async function resumeRun(this: RunCoordinatorMethodThis,
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

export async function inspectRun(this: RunCoordinatorMethodThis,
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

export async function listPendingApprovals(this: RunCoordinatorMethodThis,
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

export async function decideApproval(this: RunCoordinatorMethodThis,
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

