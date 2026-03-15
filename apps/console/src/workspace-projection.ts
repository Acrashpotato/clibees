export type WorkspaceProjectionStatus =
  | "running"
  | "awaiting_approval"
  | "blocked"
  | "paused"
  | "completed"
  | "failed";

export type WorkspaceProjectionRiskLevel = "low" | "medium" | "high";
export type WorkspaceFocusSelectionMode =
  | "run_current_task"
  | "approval_priority"
  | "blocked_priority"
  | "active_fallback"
  | "first_task_fallback";
export type WorkspaceSessionSourceMode = "task_session" | "task_status_backfill";
export type WorkspacePendingMessageSourceMode = "thread_messages" | "run_event_backfill";
export type WorkspaceControlActionId =
  | "resume"
  | "review_approval"
  | "interact"
  | "requeue"
  | "cancel"
  | "interrupt";

export interface UiProjectionEnvelope<TProjection> {
  data: TProjection;
}

export interface WorkspaceProjectionRunSummary {
  runId: string;
  goal: string;
  status: WorkspaceProjectionStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  totalTaskCount: number;
  completedTaskCount: number;
  activeTaskCount: number;
  activeSessionCount: number;
  blockedTaskCount: number;
  pendingApprovalCount: number;
  sessionSourceMode: WorkspaceSessionSourceMode;
  canResume: boolean;
}

export interface WorkspaceProjectionFocusTask {
  taskId: string;
  title: string;
  status: WorkspaceProjectionStatus;
  statusReason: string;
  ownerLabel: string;
  riskLevel: WorkspaceProjectionRiskLevel;
  lastActivityAt: string;
  dependsOn: string[];
  downstreamTaskIds: string[];
  selectionMode: WorkspaceFocusSelectionMode;
}

export interface WorkspaceProjectionActiveSession {
  sessionId?: string;
  taskId: string;
  taskTitle: string;
  agentId: string;
  status: WorkspaceProjectionStatus;
  statusReason: string;
  lastActivityAt: string;
  terminalPreview: string[];
  pendingApprovalCount: number;
  sourceMode: WorkspaceSessionSourceMode;
}

export interface WorkspaceProjectionActionQueueItem {
  id: string;
  kind: "approval_request" | "blocked_task" | "pending_message" | "risk" | "run_control";
  title: string;
  summary: string;
  priority: number;
  tone: "neutral" | "warning" | "danger";
  targetType: "run" | "task" | "task_session" | "approval_request" | "thread";
  targetId: string;
  recommendedAction: WorkspaceControlActionId | "inspect";
}

export interface WorkspaceProjectionDependencySummary {
  focusTaskId?: string;
  upstreamPendingCount: number;
  upstreamBlockedCount: number;
  downstreamReadyCount: number;
  downstreamWaitingCount: number;
  summary: string;
}

export interface WorkspaceProjectionRiskSummary {
  highestRiskLevel: WorkspaceProjectionRiskLevel | "none";
  pendingApprovalCount: number;
  blockedTaskCount: number;
  failedTaskCount: number;
  warningCount: number;
  headlines: string[];
}

export interface WorkspaceProjectionPendingMessageItem {
  id: string;
  taskId?: string;
  title: string;
  summary: string;
  timestamp: string;
  source:
    | "agent_message"
    | "approval_requested"
    | "task_blocked"
    | "task_failed"
    | "validation_failed";
}

export interface WorkspaceProjectionPendingMessageSummary {
  pendingThreadCount: number;
  unreadMessageCount: number;
  latestMessageAt?: string;
  sourceMode: WorkspacePendingMessageSourceMode;
  summary: string;
  items: WorkspaceProjectionPendingMessageItem[];
}

export interface WorkspaceProjectionControlAction {
  actionId: WorkspaceControlActionId;
  label: string;
  scope: "run" | "task" | "task_session" | "approval_request" | "thread";
  targetId: string;
  enabled: boolean;
  reason: string;
}

export interface WorkspaceProjectionView {
  projection: "workspace";
  generatedAt: string;
  run: WorkspaceProjectionRunSummary;
  focusTask?: WorkspaceProjectionFocusTask;
  activeSession?: WorkspaceProjectionActiveSession;
  actionQueue: WorkspaceProjectionActionQueueItem[];
  dependencySummary: WorkspaceProjectionDependencySummary;
  riskSummary: WorkspaceProjectionRiskSummary;
  pendingMessages: WorkspaceProjectionPendingMessageSummary;
  controlActions: WorkspaceProjectionControlAction[];
}

export function createEmptyWorkspaceProjection(runId = "workspace"): WorkspaceProjectionView {
  return {
    projection: "workspace",
    generatedAt: "",
    run: {
      runId,
      goal: "No run selected.",
      status: "paused",
      stage: "Open a run from the Runs page or create a new one.",
      createdAt: "",
      updatedAt: "",
      totalTaskCount: 0,
      completedTaskCount: 0,
      activeTaskCount: 0,
      activeSessionCount: 0,
      blockedTaskCount: 0,
      pendingApprovalCount: 0,
      sessionSourceMode: "task_status_backfill",
      canResume: false,
    },
    actionQueue: [],
    dependencySummary: {
      upstreamPendingCount: 0,
      upstreamBlockedCount: 0,
      downstreamReadyCount: 0,
      downstreamWaitingCount: 0,
      summary: "Load a run to inspect dependency pressure.",
    },
    riskSummary: {
      highestRiskLevel: "none",
      pendingApprovalCount: 0,
      blockedTaskCount: 0,
      failedTaskCount: 0,
      warningCount: 0,
      headlines: [],
    },
    pendingMessages: {
      pendingThreadCount: 0,
      unreadMessageCount: 0,
      sourceMode: "run_event_backfill",
      summary: "Load a run to inspect recent message traffic.",
      items: [],
    },
    controlActions: [],
  };
}
