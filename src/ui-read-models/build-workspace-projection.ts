import type {
  InspectionApprovalItem,
  InspectionValidationItem,
  RunEvent,
  RunInspection,
  SessionMessageRecord,
  TaskSpec,
} from "../domain/models.js";
import type {
  ApprovalQueueItemView,
  WorkspaceActionQueueItemView,
  WorkspaceActiveSessionView,
  WorkspaceControlActionView,
  WorkspaceDependencySummaryView,
  WorkspaceFocusSelectionMode,
  WorkspaceFocusTaskView,
  WorkspacePendingMessageItemView,
  WorkspacePendingMessageSummaryView,
  WorkspaceProjectionView,
  WorkspaceRiskSummaryView,
  WorkspaceRunSummaryView,
} from "./models.js";
import { buildApprovalQueue } from "./build-views.js";
import {
  buildDependencySummaryText,
  buildPendingMessageItem,
  buildSelectionResult,
  buildStageLabel,
  groupApprovalsByTaskId,
  isPendingMessageEvent,
  resolveFocusTask,
  resolveHighestRiskLevel,
} from "./workspace-projection-helpers.js";
import { firstNonEmptyLine } from "./event-view-helpers.js";
import { buildBackfilledSessionWindows } from "./session-backfill.js";
import {
  buildTaskOwnerLabel,
  buildTaskStatusReason,
  buildTerminalPreview,
  isActiveSessionBackfillTaskStatus,
  isActiveTaskStatus,
  isDownstreamReadyStatus,
  mapRunStatus,
  mapTaskStatus,
  resolveTaskAgentId,
  resolveTaskId,
} from "./task-view-helpers.js";

export function buildWorkspaceProjection(
  inspection: RunInspection,
  options: {
    threadMessages?: SessionMessageRecord[];
  } = {},
): WorkspaceProjectionView {
  const tasks = Object.values(inspection.graph.tasks);
  const approvals = buildApprovalQueue(inspection);
  const validationByTaskId = new Map(
    inspection.validation.map((item) => [item.taskId, item] as const),
  );
  const approvalsByTaskId = groupApprovalsByTaskId(approvals);
  const focusSelection = resolveFocusTask(inspection);
  const focusTask = focusSelection.task
    ? buildFocusTaskView(
        inspection,
        focusSelection.task,
        focusSelection.selectionMode,
        validationByTaskId.get(focusSelection.task.id),
        approvalsByTaskId.get(focusSelection.task.id) ?? [],
      )
    : undefined;
  const activeSession = buildActiveSessionView(
    inspection,
    focusSelection.task,
    validationByTaskId,
    approvalsByTaskId,
  );
  const pendingMessages = buildPendingMessagesSummary(
    inspection,
    options.threadMessages ?? [],
  );

  return {
    projection: "workspace",
    generatedAt: new Date().toISOString(),
    run: buildRunSummary(inspection, tasks),
    focusTask,
    activeSession,
    actionQueue: buildActionQueue(inspection, approvals, focusTask, pendingMessages),
    dependencySummary: buildDependencySummary(inspection, focusSelection.task),
    riskSummary: buildRiskSummary(inspection, tasks, approvals),
    pendingMessages,
    controlActions: buildControlActions(inspection, focusTask, activeSession, approvals),
  };
}

function buildRunSummary(
  inspection: RunInspection,
  tasks: TaskSpec[],
): WorkspaceRunSummaryView {
  const activeTaskCount = tasks.filter((task) => isActiveTaskStatus(task.status)).length;
  const activeSessionCount = tasks.filter((task) => isActiveSessionBackfillTaskStatus(task.status)).length;

  return {
    runId: inspection.run.runId,
    goal: inspection.run.goal,
    status: mapRunStatus(inspection.run.status),
    stage: buildStageLabel(inspection),
    createdAt: inspection.run.createdAt,
    updatedAt: inspection.run.updatedAt,
    totalTaskCount: tasks.length,
    completedTaskCount: inspection.summary.completedTasks,
    activeTaskCount,
    activeSessionCount,
    blockedTaskCount: inspection.summary.blockedTasks,
    pendingApprovalCount: inspection.summary.pendingApprovals,
    sessionSourceMode: "task_status_backfill",
    canResume:
      inspection.run.status === "ready" ||
      inspection.run.status === "paused" ||
      inspection.run.status === "waiting_approval",
  };
}

