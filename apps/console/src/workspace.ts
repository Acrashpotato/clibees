import type { Locale } from "./i18n";
import { translate } from "./i18n";
import type { ActionQueueItem, LaneView, WorkspaceView } from "./types";

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

export function getLaneConsolePath(runId: string, laneId?: string): string {
  const basePath = `/runs/${encodeURIComponent(runId)}/lanes`;
  return laneId ? `${basePath}/${encodeURIComponent(laneId)}` : basePath;
}

export function getFocusLane(workspace: WorkspaceView): LaneView {
  return workspace.lanes.find((lane) => lane.laneId === workspace.focusLaneId) ?? workspace.lanes[0]!;
}

export function getActionQueue(workspace: WorkspaceView, locale: Locale): ActionQueueItem[] {
  const approvals = workspace.approvals.map<ActionQueueItem>((approval) => ({
    id: approval.id,
    runId: approval.runId,
    requestId: approval.id,
    laneId: approval.laneId,
    kind: "approval",
    priority: 0,
    tone: approval.riskLevel === "high" ? "danger" : "warning",
    sourceLabel: approval.laneId,
    title: approval.title,
    summary: approval.summary,
    recommendedActionLabel: translate(locale, "actions.handleDecision"),
    actionTo: `/approvals?runId=${encodeURIComponent(approval.runId)}&requestId=${encodeURIComponent(approval.id)}`,
  }));

  const blockedLanes = workspace.lanes
    .filter((lane) => lane.status === "blocked" || lane.status === "awaiting_approval")
    .map<ActionQueueItem>((lane) => ({
      id: `lane-${lane.laneId}-${lane.status}`,
      laneId: lane.laneId,
      kind: "blocked",
      priority: lane.status === "blocked" ? 1 : 2,
      tone: lane.status === "blocked" ? "danger" : "warning",
      sourceLabel: lane.laneId,
      title: lane.currentTaskTitle,
      summary: lane.statusReason,
      recommendedActionLabel: translate(locale, "actions.openLane"),
      actionTo: getLaneConsolePath(workspace.runId, lane.laneId),
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

  return [...approvals, ...blockedLanes, ...issues].sort(
    (left, right) => left.priority - right.priority || left.title.localeCompare(right.title),
  );
}

export function getWorkspaceCounts(workspace: WorkspaceView) {
  return {
    lanes: workspace.lanes.length,
    blocked: workspace.lanes.filter((lane) => lane.status === "blocked").length,
    approvals: workspace.approvals.length,
    handoffs: workspace.handoffs.length,
    issues: workspace.issues.length,
    pending: workspace.approvals.length + workspace.lanes.filter((lane) => lane.status !== "completed").length,
  };
}

export function createEmptyWorkspace(runId = "workspace"): WorkspaceView {
  return {
    runId,
    goal: "No run selected.",
    runStatus: "paused",
    stage: "Open a run from the Runs page or create a new one.",
    metrics: [],
    lanes: [
      {
        laneId: "idle",
        agentId: "system",
        role: "Idle lane",
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
    focusLaneId: "idle",
    issues: [],
    createdAt: "",
    updatedAt: "",
    canResume: false,
  };
}
