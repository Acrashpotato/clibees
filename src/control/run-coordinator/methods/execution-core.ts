import {
DefaultContextAssembler
} from "../../../decision/context-assembler.js";
import {
RuleBasedRouter
} from "../../../decision/router.js";
import { DefaultValidator } from "../../../decision/validator.js";
import type {
MultiAgentConfig
} from "../../../domain/config.js";
import type {
InvocationPlan,
RunGraph,
RunRecord,
TaskSpec
} from "../../../domain/models.js";
import {
FileApprovalManager
} from "../../../execution/approval-manager.js";
import { createAdapterRegistry } from "../../../execution/create-adapter-registry.js";
import {
ProcessExecutionRuntime
} from "../../../execution/execution-runtime.js";
import { SafetyManager } from "../../../execution/safety-manager.js";
import { isoNow,resolvePath } from "../../../shared/runtime.js";
import { FileArtifactStore } from "../../../storage/artifact-store.js";
import { FileBlackboardStore } from "../../../storage/blackboard-store.js";
import { FileWorkspaceStateStore } from "../../../storage/workspace-state-store.js";
import { Scheduler } from "../../scheduler.js";
import {
LocalSkillDiscoveryAdapter,
LocalSkillRegistry,
} from "../../skills/index.js";
import type {
ExecutionServices,
TaskProcessingResult
} from "../core.js";
import type { RunCoordinatorMethodThis } from "../internal-types.js";
import {
shouldUseDelegatedBootstrap,
summarizeApprovalReason
} from "../helpers/index.js";
export async function executeReadyTasks(this: RunCoordinatorMethodThis,
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
        if (currentGraph.failedTaskIds.length > 0) {
          return this.finalizeRun(currentRun, "failed", currentGraph, services);
        }
        const unresolvedTask = Object.values(currentGraph.tasks).find((candidate) =>
          candidate.status !== "completed" &&
          candidate.status !== "failed_terminal" &&
          candidate.status !== "blocked" &&
          candidate.status !== "cancelled",
        );
        if (unresolvedTask) {
          if (unresolvedTask.status === "awaiting_approval") {
            return this.updateRunRecord(currentRun, "waiting_approval", unresolvedTask.id);
          }
          return this.updateRunRecord(currentRun, "paused", unresolvedTask.id);
        }
        return this.finalizeRun(currentRun, "completed", currentGraph, services);
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
export async function handleTaskProcessingFailure(this: RunCoordinatorMethodThis,
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
export function resolveExecutionServices(this: RunCoordinatorMethodThis,
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
    const skillRegistry =
      this.dependencies.skillRegistry ?? new LocalSkillRegistry();
    const skillDiscoveryAdapter =
      this.dependencies.skillDiscoveryAdapter ??
      new LocalSkillDiscoveryAdapter(skillRegistry);
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
      skillRegistry,
      skillDiscoveryAdapter,
    };
  }
export async function processTask(this: RunCoordinatorMethodThis,
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
export async function planTaskInvocation(this: RunCoordinatorMethodThis,
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