function buildFocusTaskView(
  inspection: RunInspection,
  task: TaskSpec,
  selectionMode: WorkspaceFocusSelectionMode,
  validation: InspectionValidationItem | undefined,
  approvals: ApprovalQueueItemView[],
): WorkspaceFocusTaskView {
  const taskEvents = inspection.events.filter((event) => resolveTaskId(event) === task.id);

  return {
    taskId: task.id,
    title: task.title,
    status: mapTaskStatus(task.status),
    statusReason: buildTaskStatusReason(
      task,
      validation?.summary,
      approvals[0]?.summary,
      inspection.summary,
    ),
    ownerLabel: buildTaskOwnerLabel(task),
    riskLevel: approvals[0]?.riskLevel ?? task.riskLevel,
    lastActivityAt: taskEvents.at(-1)?.timestamp ?? inspection.run.updatedAt,
    dependsOn: [...task.dependsOn],
    downstreamTaskIds: inspection.graph.edges.filter((edge) => edge.from === task.id).map((edge) => edge.to),
    selectionMode,
  };
}

function buildActiveSessionView(
  inspection: RunInspection,
  focusTask: TaskSpec | undefined,
  validationByTaskId: Map<string, InspectionValidationItem>,
  approvalsByTaskId: Map<string, ApprovalQueueItemView[]>,
): WorkspaceActiveSessionView | undefined {
  const sessionTask =
    (focusTask && isActiveSessionBackfillTaskStatus(focusTask.status) ? focusTask : undefined) ??
    Object.values(inspection.graph.tasks).find((task) => isActiveSessionBackfillTaskStatus(task.status));

  if (!sessionTask) {
    return undefined;
  }

  const validation = validationByTaskId.get(sessionTask.id);
  const approvals = approvalsByTaskId.get(sessionTask.id) ?? [];
  const taskEvents = inspection.events
    .filter((event) => resolveTaskId(event) === sessionTask.id)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const windows = buildBackfilledSessionWindows(sessionTask, taskEvents);
  const activeWindow = windows.find((window) => !window.windowEndExclusive) ?? windows.at(-1);
  const activeEvents = activeWindow?.events ?? taskEvents;

  return {
    ...(activeWindow ? { sessionId: activeWindow.sessionId } : {}),
    taskId: sessionTask.id,
    taskTitle: sessionTask.title,
    agentId: resolveTaskAgentId(sessionTask),
    status: mapTaskStatus(sessionTask.status),
    statusReason: buildTaskStatusReason(
      sessionTask,
      validation?.summary,
      approvals[0]?.summary,
      inspection.summary,
    ),
    lastActivityAt: activeEvents.at(-1)?.timestamp ?? inspection.run.updatedAt,
    terminalPreview: buildTerminalPreview(sessionTask, activeEvents, validation?.summary),
    pendingApprovalCount: approvals.length,
    sourceMode: "task_status_backfill",
  };
}

