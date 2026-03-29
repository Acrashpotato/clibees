import type {
AgentConfig,
MultiAgentConfig
} from "../../../domain/config.js";
import type {
ArtifactRecord,
RunGraph,
RunRecord,
RunRequest,
TaskSpec
} from "../../../domain/models.js";
import { createId,isoNow } from "../../../shared/runtime.js";
import type {
DelegatedTaskTemplate,
ExecutionServices
} from "../core.js";
import type { RunCoordinatorMethodThis } from "../internal-types.js";
import {
DEFAULT_DELEGATED_TASK_TIMEOUT_MS,
DEFAULT_TASK_TIMEOUT_MS,
MAX_DELEGATED_TASKS
} from "../core.js";
import {
buildDelegatedTaskDraft,
buildDelegatedTaskReferenceMap,
buildDelegationManagerGoal,
buildDelegationTaskTitle,
isAgentCompatibleWithCapabilities,
isDelegationManagerTask,
isManagerCoordinationTask,
isTaskTerminalStatus,
readNonEmptyString,
readOptionalBoolean,
readStringArray,
resolveDelegatedDependencyTaskIds
} from "../helpers/index.js";
import {
buildDelegatedTaskDedupSignature,
extractLatestStructuredOutput,
extractManagerCoordinationOutput,
} from "./delegation-planning-helpers.js";

export function buildDelegatedBootstrapTasks(this: RunCoordinatorMethodThis,
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

export async function appendDelegatedTasksIfNeeded(this: RunCoordinatorMethodThis,
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
    const managerOutput = extractManagerCoordinationOutput(
      extractLatestStructuredOutput(artifacts),
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
    const skillBindings = await this.resolveDelegatedSkillBindings(activeRun, delegatedTaskDrafts, services);
    if (skillBindings.missingSkillIds.length > 0) {
      await this.requestMissingSkillApproval(activeRun, graph, task, skillBindings.missingSkillIds, skillBindings.missingSkillSuggestions, services);
      return (await this.dependencies.runStore.getGraph(run.runId)) ?? graph;
    }
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

    let delegatedTasks = delegatedTaskDrafts
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
          requestedSkillId: readNonEmptyString(draft.template.skillId),
          resolvedSkill: skillBindings.skillByTaskId.get(draft.taskId) ?? null,
          approvedMissingSkillIds: skillBindings.approvedMissingSkillIds,
          skillArgs: draft.template.skillArgs,
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
    const existingNonTerminalSignatures = new Set(
      Object.values(graph.tasks)
        .filter(
          (candidate: TaskSpec) =>
            candidate.id !== task.id && !isTaskTerminalStatus(candidate.status),
        )
        .map((candidate: TaskSpec) => buildDelegatedTaskDedupSignature(candidate)),
    );
    const skippedDuplicateTaskTitles: string[] = [];
    delegatedTasks = delegatedTasks.filter((candidate: TaskSpec) => {
      const signature = buildDelegatedTaskDedupSignature(candidate);
      if (existingNonTerminalSignatures.has(signature)) {
        skippedDuplicateTaskTitles.push(candidate.title);
        return false;
      }
      existingNonTerminalSignatures.add(signature);
      return true;
    });

    if (
      delegatedTasks.length === 0 &&
      fallbackWorkerId &&
      skippedDuplicateTaskTitles.length === 0 &&
      managerOutput.managerDecision !== "no_more_tasks" &&
      !isCoordinationTask
    ) {
      delegatedTasks.push(
        this.buildFallbackDelegatedTask(activeRun, task, fallbackWorkerId),
      );
    }

    if (
      delegatedTasks.length === 0 &&
      skippedDuplicateTaskTitles.length > 0
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
          body: "Plan unchanged: existing non-terminal tasks already cover this work, so duplicate delegation was skipped.",
          clientRequestId: `manager-dedup:${task.id}:${isoNow()}`,
          metadata: {
            source: "manager_task_dedup",
            taskId: task.id,
            skippedTaskTitles: skippedDuplicateTaskTitles,
          },
        },
        task.id,
      );
    }

    if (
      delegatedTasks.length === 0 &&
      isCoordinationTask &&
      skippedDuplicateTaskTitles.length === 0 &&
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
          skillId: typeof delegatedTask.metadata?.skillId === "string" ? delegatedTask.metadata.skillId : undefined,
          parentTaskId: task.id,
          delegatedBy: task.assignedAgent ?? task.preferredAgent ?? "manager",
        }),
        services.blackboardStore,
      );
    }

    return (await this.dependencies.runStore.getGraph(run.runId)) ?? patchedGraph;
  }

export function buildFallbackDelegatedTask(this: RunCoordinatorMethodThis,
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
