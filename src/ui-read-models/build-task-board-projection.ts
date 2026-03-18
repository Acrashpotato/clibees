import type {
  InspectionValidationItem,
  RunEvent,
  RunInspection,
  TaskSessionRecord,
  TaskSpec,
  TaskStatus,
} from "../domain/models.js";
import type {
  ApprovalQueueItemView,
  TaskBoardActiveSessionView,
  TaskBoardDependencyEdgeView,
  TaskBoardGraphSummaryView,
  TaskBoardProjectionView,
  TaskBoardRetrySummaryView,
  TaskBoardTaskNodeView,
  WorkspaceLaneStatus,
} from "./models.js";
import { buildApprovalQueue } from "./build-views.js";
import { buildEventSummary } from "./event-view-helpers.js";
import { buildBackfilledSessionWindows } from "./session-backfill.js";
import {
  buildTaskOwnerLabel,
  buildTaskStatusReason,
  isActiveSessionBackfillTaskStatus,
  isActiveTaskStatus,
  isTaskPastPlanning,
  mapTaskStatus,
  resolveTaskAgentId,
  resolveTaskId,
} from "./task-view-helpers.js";

export interface BuildTaskBoardProjectionOptions {
  sessions?: TaskSessionRecord[];
}

export function buildTaskBoardProjection(
  inspection: RunInspection,
  options: BuildTaskBoardProjectionOptions = {},
): TaskBoardProjectionView {
  const tasks = Object.values(inspection.graph.tasks);
  const approvals = buildApprovalQueue(inspection);
  const validationByTaskId = new Map(
    inspection.validation.map((item) => [item.taskId, item] as const),
  );
  const approvalsByTaskId = groupApprovalsByTaskId(approvals);
  const eventsByTaskId = groupEventsByTaskId(inspection.events);
  const depthByTaskId = buildTaskDepthMap(inspection.graph.tasks);
  const sessionsByTaskId = mapSessionsByTaskId(options.sessions ?? []);
  const taskNodes = tasks
    .map((task) =>
      buildTaskNodeView(
        inspection,
        task,
        depthByTaskId.get(task.id) ?? 0,
        validationByTaskId.get(task.id),
        approvalsByTaskId.get(task.id) ?? [],
        eventsByTaskId.get(task.id) ?? [],
        sessionsByTaskId.get(task.id),
      ),
    );

  return {
    projection: "task_board",
    generatedAt: new Date().toISOString(),
    runId: inspection.run.runId,
    graphRevision: inspection.graph.revision,
    ...(inspection.run.currentTaskId ? { currentTaskId: inspection.run.currentTaskId } : {}),
    summary: buildGraphSummary(tasks, approvals, inspection.graph.edges.length, taskNodes),
    tasks: taskNodes.sort(compareTaskBoardNodes),
    edges: inspection.graph.edges.map((edge, index) =>
      buildDependencyEdgeView(
        index,
        inspection.graph.tasks[edge.from],
        inspection.graph.tasks[edge.to],
      ),
    ),
  };
}

function buildGraphSummary(
  tasks: TaskSpec[],
  approvals: ApprovalQueueItemView[],
  dependencyEdgeCount: number,
  taskNodes: TaskBoardTaskNodeView[],
): TaskBoardGraphSummaryView {
  return {
    totalTaskCount: tasks.length,
    completedTaskCount: tasks.filter((task) => task.status === "completed").length,
    activeTaskCount: tasks.filter((task) => isActiveTaskStatus(task.status)).length,
    blockedTaskCount: tasks.filter((task) => task.status === "blocked").length,
    failedTaskCount: tasks.filter(
      (task) => task.status === "failed_retryable" || task.status === "failed_terminal",
    ).length,
    pendingApprovalCount: approvals.length,
    activeSessionCount: taskNodes.filter((task) => Boolean(task.activeSession)).length,
    dependencyEdgeCount,
  };
}

function buildTaskNodeView(
  inspection: RunInspection,
  task: TaskSpec,
  depth: number,
  validation: InspectionValidationItem | undefined,
  approvals: ApprovalQueueItemView[],
  taskEvents: RunEvent[],
  taskSession: TaskSessionRecord | undefined,
): TaskBoardTaskNodeView {
  const status = mapTaskStatus(task.status);
  const latestActivity = buildLatestActivity(task, taskEvents, validation, inspection);

  return {
    taskId: task.id,
    title: task.title,
    kind: task.kind,
    status,
    statusReason: buildTaskStatusReason(
      task,
      validation?.summary,
      approvals[0]?.summary,
      inspection.summary,
    ),
    waitingReason: buildWaitingReason(task, taskEvents, validation, approvals, inspection),
    ownerLabel: buildTaskOwnerLabel(task),
    riskLevel: approvals[0]?.riskLevel ?? task.riskLevel,
    dependsOn: [...task.dependsOn],
    downstreamTaskIds: inspection.graph.edges
      .filter((edge) => edge.from === task.id)
      .map((edge) => edge.to),
    depth,
    latestActivityAt: latestActivity.timestamp,
    latestActivitySummary: latestActivity.summary,
    activeSession: buildActiveSessionView(task, approvals, taskEvents, latestActivity.timestamp, taskSession),
    retry: buildRetrySummary(task, taskEvents),
  };
}