function buildActionQueue(
  inspection: RunInspection,
  approvals: ApprovalQueueItemView[],
  focusTask: WorkspaceFocusTaskView | undefined,
  pendingMessages: WorkspacePendingMessageSummaryView,
): WorkspaceActionQueueItemView[] {
  const queue: WorkspaceActionQueueItemView[] = approvals.map((approval) => ({
    id: approval.id,
    kind: "approval_request",
    title: approval.title,
    summary: approval.summary,
    priority: 0,
    tone: approval.riskLevel === "high" ? "danger" : "warning",
    targetType: "approval_request",
    targetId: approval.id,
    recommendedAction: "review_approval",
  }));

  if (focusTask && (focusTask.status === "blocked" || focusTask.status === "awaiting_approval")) {
    queue.push({
      id: `focus-${focusTask.taskId}-${focusTask.status}`,
      kind: "blocked_task",
      title: focusTask.title,
      summary: focusTask.statusReason,
      priority: focusTask.status === "blocked" ? 1 : 2,
      tone: focusTask.status === "blocked" ? "danger" : "warning",
      targetType: "task",
      targetId: focusTask.taskId,
      recommendedAction: focusTask.status === "blocked" ? "requeue" : "review_approval",
    });
  }

  for (const message of pendingMessages.items.slice(0, 3)) {
    queue.push({
      id: `message-${message.id}`,
      kind: "pending_message",
      title: message.title,
      summary: message.summary,
      priority: 3,
      tone:
        message.source === "task_blocked" ||
        message.source === "task_failed" ||
        message.source === "validation_failed"
          ? "danger"
          : "warning",
      targetType: "thread",
      targetId: message.taskId ?? inspection.run.runId,
      recommendedAction: "interact",
    });
  }

  if (
    inspection.run.status === "ready" ||
    inspection.run.status === "paused" ||
    inspection.run.status === "waiting_approval"
  ) {
    queue.push({
      id: `resume-${inspection.run.runId}`,
      kind: "run_control",
      title: "Resume run",
      summary: "Run control can continue from the current scheduler state.",
      priority: 4,
      tone: "neutral",
      targetType: "run",
      targetId: inspection.run.runId,
      recommendedAction: "resume",
    });
  }

  return queue.sort(
    (left, right) => left.priority - right.priority || left.title.localeCompare(right.title),
  );
}

function buildDependencySummary(
  inspection: RunInspection,
  focusTask: TaskSpec | undefined,
): WorkspaceDependencySummaryView {
  if (!focusTask) {
    return {
      upstreamPendingCount: 0,
      upstreamBlockedCount: 0,
      downstreamReadyCount: 0,
      downstreamWaitingCount: 0,
      summary: "No focus task is selected yet.",
    };
  }

  const tasksById = inspection.graph.tasks;
  const upstreamTasks = focusTask.dependsOn.map((taskId) => tasksById[taskId]).filter((task): task is TaskSpec => Boolean(task));
  const downstreamTasks = inspection.graph.edges.filter((edge) => edge.from === focusTask.id).map((edge) => tasksById[edge.to]).filter((task): task is TaskSpec => Boolean(task));
  const upstreamBlockedCount = upstreamTasks.filter(
    (task) => task.status === "blocked" || task.status === "failed_terminal",
  ).length;
  const upstreamPendingCount = upstreamTasks.filter((task) => task.status !== "completed").length;
  const downstreamReadyCount = downstreamTasks.filter((task) => isDownstreamReadyStatus(task.status)).length;
  const downstreamWaitingCount = downstreamTasks.filter((task) => task.status === "pending").length;

  return {
    focusTaskId: focusTask.id,
    upstreamPendingCount,
    upstreamBlockedCount,
    downstreamReadyCount,
    downstreamWaitingCount,
    summary: buildDependencySummaryText(
      focusTask.title,
      upstreamPendingCount,
      upstreamBlockedCount,
      downstreamReadyCount,
      downstreamWaitingCount,
    ),
  };
}

function buildRiskSummary(
  inspection: RunInspection,
  tasks: TaskSpec[],
  approvals: ApprovalQueueItemView[],
): WorkspaceRiskSummaryView {
  const highestRiskLevel = resolveHighestRiskLevel(
    approvals.map((approval) => approval.riskLevel),
    tasks.map((task) => task.riskLevel),
  );
  const failedTaskCount = tasks.filter(
    (task) => task.status === "failed_retryable" || task.status === "failed_terminal",
  ).length;
  const warningCount =
    inspection.validation.filter((item) => item.outcome && item.outcome !== "pass").length +
    tasks.filter((task) => task.status === "awaiting_approval").length;
  const headlines = [
    inspection.summary.latestFailure,
    inspection.summary.latestBlocker,
    inspection.summary.latestValidation,
    approvals[0]?.summary,
  ].filter((line): line is string => Boolean(line)).slice(0, 4);

  return {
    highestRiskLevel,
    pendingApprovalCount: inspection.summary.pendingApprovals,
    blockedTaskCount: inspection.summary.blockedTasks,
    failedTaskCount,
    warningCount,
    headlines,
  };
}

