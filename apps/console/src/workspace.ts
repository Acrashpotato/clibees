import type { ActionQueueItem, WorkspaceTaskCardView, WorkspaceView } from "./view-models";
import type { Locale } from "./i18n";
import { translate } from "./i18n";

export type WorkspaceSectionKey = "overview" | "lanes" | "handoffs" | "focus";

export function getWorkspaceBasePath(runId?: string): string {
  return runId ? `/runs/${encodeURIComponent(runId)}/workspace` : "/workspace";
}

export function getWorkspacePath(section: WorkspaceSectionKey, runId?: string): string {
  const basePath = getWorkspaceBasePath(runId);

  if (section === "overview") {
    return basePath;
  }

  return `${basePath}/${section}`;
}

export function getTaskDetailPath(runId: string, taskId: string): string {
  return `/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}`;
}

export function getSessionDetailPath(runId: string, sessionId: string): string {
  return `/runs/${encodeURIComponent(runId)}/sessions/${encodeURIComponent(sessionId)}`;
}

export function getLegacyLanePath(runId: string, laneId?: string): string {
  const basePath = `/runs/${encodeURIComponent(runId)}/lanes`;
  return laneId ? `${basePath}/${encodeURIComponent(laneId)}` : basePath;
}

export function getTaskConsolePath(runId: string, taskId?: string): string {
  return taskId ? getTaskDetailPath(runId, taskId) : getLegacyLanePath(runId);
}

export function getFocusTask(workspace: WorkspaceView): WorkspaceTaskCardView {
  return workspace.tasks.find((task) => task.taskId === workspace.focusTaskId) ?? workspace.tasks[0]!;
}

export function getActionQueue(workspace: WorkspaceView, locale: Locale): ActionQueueItem[] {
  const approvals = workspace.approvals.map<ActionQueueItem>((approval) => ({
    id: approval.id,
    runId: approval.runId,
    requestId: approval.id,
    ...(approval.taskId ? { taskId: approval.taskId } : {}),
    kind: "approval",
    priority: 0,
    tone: approval.riskLevel === "high" ? "danger" : "warning",
    sourceLabel: approval.taskId ?? approval.id,
    title: approval.title,
    summary: approval.summary,
    recommendedActionLabel: translate(locale, "actions.handleDecision"),
    actionTo: `/approvals?runId=${encodeURIComponent(approval.runId)}&requestId=${encodeURIComponent(approval.id)}`,
  }));

  const blockedTasks = workspace.tasks
    .filter((task) => task.status === "blocked" || task.status === "awaiting_approval")
    .map<ActionQueueItem>((task) => ({
      id: `task-${task.taskId}-${task.status}`,
      taskId: task.taskId,
      kind: "blocked",
      priority: task.status === "blocked" ? 1 : 2,
      tone: task.status === "blocked" ? "danger" : "warning",
      sourceLabel: task.taskId,
      title: task.currentTaskTitle,
      summary: task.statusReason,
      recommendedActionLabel: translate(locale, "actions.openLane"),
      actionTo: getTaskDetailPath(workspace.runId, task.taskId),
    }));

  const issues = workspace.issues.map<ActionQueueItem>((issue, index) => ({
    id: `issue-${index}`,
    kind: "issue",
    priority: 3,
    tone: "neutral",
    sourceLabel: `issue-${index + 1}`,
    title: issue,
    summary: workspace.stage,
    recommendedActionLabel: translate(locale, "actions.viewFocus"),
    actionTo: getWorkspacePath("focus", workspace.runId),
  }));

  return [...approvals, ...blockedTasks, ...issues].sort(
    (left, right) => left.priority - right.priority || left.title.localeCompare(right.title),
  );
}

export function getWorkspaceCounts(workspace: WorkspaceView) {
  return {
    tasks: workspace.tasks.length,
    blocked: workspace.tasks.filter((task) => task.status === "blocked").length,
    approvals: workspace.approvals.length,
    handoffs: workspace.handoffs.length,
    issues: workspace.issues.length,
    pending: workspace.approvals.length + workspace.tasks.filter((task) => task.status !== "completed").length,
  };
}

export function createEmptyWorkspace(runId = "workspace"): WorkspaceView {
  return {
    runId,
    goal: "No run selected.",
    runStatus: "paused",
    stage: "Open a run from the Runs page or create a new one.",
    metrics: [],
    tasks: [
      {
        taskId: "idle",
        agentId: "system",
        role: "Idle task",
        status: "paused",
        statusReason: "No run is loaded yet.",
        currentTaskTitle: "Open or create a run",
        lastActivityAt: "",
        approvalState: "No pending approval",
        riskLevel: "low",
        terminalPreview: ["No terminal output recorded yet."],
        handoffHint: "Load a run to populate the workspace.",
        artifacts: [],
        validations: [],
      },
    ],
    approvals: [],
    handoffs: [],
    focusTaskId: "idle",
    issues: [],
    createdAt: "",
    updatedAt: "",
    canResume: false,
  };
}
