import type {
  InspectionApprovalItem,
  InspectionArtifactItem,
  InspectionValidationItem,
  RunEvent,
  RunInspection,
  TaskSpec,
  TaskStatus,
} from "../domain/models.js";
import type {
  TaskDetailArtifactItemView,
  TaskDetailArtifactSummaryView,
  TaskDetailDependencyItemView,
  TaskDetailLatestApprovalView,
  TaskDetailOverviewView,
  TaskDetailProjectionView,
  TaskDetailSessionSummaryView,
  TaskDetailValidationSummaryView,
  WorkspaceLaneStatus,
} from "./models.js";
import { buildEventSummary } from "./event-view-helpers.js";
import {
  buildLatestActivity,
  buildValidationFallbackSummary,
  clipLine,
  compareDependencyItems,
  deriveExpectedArtifactHints,
  getTaskPriority,
  groupEventsByTaskId,
  groupPendingApprovalsByTaskId,
  inferValidationStateFromTaskStatus,
  resolveAgentId,
  resolveApprovalRequestedAt,
  resolveBackfilledSessionStatus,
  synthesizeRuntimeContract,
} from "./task-detail-projection-helpers.js";
import { buildBackfilledSessionWindows } from "./session-backfill.js";
import {
  buildTaskOwnerLabel,
  buildTaskStatusReason,
  mapTaskStatus,
  mapValidationState,
  resolveTaskId,
} from "./task-view-helpers.js";

export function buildTaskDetailProjection(
  inspection: RunInspection,
  taskId: string,
): TaskDetailProjectionView {
  const task = inspection.graph.tasks[taskId];
  if (!task) {
    throw new Error(`Task "${taskId}" was not found in run "${inspection.run.runId}".`);
  }

  const pendingApprovalsByTaskId = groupPendingApprovalsByTaskId(inspection.approvals);
  const validationByTaskId = new Map(
    inspection.validation.map((item) => [item.taskId, item] as const),
  );
  const eventsByTaskId = groupEventsByTaskId(inspection.events);
  const artifactsByTaskId = new Map(
    inspection.artifacts.map((group) => [group.taskId ?? "__run__", group.artifacts] as const),
  );
  const taskEvents = eventsByTaskId.get(taskId) ?? [];
  const validation = validationByTaskId.get(taskId);
  const taskArtifacts = artifactsByTaskId.get(taskId) ?? [];
  const pendingApprovals = pendingApprovalsByTaskId.get(taskId) ?? [];
  const latestActivity = buildLatestActivity(task, taskEvents, validation, inspection);
  const sessions = buildTaskSessionSummaries(task, taskEvents, inspection.approvals);
  const runtimeContract = synthesizeRuntimeContract(task, taskEvents, taskArtifacts, validation);

  return {
    projection: "task_detail",
    generatedAt: new Date().toISOString(),
    runId: inspection.run.runId,
    graphRevision: inspection.graph.revision,
    taskId,
    overview: buildOverview(
      task,
      latestActivity,
      sessions,
      pendingApprovals.length,
      taskArtifacts.length,
      validation,
      pendingApprovals,
      inspection,
      runtimeContract,
    ),
    upstream: buildDependencyViews(
      task.dependsOn
        .map((dependencyTaskId) => inspection.graph.tasks[dependencyTaskId])
        .filter((dependencyTask): dependencyTask is TaskSpec => Boolean(dependencyTask)),
      validationByTaskId,
      pendingApprovalsByTaskId,
      eventsByTaskId,
      inspection,
    ),
    downstream: buildDependencyViews(
      inspection.graph.edges
        .filter((edge) => edge.from === task.id)
        .map((edge) => inspection.graph.tasks[edge.to])
        .filter((dependencyTask): dependencyTask is TaskSpec => Boolean(dependencyTask)),
      validationByTaskId,
      pendingApprovalsByTaskId,
      eventsByTaskId,
      inspection,
    ),
    sessions,
    latestApproval: buildLatestApproval(inspection, taskId),
    validation: buildValidationSummary(task, validation),
    artifacts: buildArtifactSummary(taskArtifacts),
  };
}

function buildOverview(
  task: TaskSpec,
  latestActivity: { timestamp: string; summary: string },
  sessions: TaskDetailSessionSummaryView[],
  pendingApprovalCount: number,
  artifactCount: number,
  validation: InspectionValidationItem | undefined,
  pendingApprovals: InspectionApprovalItem[],
  inspection: RunInspection,
  runtimeContract: RuntimeContractSynthesis,
): TaskDetailOverviewView {
  return {
    taskId: task.id,
    title: task.title,
    kind: task.kind,
    goal: runtimeContract.goal,
    status: mapTaskStatus(task.status),
    statusReason: buildTaskStatusReason(
      task,
      validation?.summary,
      pendingApprovals[0]?.summary,
      inspection.summary,
    ),
    ownerLabel: buildTaskOwnerLabel(task),
    riskLevel: pendingApprovals[0]?.riskLevel ?? task.riskLevel,
    inputs: runtimeContract.inputs,
    acceptanceCriteria: runtimeContract.acceptanceCriteria,
    expectedArtifacts: runtimeContract.expectedArtifacts,
    latestActivityAt: latestActivity.timestamp,
    latestActivitySummary: latestActivity.summary,
    sessionCount: sessions.length,
    activeSessionCount: sessions.filter((session) =>
      session.status === "running" || session.status === "awaiting_approval"
    ).length,
    pendingApprovalCount,
    artifactCount,
  };
}

