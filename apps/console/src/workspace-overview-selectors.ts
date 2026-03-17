import type {
  WorkspaceProjectionActionQueueItem,
  WorkspaceProjectionPendingMessageItem,
  WorkspaceProjectionRiskLevel,
  WorkspaceProjectionStatus,
  WorkspaceProjectionView,
} from "./workspace-projection";

export interface WorkspaceOverviewRunSnapshot {
  runId: string;
  goal: string;
  stage: string;
  status: WorkspaceProjectionStatus;
  canResume: boolean;
  totalTaskCount: number;
  activeTaskCount: number;
  blockedTaskCount: number;
  pendingApprovalCount: number;
  completedTaskCount: number;
}

export interface WorkspaceOverviewFocusTask {
  taskId: string;
  title: string;
  status: WorkspaceProjectionStatus;
  riskLevel: WorkspaceProjectionRiskLevel;
  statusReason: string;
  ownerLabel: string;
  lastActivityAt: string;
  dependsOnCount: number;
  downstreamCount: number;
}

export interface WorkspaceOverviewBlockerItem {
  id: string;
  title: string;
  summary: string;
  status: "blocked" | "failed";
  priority: number;
  targetType: "task" | "task_session" | "inspect";
  targetId?: string;
  source: "blocked_task" | "task_blocked" | "task_failed" | "validation_failed";
}

export interface WorkspaceOverviewNextAction {
  kind: "resume" | "navigate";
  title: string;
  summary: string;
  targetType?: "task" | "task_session" | "inspect";
  targetId?: string;
}

export interface WorkspaceOverviewViewModel {
  run: WorkspaceOverviewRunSnapshot;
  focusTask?: WorkspaceOverviewFocusTask;
  blockers: WorkspaceOverviewBlockerItem[];
  nextAction?: WorkspaceOverviewNextAction;
}

function priorityFromPendingSource(source: WorkspaceProjectionPendingMessageItem["source"]): number {
  switch (source) {
    case "task_failed":
      return 0;
    case "task_blocked":
      return 1;
    default:
      return 2;
  }
}

function blockerFromActionItem(
  item: WorkspaceProjectionActionQueueItem,
): WorkspaceOverviewBlockerItem | undefined {
  if (item.kind !== "blocked_task") {
    return undefined;
  }

  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    status: item.tone === "danger" ? "failed" : "blocked",
    priority: item.priority,
    targetType: item.targetType === "task" ? "task" : item.targetType === "task_session" ? "task_session" : "inspect",
    targetId: item.targetType === "task" || item.targetType === "task_session" ? item.targetId : undefined,
    source: "blocked_task",
  };
}

function blockerFromPendingMessage(
  message: WorkspaceProjectionPendingMessageItem,
): WorkspaceOverviewBlockerItem | undefined {
  if (
    message.source !== "task_blocked" &&
    message.source !== "task_failed" &&
    message.source !== "validation_failed"
  ) {
    return undefined;
  }

  return {
    id: message.id,
    title: message.title,
    summary: message.summary,
    status: message.source === "task_failed" ? "failed" : "blocked",
    priority: priorityFromPendingSource(message.source),
    targetType: message.taskId ? "task" : "inspect",
    targetId: message.taskId,
    source: message.source,
  };
}

export function selectWorkspaceOverviewViewModel(
  projection: WorkspaceProjectionView,
): WorkspaceOverviewViewModel {
  const blockers: WorkspaceOverviewBlockerItem[] = [];

  for (const item of projection.actionQueue) {
    const mapped = blockerFromActionItem(item);
    if (mapped) {
      blockers.push(mapped);
    }
  }

  for (const message of projection.pendingMessages.items) {
    const mapped = blockerFromPendingMessage(message);
    if (mapped) {
      blockers.push(mapped);
    }
  }

  blockers.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.title.localeCompare(right.title);
  });

  const uniqueBlockers = blockers.filter(
    (item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index,
  );

  const focusTask = projection.focusTask
    ? {
        taskId: projection.focusTask.taskId,
        title: projection.focusTask.title,
        status: projection.focusTask.status,
        riskLevel: projection.focusTask.riskLevel,
        statusReason: projection.focusTask.statusReason,
        ownerLabel: projection.focusTask.ownerLabel,
        lastActivityAt: projection.focusTask.lastActivityAt,
        dependsOnCount: projection.focusTask.dependsOn.length,
        downstreamCount: projection.focusTask.downstreamTaskIds.length,
      }
    : undefined;

  const nextAction = uniqueBlockers[0]
    ? {
        kind: "navigate" as const,
        title: uniqueBlockers[0].title,
        summary: uniqueBlockers[0].summary,
        targetType: uniqueBlockers[0].targetType,
        targetId: uniqueBlockers[0].targetId,
      }
    : projection.run.canResume
      ? {
          kind: "resume" as const,
          title: projection.run.goal,
          summary: projection.run.stage,
        }
      : focusTask
        ? {
            kind: "navigate" as const,
            title: focusTask.title,
            summary: focusTask.statusReason,
            targetType: "task" as const,
            targetId: focusTask.taskId,
          }
        : undefined;

  return {
    run: {
      runId: projection.run.runId,
      goal: projection.run.goal,
      stage: projection.run.stage,
      status: projection.run.status,
      canResume: projection.run.canResume,
      totalTaskCount: projection.run.totalTaskCount,
      activeTaskCount: projection.run.activeTaskCount,
      blockedTaskCount: projection.run.blockedTaskCount,
      pendingApprovalCount: projection.run.pendingApprovalCount,
      completedTaskCount: projection.run.completedTaskCount,
    },
    focusTask,
    blockers: uniqueBlockers,
    nextAction,
  };
}