function buildActiveSessionView(
  task: TaskSpec,
  approvals: ApprovalQueueItemView[],
  taskEvents: RunEvent[],
  lastActivityAt: string,
  taskSession: TaskSessionRecord | undefined,
): TaskBoardActiveSessionView | undefined {
  if (!isActiveSessionBackfillTaskStatus(task.status)) {
    return undefined;
  }

  if (taskSession) {
    return {
      sessionId: taskSession.sessionId,
      agentId: taskSession.agentId ?? resolveTaskAgentId(task),
      status: mapTaskStatus(task.status),
      lastActivityAt: taskSession.updatedAt || lastActivityAt,
      pendingApprovalCount: approvals.length,
      sourceMode: "task_session",
    };
  }

  const windows = buildBackfilledSessionWindows(task, taskEvents);
  const activeWindow = windows.find((window) => !window.windowEndExclusive) ?? windows.at(-1);

  return {
    ...(activeWindow ? { sessionId: activeWindow.sessionId } : {}),
    agentId: resolveTaskAgentId(task),
    status: mapTaskStatus(task.status),
    lastActivityAt: activeWindow?.events.at(-1)?.timestamp ?? lastActivityAt,
    pendingApprovalCount: approvals.length,
    sourceMode: "task_status_backfill",
  };
}

function buildRetrySummary(task: TaskSpec, taskEvents: RunEvent[]): TaskBoardRetrySummaryView {
  const attempts = resolveAttemptCount(task, taskEvents);
  const lastFailureAt = [...taskEvents]
    .filter((event) =>
      event.type === "task_failed" ||
      event.type === "validation_failed" ||
      event.type === "task_blocked",
    )
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0]?.timestamp;
  const retryable = task.status === "failed_retryable";
  const requeueRecommended = task.status === "blocked" || task.status === "failed_terminal";

  return {
    ...(attempts !== undefined ? { attempts } : {}),
    maxAttempts: task.retryPolicy.maxAttempts,
    retryable,
    requeueRecommended,
    sourceMode: "status_event_backfill",
    ...(lastFailureAt ? { lastFailureAt } : {}),
    summary: buildRetrySummaryText(task, attempts),
  };
}

function buildDependencyEdgeView(
  index: number,
  fromTask: TaskSpec | undefined,
  toTask: TaskSpec | undefined,
): TaskBoardDependencyEdgeView {
  const fromTaskId = fromTask?.id ?? `missing-from-${index}`;
  const toTaskId = toTask?.id ?? `missing-to-${index}`;
  const state = resolveDependencyState(fromTask?.status, toTask?.status);

  return {
    edgeId: `dependency-${index + 1}-${fromTaskId}-${toTaskId}`,
    fromTaskId,
    toTaskId,
    state,
    summary: buildDependencySummary(fromTask, toTask, state),
  };
}

function groupApprovalsByTaskId(approvals: ApprovalQueueItemView[]): Map<string, ApprovalQueueItemView[]> {
  const grouped = new Map<string, ApprovalQueueItemView[]>();

  for (const approval of approvals) {
    if (!approval.taskId) {
      continue;
    }

    const scoped = grouped.get(approval.taskId) ?? [];
    scoped.push(approval);
    grouped.set(approval.taskId, scoped);
  }

  return grouped;
}