interface RuntimeContractSynthesis {
  goal: string;
  inputs: string[];
  acceptanceCriteria: string[];
  expectedArtifacts: string[];
}

function buildDependencyViews(
  tasks: TaskSpec[],
  validationByTaskId: Map<string, InspectionValidationItem>,
  pendingApprovalsByTaskId: Map<string, InspectionApprovalItem[]>,
  eventsByTaskId: Map<string, RunEvent[]>,
  inspection: RunInspection,
): TaskDetailDependencyItemView[] {
  return tasks
    .map((task) => {
      const latestActivity = buildLatestActivity(
        task,
        eventsByTaskId.get(task.id) ?? [],
        validationByTaskId.get(task.id),
        inspection,
      );

      return {
        taskId: task.id,
        title: task.title,
        kind: task.kind,
        status: mapTaskStatus(task.status),
        statusReason: buildTaskStatusReason(
          task,
          validationByTaskId.get(task.id)?.summary,
          pendingApprovalsByTaskId.get(task.id)?.[0]?.summary,
          inspection.summary,
        ),
        ownerLabel: buildTaskOwnerLabel(task),
        latestActivityAt: latestActivity.timestamp,
        latestActivitySummary: latestActivity.summary,
      };
    })
    .sort(compareDependencyItems);
}

function buildTaskSessionSummaries(
  task: TaskSpec,
  taskEvents: RunEvent[],
  approvals: InspectionApprovalItem[],
): TaskDetailSessionSummaryView[] {
  const sortedEvents = [...taskEvents].sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  return buildBackfilledSessionWindows(task, sortedEvents)
    .map((window) => {
      const lastEvent = window.events.at(-1);
      const pendingApprovalCount = approvals.filter((approval) => {
        if (approval.taskId !== task.id || approval.state !== "pending") {
          return false;
        }
        if (!window.startedAt) {
          return true;
        }
        const requestedAt = resolveApprovalRequestedAt(sortedEvents, approval.requestId);
        return requestedAt !== undefined &&
          requestedAt >= window.startedAt &&
          (!window.windowEndExclusive || requestedAt < window.windowEndExclusive);
      }).length;

      return {
        sessionId: window.sessionId,
        label: window.attemptNumber ? `Attempt ${window.attemptNumber}` : "Execution summary",
        status: lastEvent
          ? resolveBackfilledSessionStatus(lastEvent.type, !window.windowEndExclusive ? task.status : undefined)
          : mapTaskStatus(task.status),
        agentId: resolveAgentId(window.events[0], task),
        ...(window.startedAt ? { startedAt: window.startedAt } : {}),
        lastActivityAt: lastEvent?.timestamp ?? new Date(0).toISOString(),
        latestActivitySummary: lastEvent ? buildEventSummary(lastEvent) : `Task is currently ${task.status}.`,
        pendingApprovalCount,
        sourceMode: window.sourceMode,
      } satisfies TaskDetailSessionSummaryView;
    })
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
}

function buildLatestApproval(
  inspection: RunInspection,
  taskId: string,
): TaskDetailLatestApprovalView | undefined {
  const latestApproval = inspection.approvals
    .filter((approval) => approval.taskId === taskId)
    .map((approval) => ({
      approval,
      requestedAt: resolveApprovalRequestedAt(inspection.events, approval.requestId),
      activityAt: approval.decidedAt ?? resolveApprovalRequestedAt(inspection.events, approval.requestId) ?? "",
    }))
    .sort((left, right) => right.activityAt.localeCompare(left.activityAt))[0];

  if (!latestApproval) {
    return undefined;
  }

  return {
    requestId: latestApproval.approval.requestId,
    state: latestApproval.approval.state,
    summary: latestApproval.approval.summary,
    riskLevel: latestApproval.approval.riskLevel ?? "none",
    ...(latestApproval.requestedAt ? { requestedAt: latestApproval.requestedAt } : {}),
    ...(latestApproval.approval.decidedAt ? { decidedAt: latestApproval.approval.decidedAt } : {}),
    ...(latestApproval.approval.actor ? { actor: latestApproval.approval.actor } : {}),
    sourceMode: "inspection_approval",
  };
}

function buildValidationSummary(
  task: TaskSpec,
  validation: InspectionValidationItem | undefined,
): TaskDetailValidationSummaryView {
  if (validation) {
    return {
      state: mapValidationState(validation.outcome, task.status),
      summary: validation.summary,
      details: [...validation.details],
      ...(validation.updatedAt ? { updatedAt: validation.updatedAt } : {}),
      sourceMode: "validation_record",
    };
  }

  return {
    state: inferValidationStateFromTaskStatus(task.status),
    summary: buildValidationFallbackSummary(task.status),
    details: [],
    sourceMode: "task_status_backfill",
  };
}

function buildArtifactSummary(
  artifacts: InspectionArtifactItem[],
): TaskDetailArtifactSummaryView {
  const sortedArtifacts = [...artifacts]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    totalCount: sortedArtifacts.length,
    ...(sortedArtifacts[0] ? { latestCreatedAt: sortedArtifacts[0].createdAt } : {}),
    highlights: sortedArtifacts.slice(0, 5).map((artifact): TaskDetailArtifactItemView => ({
      artifactId: artifact.id,
      kind: artifact.kind,
      uri: artifact.uri,
      summary: artifact.summary,
      createdAt: artifact.createdAt,
    })),
  };
}