function buildPendingMessagesSummary(
  inspection: RunInspection,
  threadMessages: SessionMessageRecord[],
): WorkspacePendingMessageSummaryView {
  if (threadMessages.length > 0) {
    const items = [...threadMessages]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 5)
      .map((message) => ({
        id: message.messageId,
        title: `${message.role} message`,
        summary: message.body,
        timestamp: message.createdAt,
        source: "agent_message" as const,
      }));
    const distinctScopes = new Set(items.map((item) => item.id));

    return {
      pendingThreadCount: distinctScopes.size,
      unreadMessageCount: items.length,
      latestMessageAt: items[0]?.timestamp,
      sourceMode: "thread_messages",
      summary:
        items.length > 0
          ? `${items.length} persisted thread message(s) are available for review.`
          : "No persisted thread message is currently highlighted for the workspace.",
      items,
    };
  }

  const items = inspection.events
    .filter((event) => isPendingMessageEvent(event.type))
    .map((event) => buildPendingMessageItem(inspection, event))
    .filter((item): item is WorkspacePendingMessageItemView => Boolean(item))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 5);
  const distinctScopes = new Set(items.map((item) => item.taskId ?? item.id));

  return {
    pendingThreadCount: distinctScopes.size,
    unreadMessageCount: items.length,
    latestMessageAt: items[0]?.timestamp,
    sourceMode: "run_event_backfill",
    summary:
      items.length > 0
        ? `${items.length} recent message event(s) need review before the workspace can move cleanly.`
        : "No pending message event is currently highlighted for the workspace.",
    items,
  };
}

function buildControlActions(
  inspection: RunInspection,
  focusTask: WorkspaceFocusTaskView | undefined,
  activeSession: WorkspaceActiveSessionView | undefined,
  approvals: ApprovalQueueItemView[],
): WorkspaceControlActionView[] {
  const actions: WorkspaceControlActionView[] = [
    {
      actionId: "resume",
      label: "Resume run",
      scope: "run",
      targetId: inspection.run.runId,
      enabled:
        inspection.run.status === "ready" ||
        inspection.run.status === "paused" ||
        inspection.run.status === "waiting_approval",
      reason:
        inspection.run.status === "ready" ||
        inspection.run.status === "paused" ||
        inspection.run.status === "waiting_approval"
          ? "Run can resume from its current scheduler state."
          : "Resume is only available when the run is ready, paused, or waiting approval.",
    },
  ];

  if (approvals[0]) {
    actions.push({
      actionId: "review_approval",
      label: "Review approval",
      scope: "approval_request",
      targetId: approvals[0].id,
      enabled: true,
      reason: "A pending approval is blocking or gating execution.",
    });
  }

  if (focusTask) {
    actions.push({
      actionId: "requeue",
      label: "Requeue task",
      scope: "task",
      targetId: focusTask.taskId,
      enabled: focusTask.status === "blocked" || focusTask.status === "failed",
      reason:
        focusTask.status === "blocked" || focusTask.status === "failed"
          ? "Requeue is available for blocked or failed focus tasks."
          : "Requeue is only relevant after the focus task blocks or fails.",
    });
    actions.push({
      actionId: "cancel",
      label: "Cancel task",
      scope: "task",
      targetId: focusTask.taskId,
      enabled: focusTask.status !== "completed" && focusTask.status !== "failed",
      reason:
        focusTask.status !== "completed" && focusTask.status !== "failed"
          ? "The focus task is still active enough to cancel."
          : "Cancel is not available for completed or terminally failed tasks.",
    });
  }

  actions.push({
    actionId: "interact",
    label: "Send message",
    scope: "thread",
    targetId: activeSession?.taskId ?? inspection.run.runId,
    enabled: false,
    reason: activeSession
      ? "Thread and taskSession models are not persisted yet; keep this action disabled until task 18 and task 21 land."
      : "No active session backfill is available yet.",
  });
  actions.push({
    actionId: "interrupt",
    label: "Interrupt session",
    scope: "task_session",
    targetId: activeSession?.taskId ?? inspection.run.runId,
    enabled: false,
    reason: "Interrupt must target a persisted taskSession and stays disabled until taskSession storage exists.",
  });

  return actions;
}