function mapSessionsByTaskId(sessions: TaskSessionRecord[]): Map<string, TaskSessionRecord> {
  const grouped = new Map<string, TaskSessionRecord>();

  for (const session of sessions) {
    if (session.scope !== "task_session" || !session.taskId) {
      continue;
    }

    const existing = grouped.get(session.taskId);
    if (!existing || session.updatedAt.localeCompare(existing.updatedAt) > 0) {
      grouped.set(session.taskId, session);
    }
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

function buildTaskDepthMap(tasksById: Record<string, TaskSpec>): Map<string, number> {
  const cache = new Map<string, number>();
  const visiting = new Set<string>();

  function visit(taskId: string): number {
    if (cache.has(taskId)) {
      return cache.get(taskId)!;
    }
    if (visiting.has(taskId)) {
      return 0;
    }

    const task = tasksById[taskId];
    if (!task) {
      return 0;
    }

    visiting.add(taskId);
    const depth = task.dependsOn.length === 0
      ? 0
      : Math.max(...task.dependsOn.map((dependencyId) => visit(dependencyId) + 1));
    visiting.delete(taskId);
    cache.set(taskId, depth);
    return depth;
  }

  for (const taskId of Object.keys(tasksById)) {
    visit(taskId);
  }

  return cache;
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

function buildWaitingReason(
  task: TaskSpec,
  taskEvents: RunEvent[],
  validation: InspectionValidationItem | undefined,
  approvals: ApprovalQueueItemView[],
  inspection: RunInspection,
): string | undefined {
  if (task.status === "pending" || task.status === "ready") {
    const unresolved = task.dependsOn
      .map((dependencyId) => inspection.graph.tasks[dependencyId])
      .filter((dependency): dependency is TaskSpec => Boolean(dependency))
      .filter((dependency) => dependency.status !== "completed");

    if (unresolved.length > 0) {
      return `Waiting on ${unresolved.map((dependency) => dependency.title).join(", ")}.`;
    }
  }

  if (task.status === "awaiting_approval") {
    return approvals[0]?.summary ?? "Waiting for approval before execution can continue.";
  }

  if (task.status === "blocked") {
    return (
      latestEventSummary(taskEvents, ["task_blocked", "validation_failed"]) ??
      validation?.summary ??
      inspection.summary.latestBlocker ??
      "Task is currently blocked."
    );
  }

  if (task.status === "failed_retryable" || task.status === "failed_terminal") {
    return (
      latestEventSummary(taskEvents, ["task_failed", "validation_failed"]) ??
      validation?.summary ??
      inspection.summary.latestFailure ??
      "Task failed during execution."
    );
  }

  return undefined;
}

function compareTaskBoardNodes(left: TaskBoardTaskNodeView, right: TaskBoardTaskNodeView): number {
  return (
    left.depth - right.depth ||
    getTaskBoardPriority(left.status) - getTaskBoardPriority(right.status) ||
    right.latestActivityAt.localeCompare(left.latestActivityAt) ||
    left.title.localeCompare(right.title)
  );
}

function getTaskBoardPriority(status: WorkspaceLaneStatus): number {
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

function resolveAttemptCount(task: TaskSpec, taskEvents: RunEvent[]): number | undefined {
  const startedCount = taskEvents.filter((event) => event.type === "task_started").length;
  if (startedCount > 0) {
    return startedCount;
  }

  const fallbackSignal = taskEvents.some((event) =>
    event.type === "task_failed" ||
    event.type === "task_completed" ||
    event.type === "validation_started" ||
    event.type === "validation_failed" ||
    event.type === "task_blocked",
  );

  if (fallbackSignal || isTaskPastPlanning(task.status)) {
    return 1;
  }

  return undefined;
}

function buildRetrySummaryText(task: TaskSpec, attempts: number | undefined): string {
  const attemptLabel = attempts ?? 0;

  switch (task.status) {
    case "failed_retryable":
      return `${attemptLabel}/${task.retryPolicy.maxAttempts} attempt(s) consumed; retry remains available without requeue.`;
    case "failed_terminal":
      return `${attemptLabel}/${task.retryPolicy.maxAttempts} attempt(s) consumed; requeue must create a new session.`;
    case "blocked":
      return `${attemptLabel}/${task.retryPolicy.maxAttempts} attempt(s) observed; unblock first or requeue to continue.`;
    case "completed":
      return `${Math.max(attemptLabel, 1)}/${task.retryPolicy.maxAttempts} attempt(s) used before completion.`;
    default:
      return `Retry policy allows up to ${task.retryPolicy.maxAttempts} attempt(s); no requeue is currently indicated.`;
  }
}

function resolveDependencyState(
  fromStatus: TaskStatus | undefined,
  _toStatus: TaskStatus | undefined,
): TaskBoardDependencyEdgeView["state"] {
  if (!fromStatus) {
    return "waiting";
  }
  if (fromStatus === "completed") {
    return "satisfied";
  }
  if (
    fromStatus === "blocked" ||
    fromStatus === "failed_retryable" ||
    fromStatus === "failed_terminal" ||
    fromStatus === "cancelled"
  ) {
    return "blocked";
  }
  if (isActiveTaskStatus(fromStatus)) {
    return "active";
  }
  return "waiting";
}

function buildDependencySummary(
  fromTask: TaskSpec | undefined,
  toTask: TaskSpec | undefined,
  state: TaskBoardDependencyEdgeView["state"],
): string {
  const fromLabel = fromTask?.title ?? fromTask?.id ?? "unknown task";
  const toLabel = toTask?.title ?? toTask?.id ?? "unknown task";

  switch (state) {
    case "satisfied":
      return `${fromLabel} has already satisfied the dependency for ${toLabel}.`;
    case "blocked":
      return `${toLabel} is blocked by ${fromLabel} while the upstream task is ${fromTask?.status ?? "unknown"}.`;
    case "active":
      return `${toLabel} is waiting for ${fromLabel} to finish its current execution.`;
    default:
      return `${toLabel} still depends on ${fromLabel} before it can be scheduled.`;
  }
}

function latestEventSummary(taskEvents: RunEvent[], types: RunEvent["type"][]): string | undefined {
  const event = [...taskEvents]
    .filter((candidate) => types.includes(candidate.type))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];

  return event ? buildEventSummary(event) : undefined;
}
