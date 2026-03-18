import type {
  InspectionApprovalItem,
  RunEvent,
  RunInspection,
  TaskSpec,
} from "../domain/models.js";
import type {
  ApprovalQueueItemView,
  WorkspaceFocusSelectionMode,
  WorkspacePendingMessageItemView,
  WorkspaceRiskSummaryView,
} from "./models.js";
import { firstNonEmptyLine } from "./event-view-helpers.js";
import { isActiveTaskStatus, resolveTaskId } from "./task-view-helpers.js";

export function groupApprovalsByTaskId(approvals: ApprovalQueueItemView[]): Map<string, ApprovalQueueItemView[]> {
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

export function resolveFocusTask(
  inspection: RunInspection,
): {
  task?: TaskSpec;
  selectionMode: WorkspaceFocusSelectionMode;
} {
  if (inspection.run.currentTaskId && inspection.graph.tasks[inspection.run.currentTaskId]) {
    return {
      task: inspection.graph.tasks[inspection.run.currentTaskId],
      selectionMode: "run_current_task",
    };
  }

  const tasks = Object.values(inspection.graph.tasks);

  return (
    buildSelectionResult(tasks.find((task) => task.status === "awaiting_approval"), "approval_priority") ??
    buildSelectionResult(tasks.find((task) => task.status === "blocked"), "blocked_priority") ??
    buildSelectionResult(tasks.find((task) => isActiveTaskStatus(task.status)), "active_fallback") ??
    buildSelectionResult(tasks[0], "first_task_fallback") ?? {
      selectionMode: "first_task_fallback",
    }
  );
}

export function buildSelectionResult(
  task: TaskSpec | undefined,
  selectionMode: WorkspaceFocusSelectionMode,
): { task: TaskSpec; selectionMode: WorkspaceFocusSelectionMode } | undefined {
  if (!task) {
    return undefined;
  }

  return { task, selectionMode };
}

export function buildPendingMessageItem(
  inspection: RunInspection,
  event: RunEvent,
): WorkspacePendingMessageItemView | undefined {
  const taskId = resolveTaskId(event);
  const taskTitle = taskId ? inspection.graph.tasks[taskId]?.title : undefined;
  const payload = event.payload as {
    message?: unknown;
    summary?: unknown;
    reason?: unknown;
  };

  switch (event.type) {
    case "agent_message": {
      const message = typeof payload.message === "string" ? firstNonEmptyLine(payload.message) : undefined;
      return {
        id: event.id,
        taskId,
        title: taskTitle ? `Agent update 路 ${taskTitle}` : "Agent update",
        summary: message ?? "Agent produced a new message event.",
        timestamp: event.timestamp,
        source: "agent_message",
      };
    }
    case "approval_requested":
      return {
        id: event.id,
        taskId,
        title: taskTitle ? `Approval requested 路 ${taskTitle}` : "Approval requested",
        summary:
          typeof payload.summary === "string"
            ? payload.summary
            : "A new approval request needs a decision.",
        timestamp: event.timestamp,
        source: "approval_requested",
      };
    case "task_blocked":
      return {
        id: event.id,
        taskId,
        title: taskTitle ? `Task blocked 路 ${taskTitle}` : "Task blocked",
        summary:
          typeof payload.reason === "string"
            ? payload.reason
            : inspection.summary.latestBlocker ?? "Task is currently blocked.",
        timestamp: event.timestamp,
        source: "task_blocked",
      };
    case "task_failed":
      return {
        id: event.id,
        taskId,
        title: taskTitle ? `Task failed 路 ${taskTitle}` : "Task failed",
        summary:
          typeof payload.summary === "string"
            ? payload.summary
            : inspection.summary.latestFailure ?? "Task failed during execution.",
        timestamp: event.timestamp,
        source: "task_failed",
      };
    case "validation_failed":
      return {
        id: event.id,
        taskId,
        title: taskTitle ? `Validation failed 路 ${taskTitle}` : "Validation failed",
        summary:
          typeof payload.summary === "string"
            ? payload.summary
            : inspection.summary.latestValidation ?? "Validation reported a failure.",
        timestamp: event.timestamp,
        source: "validation_failed",
      };
    default:
      return undefined;
  }
}

export function buildStageLabel(inspection: RunInspection): string {
  const completed = inspection.summary.completedTasks;
  const total = Object.keys(inspection.graph.tasks).length;
  const status = inspection.run.status.replaceAll("_", " ");
  const activeTask = inspection.run.currentTaskId
    ? inspection.graph.tasks[inspection.run.currentTaskId]?.title
    : undefined;

  return activeTask
    ? `${status} 路 ${completed}/${total} complete 路 ${activeTask}`
    : `${status} 路 ${completed}/${total} complete`;
}

export function buildDependencySummaryText(
  taskTitle: string,
  upstreamPendingCount: number,
  upstreamBlockedCount: number,
  downstreamReadyCount: number,
  downstreamWaitingCount: number,
): string {
  if (upstreamBlockedCount > 0) {
    return `${taskTitle} still has ${upstreamBlockedCount} blocked upstream dependency(ies).`;
  }
  if (upstreamPendingCount > 0) {
    return `${taskTitle} is waiting on ${upstreamPendingCount} unfinished upstream dependency(ies).`;
  }
  if (downstreamReadyCount > 0) {
    return `${downstreamReadyCount} downstream task(s) are ready to move once ${taskTitle} settles.`;
  }
  if (downstreamWaitingCount > 0) {
    return `${downstreamWaitingCount} downstream task(s) still remain in pending state.`;
  }
  return `${taskTitle} currently has no outstanding dependency pressure.`;
}

export function isPendingMessageEvent(type: RunEvent["type"]): boolean {
  return (
    type === "agent_message" ||
    type === "approval_requested" ||
    type === "task_blocked" ||
    type === "task_failed" ||
    type === "validation_failed"
  );
}

export function resolveHighestRiskLevel(
  ...groups: Array<Array<InspectionApprovalItem["riskLevel"] | TaskSpec["riskLevel"] | undefined>>
): WorkspaceRiskSummaryView["highestRiskLevel"] {
  let current: WorkspaceRiskSummaryView["highestRiskLevel"] = "none";

  for (const group of groups) {
    for (const value of group) {
      if (value === "high") {
        return "high";
      }
      if (value === "medium") {
        current = "medium";
      }
      if (value === "low" && current === "none") {
        current = "low";
      }
    }
  }

  return current;
}
