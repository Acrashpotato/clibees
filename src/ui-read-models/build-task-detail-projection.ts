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
import { buildBackfilledSessionWindows } from "./session-backfill.js";

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
): TaskDetailOverviewView {
  return {
    taskId: task.id,
    title: task.title,
    kind: task.kind,
    goal: task.goal,
    status: mapTaskStatus(task.status),
    statusReason: buildStatusReason(task, validation, pendingApprovals, inspection),
    ownerLabel: buildTaskOwnerLabel(task),
    riskLevel: pendingApprovals[0]?.riskLevel ?? task.riskLevel,
    inputs: [...task.inputs],
    acceptanceCriteria: [...task.acceptanceCriteria],
    expectedArtifacts: [...task.expectedArtifacts],
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
        statusReason: buildStatusReason(
          task,
          validationByTaskId.get(task.id),
          pendingApprovalsByTaskId.get(task.id) ?? [],
          inspection,
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

function groupPendingApprovalsByTaskId(
  approvals: InspectionApprovalItem[],
): Map<string, InspectionApprovalItem[]> {
  const grouped = new Map<string, InspectionApprovalItem[]>();

  for (const approval of approvals) {
    if (!approval.taskId || approval.state !== "pending") {
      continue;
    }

    const scoped = grouped.get(approval.taskId) ?? [];
    scoped.push(approval);
    grouped.set(approval.taskId, scoped);
  }

  return grouped;
}

function groupEventsByTaskId(events: RunEvent[]): Map<string, RunEvent[]> {
  const grouped = new Map<string, RunEvent[]>();

  for (const event of events) {
    const taskId = resolveTaskId(event);
    if (!taskId) {
      continue;
    }

    const scoped = grouped.get(taskId) ?? [];
    scoped.push(event);
    grouped.set(taskId, scoped);
  }

  return grouped;
}

function buildLatestActivity(
  task: TaskSpec,
  taskEvents: RunEvent[],
  validation: InspectionValidationItem | undefined,
  inspection: RunInspection,
): { timestamp: string; summary: string } {
  const latestEvent = [...taskEvents]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];

  if (latestEvent) {
    return {
      timestamp: latestEvent.timestamp,
      summary: buildEventSummary(latestEvent),
    };
  }

  if (validation?.updatedAt) {
    return {
      timestamp: validation.updatedAt,
      summary: validation.summary,
    };
  }

  return {
    timestamp: inspection.run.updatedAt,
    summary: `Task is currently ${task.status}.`,
  };
}

function compareDependencyItems(
  left: TaskDetailDependencyItemView,
  right: TaskDetailDependencyItemView,
): number {
  return (
    getTaskPriority(left.status) - getTaskPriority(right.status) ||
    right.latestActivityAt.localeCompare(left.latestActivityAt) ||
    left.title.localeCompare(right.title)
  );
}

function getTaskPriority(status: WorkspaceLaneStatus): number {
  switch (status) {
    case "awaiting_approval":
      return 0;
    case "blocked":
      return 1;
    case "running":
      return 2;
    case "failed":
      return 3;
    case "paused":
      return 4;
    case "completed":
      return 5;
    default:
      return 6;
  }
}

function resolveBackfilledSessionStatus(
  latestEventType: RunEvent["type"],
  currentTaskStatus: TaskStatus | undefined,
): WorkspaceLaneStatus {
  if (currentTaskStatus) {
    return mapTaskStatus(currentTaskStatus);
  }

  switch (latestEventType) {
    case "approval_requested":
      return "awaiting_approval";
    case "task_blocked":
      return "blocked";
    case "task_failed":
    case "validation_failed":
      return "failed";
    case "task_completed":
    case "validation_passed":
      return "completed";
    default:
      return "running";
  }
}

function resolveAgentId(event: RunEvent | undefined, task: TaskSpec): string {
  const payload = event?.payload as { agentId?: unknown } | undefined;
  if (typeof payload?.agentId === "string") {
    return payload.agentId;
  }
  if (task.assignedAgent) {
    return task.assignedAgent;
  }
  if (task.preferredAgent) {
    return task.preferredAgent;
  }
  if (task.requiredCapabilities.length > 0) {
    return task.requiredCapabilities[0]!;
  }
  return "unassigned";
}

function buildTaskOwnerLabel(task: TaskSpec): string {
  if (task.assignedAgent) {
    return task.assignedAgent;
  }
  if (task.preferredAgent) {
    return task.preferredAgent;
  }
  if (task.requiredCapabilities.length > 0) {
    return task.requiredCapabilities.join(", ");
  }
  return `${task.kind} task`;
}

function buildStatusReason(
  task: TaskSpec,
  validation: InspectionValidationItem | undefined,
  approvals: InspectionApprovalItem[],
  inspection: RunInspection,
): string {
  if (approvals.length > 0) {
    return approvals[0]!.summary;
  }

  switch (task.status) {
    case "pending":
      return "Waiting for dependencies before this task can be scheduled.";
    case "ready":
      return "Ready to resume execution.";
    case "routing":
      return "Selecting an agent for this task.";
    case "context_building":
      return "Building task context from memory, blackboard, and artifacts.";
    case "queued":
      return "Queued for execution.";
    case "running":
      return "Task process is currently running.";
    case "validating":
      return "Execution finished and validation is in progress.";
    case "completed":
      return validation?.summary ?? "Task completed successfully.";
    case "failed_retryable":
      return validation?.summary ?? "Task failed and can be retried.";
    case "failed_terminal":
      return validation?.summary ?? inspection.summary.latestFailure ?? "Task failed.";
    case "blocked":
      return validation?.summary ?? inspection.summary.latestBlocker ?? "Task is blocked.";
    case "cancelled":
      return "Task was cancelled.";
    case "awaiting_approval":
      return approvals[0]?.summary ?? "Waiting for approval before execution can continue.";
    default:
      return `Task is currently ${task.status}.`;
  }
}

function buildEventSummary(event: RunEvent): string {
  const payload = event.payload as {
    message?: unknown;
    summary?: unknown;
    reason?: unknown;
    agentId?: unknown;
  };

  if (typeof payload.summary === "string") {
    return payload.summary;
  }
  if (typeof payload.reason === "string") {
    return payload.reason;
  }
  if (typeof payload.message === "string") {
    return firstNonEmptyLine(payload.message) ?? "Agent produced a new message.";
  }
  if (event.type === "task_started" && typeof payload.agentId === "string") {
    return `Task started by ${payload.agentId}.`;
  }
  return event.type.replaceAll("_", " ");
}

function mapValidationState(
  outcome: InspectionValidationItem["outcome"],
  taskStatus: TaskStatus,
): TaskDetailValidationSummaryView["state"] {
  if (outcome === "pass" || taskStatus === "completed") {
    return "pass";
  }
  if (
    outcome === "fail_retryable" ||
    outcome === "fail_replan_needed" ||
    outcome === "blocked" ||
    taskStatus === "failed_retryable" ||
    taskStatus === "failed_terminal" ||
    taskStatus === "blocked"
  ) {
    return "fail";
  }
  return "warn";
}

function inferValidationStateFromTaskStatus(
  status: TaskStatus,
): TaskDetailValidationSummaryView["state"] {
  if (status === "completed") {
    return "pass";
  }
  if (
    status === "failed_retryable" ||
    status === "failed_terminal" ||
    status === "blocked" ||
    status === "cancelled"
  ) {
    return "fail";
  }
  return "warn";
}

function buildValidationFallbackSummary(status: TaskStatus): string {
  switch (status) {
    case "completed":
      return "Task completed but no dedicated validation record has been persisted yet.";
    case "failed_retryable":
      return "Task failed and can be retried; a dedicated validation record is not available yet.";
    case "failed_terminal":
      return "Task failed terminally; a dedicated validation record is not available yet.";
    case "blocked":
      return "Task is blocked and has not produced a dedicated validation record.";
    case "cancelled":
      return "Task was cancelled before a dedicated validation record was persisted.";
    default:
      return "Validation has not produced a dedicated record for this task yet.";
  }
}

function firstNonEmptyLine(message: string): string | undefined {
  return message.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
}

function mapTaskStatus(status: TaskStatus): WorkspaceLaneStatus {
  switch (status) {
    case "awaiting_approval":
      return "awaiting_approval";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    case "cancelled":
    case "failed_retryable":
    case "failed_terminal":
      return "failed";
    case "pending":
    case "ready":
      return "paused";
    default:
      return "running";
  }
}

function resolveApprovalRequestedAt(
  events: RunEvent[],
  requestId: string,
): string | undefined {
  const event = events.find((candidate) => {
    if (candidate.type !== "approval_requested") {
      return false;
    }
    const payload = candidate.payload as { requestId?: unknown };
    return payload.requestId === requestId;
  });

  return event?.timestamp;
}

function resolveTaskId(event: RunEvent): string | undefined {
  if (event.taskId) {
    return event.taskId;
  }
  const payload = event.payload as { taskId?: unknown };
  return typeof payload.taskId === "string" ? payload.taskId : undefined;
}

