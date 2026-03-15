import type { ArtifactKind, RiskLevel } from "../domain/models.js";

export type WorkspaceLaneStatus =
  | "running"
  | "awaiting_approval"
  | "blocked"
  | "paused"
  | "completed"
  | "failed";

export interface WorkspaceMetricView {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

export interface ApprovalQueueItemView {
  id: string;
  runId: string;
  taskId?: string;
  laneId: string;
  title: string;
  summary: string;
  riskLevel: RiskLevel;
  requestedAt: string;
  actions: string[];
}

export interface HandoffView {
  id: string;
  fromLaneId: string;
  toLaneId: string;
  title: string;
  summary: string;
  reason: string;
  ownerLabel: string;
  status: "queued" | "in_progress" | "delivered";
}

export interface ArtifactSummaryView {
  label: string;
  value: string;
}

export interface ValidationSummaryView {
  title: string;
  state: "pass" | "warn" | "fail";
}

export interface LaneView {
  laneId: string;
  agentId: string;
  role: string;
  status: WorkspaceLaneStatus;
  statusReason: string;
  currentTaskTitle: string;
  lastActivityAt: string;
  approvalState: string;
  riskLevel: RiskLevel;
  terminalPreview: string[];
  handoffHint: string;
  artifacts: ArtifactSummaryView[];
  validations: ValidationSummaryView[];
}

export interface WorkspaceView {
  runId: string;
  goal: string;
  runStatus: WorkspaceLaneStatus;
  stage: string;
  metrics: WorkspaceMetricView[];
  lanes: LaneView[];
  approvals: ApprovalQueueItemView[];
  handoffs: HandoffView[];
  focusLaneId: string;
  issues: string[];
  createdAt: string;
  updatedAt: string;
  canResume: boolean;
}

export type RunListSessionCountMode = "task_sessions" | "task_status_backfill";

export interface RunListItemView {
  runId: string;
  goal: string;
  status: WorkspaceLaneStatus;
  stage: string;
  startedAt: string;
  updatedAt: string;
  activeTaskCount: number;
  activeSessionCount: number;
  blockedTaskCount: number;
  pendingApprovalCount: number;
  sessionCountMode: RunListSessionCountMode;
  summary: string;
}


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

export interface WorkspaceRunSummaryView {
  runId: string;
  goal: string;
  status: WorkspaceLaneStatus;
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

export interface WorkspaceFocusTaskView {
  taskId: string;
  title: string;
  status: WorkspaceLaneStatus;
  statusReason: string;
  ownerLabel: string;
  riskLevel: RiskLevel;
  lastActivityAt: string;
  dependsOn: string[];
  downstreamTaskIds: string[];
  selectionMode: WorkspaceFocusSelectionMode;
}

export interface WorkspaceActiveSessionView {
  sessionId?: string;
  taskId: string;
  taskTitle: string;
  agentId: string;
  status: WorkspaceLaneStatus;
  statusReason: string;
  lastActivityAt: string;
  terminalPreview: string[];
  pendingApprovalCount: number;
  sourceMode: WorkspaceSessionSourceMode;
}

export interface WorkspaceActionQueueItemView {
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

export interface WorkspaceDependencySummaryView {
  focusTaskId?: string;
  upstreamPendingCount: number;
  upstreamBlockedCount: number;
  downstreamReadyCount: number;
  downstreamWaitingCount: number;
  summary: string;
}

export interface WorkspaceRiskSummaryView {
  highestRiskLevel: RiskLevel | "none";
  pendingApprovalCount: number;
  blockedTaskCount: number;
  failedTaskCount: number;
  warningCount: number;
  headlines: string[];
}

export interface WorkspacePendingMessageItemView {
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

export interface WorkspacePendingMessageSummaryView {
  pendingThreadCount: number;
  unreadMessageCount: number;
  latestMessageAt?: string;
  sourceMode: WorkspacePendingMessageSourceMode;
  summary: string;
  items: WorkspacePendingMessageItemView[];
}

export interface WorkspaceControlActionView {
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
  run: WorkspaceRunSummaryView;
  focusTask?: WorkspaceFocusTaskView;
  activeSession?: WorkspaceActiveSessionView;
  actionQueue: WorkspaceActionQueueItemView[];
  dependencySummary: WorkspaceDependencySummaryView;
  riskSummary: WorkspaceRiskSummaryView;
  pendingMessages: WorkspacePendingMessageSummaryView;
  controlActions: WorkspaceControlActionView[];
}

export type TaskBoardSessionSourceMode = "task_session" | "task_status_backfill";
export type TaskBoardRetrySourceMode = "task_record" | "status_event_backfill";
export type TaskBoardDependencyState = "satisfied" | "active" | "waiting" | "blocked";

export interface TaskBoardGraphSummaryView {
  totalTaskCount: number;
  completedTaskCount: number;
  activeTaskCount: number;
  blockedTaskCount: number;
  failedTaskCount: number;
  pendingApprovalCount: number;
  activeSessionCount: number;
  dependencyEdgeCount: number;
}

export interface TaskBoardActiveSessionView {
  sessionId?: string;
  agentId: string;
  status: WorkspaceLaneStatus;
  lastActivityAt: string;
  pendingApprovalCount: number;
  sourceMode: TaskBoardSessionSourceMode;
}

export interface TaskBoardRetrySummaryView {
  attempts?: number;
  maxAttempts: number;
  retryable: boolean;
  requeueRecommended: boolean;
  sourceMode: TaskBoardRetrySourceMode;
  lastFailureAt?: string;
  summary: string;
}

export interface TaskBoardTaskNodeView {
  taskId: string;
  title: string;
  kind: string;
  status: WorkspaceLaneStatus;
  statusReason: string;
  waitingReason?: string;
  ownerLabel: string;
  riskLevel: RiskLevel;
  dependsOn: string[];
  downstreamTaskIds: string[];
  depth: number;
  latestActivityAt: string;
  latestActivitySummary: string;
  activeSession?: TaskBoardActiveSessionView;
  retry: TaskBoardRetrySummaryView;
}

export interface TaskBoardDependencyEdgeView {
  edgeId: string;
  fromTaskId: string;
  toTaskId: string;
  state: TaskBoardDependencyState;
  summary: string;
}

export interface TaskBoardProjectionView {
  projection: "task_board";
  generatedAt: string;
  runId: string;
  graphRevision: number;
  currentTaskId?: string;
  summary: TaskBoardGraphSummaryView;
  tasks: TaskBoardTaskNodeView[];
  edges: TaskBoardDependencyEdgeView[];
}

export type TaskDetailSessionSourceMode =
  | "task_session"
  | "run_event_backfill"
  | "task_status_backfill";
export type TaskDetailValidationSourceMode = "validation_record" | "task_status_backfill";
export type TaskDetailApprovalSourceMode = "approval_request" | "inspection_approval";

export interface TaskDetailOverviewView {
  taskId: string;
  title: string;
  kind: string;
  goal: string;
  status: WorkspaceLaneStatus;
  statusReason: string;
  ownerLabel: string;
  riskLevel: RiskLevel;
  inputs: string[];
  acceptanceCriteria: string[];
  expectedArtifacts: string[];
  latestActivityAt: string;
  latestActivitySummary: string;
  sessionCount: number;
  activeSessionCount: number;
  pendingApprovalCount: number;
  artifactCount: number;
}

export interface TaskDetailDependencyItemView {
  taskId: string;
  title: string;
  kind: string;
  status: WorkspaceLaneStatus;
  statusReason: string;
  ownerLabel: string;
  latestActivityAt: string;
  latestActivitySummary: string;
}

export interface TaskDetailSessionSummaryView {
  sessionId?: string;
  label: string;
  status: WorkspaceLaneStatus;
  agentId: string;
  startedAt?: string;
  lastActivityAt: string;
  latestActivitySummary: string;
  pendingApprovalCount: number;
  sourceMode: TaskDetailSessionSourceMode;
}

export interface TaskDetailLatestApprovalView {
  requestId: string;
  state: "pending" | "approved" | "rejected";
  summary: string;
  riskLevel: RiskLevel | "none";
  requestedAt?: string;
  decidedAt?: string;
  actor?: string;
  sourceMode: TaskDetailApprovalSourceMode;
}

export interface TaskDetailValidationSummaryView {
  state: "pass" | "warn" | "fail";
  summary: string;
  details: string[];
  updatedAt?: string;
  sourceMode: TaskDetailValidationSourceMode;
}

export interface TaskDetailArtifactItemView {
  artifactId: string;
  kind: ArtifactKind;
  uri: string;
  summary: string;
  createdAt: string;
}

export interface TaskDetailArtifactSummaryView {
  totalCount: number;
  latestCreatedAt?: string;
  highlights: TaskDetailArtifactItemView[];
}

export interface TaskDetailProjectionView {
  projection: "task_detail";
  generatedAt: string;
  runId: string;
  graphRevision: number;
  taskId: string;
  overview: TaskDetailOverviewView;
  upstream: TaskDetailDependencyItemView[];
  downstream: TaskDetailDependencyItemView[];
  sessions: TaskDetailSessionSummaryView[];
  latestApproval?: TaskDetailLatestApprovalView;
  validation: TaskDetailValidationSummaryView;
  artifacts: TaskDetailArtifactSummaryView;
}


export type SessionDetailSourceMode = "task_session" | "run_event_backfill" | "task_status_backfill";
export type SessionDetailMessageSourceMode = "session_message" | "run_event_agent_message";
export type SessionDetailToolSourceMode = "tool_call" | "artifact_record" | "invocation_event_backfill";
export type SessionDetailApprovalSourceMode = "approval_request" | "inspection_approval";
export type SessionDetailValidationSourceMode = "validation_record" | "task_status_backfill";
export type SessionDetailTerminalSourceMode = "transcript_stream" | "agent_message_backfill" | "task_status_backfill";

export interface SessionDetailOverviewView {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  taskKind: string;
  status: WorkspaceLaneStatus;
  statusReason: string;
  agentId: string;
  ownerLabel: string;
  startedAt?: string;
  lastActivityAt: string;
  latestActivitySummary: string;
  pendingApprovalCount: number;
  transcriptPath?: string;
  sourceMode: SessionDetailSourceMode;
}

export interface SessionDetailMessageItemView {
  messageId: string;
  timestamp: string;
  stream: "stdout" | "stderr";
  senderLabel: string;
  text: string;
  sourceMode: SessionDetailMessageSourceMode;
}

export interface SessionDetailToolCallItemView {
  toolCallId: string;
  label: string;
  command: string;
  args: string[];
  cwd?: string;
  status: "planned" | "completed" | "failed";
  startedAt?: string;
  finishedAt: string;
  summary: string;
  sourceMode: SessionDetailToolSourceMode;
}

export interface SessionDetailApprovalItemView {
  requestId: string;
  state: "pending" | "approved" | "rejected";
  summary: string;
  riskLevel: RiskLevel | "none";
  requestedAt?: string;
  decidedAt?: string;
  actor?: string;
  sourceMode: SessionDetailApprovalSourceMode;
}

export interface SessionDetailValidationSummaryView {
  state: "pass" | "warn" | "fail";
  summary: string;
  details: string[];
  updatedAt?: string;
  sourceMode: SessionDetailValidationSourceMode;
}

export interface SessionDetailArtifactItemView {
  artifactId: string;
  kind: ArtifactKind;
  uri: string;
  summary: string;
  createdAt: string;
}

export interface SessionDetailArtifactSummaryView {
  totalCount: number;
  latestCreatedAt?: string;
  items: SessionDetailArtifactItemView[];
}

export interface SessionDetailTerminalPreviewView {
  transcriptPath?: string;
  lines: string[];
  sourceMode: SessionDetailTerminalSourceMode;
}

export interface SessionDetailProjectionView {
  projection: "session_detail";
  generatedAt: string;
  runId: string;
  graphRevision: number;
  sessionId: string;
  overview: SessionDetailOverviewView;
  messages: SessionDetailMessageItemView[];
  toolCalls: SessionDetailToolCallItemView[];
  approvals: SessionDetailApprovalItemView[];
  validation: SessionDetailValidationSummaryView;
  artifacts: SessionDetailArtifactSummaryView;
  terminalPreview: SessionDetailTerminalPreviewView;
}


export type ApprovalQueueItemState = "pending" | "approved" | "rejected";
export type ApprovalQueueItemSourceMode = "approval_artifact" | "inspection_approval";
export type ApprovalQueueSessionSourceMode = "run_event_backfill" | "task_status_backfill";

export interface ApprovalQueueActionPlanSnapshotView {
  actionPlanId: string;
  kind: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  reason: string;
  command?: string;
  args: string[];
  cwd?: string;
  targets: string[];
}

export interface ApprovalQueueSessionBindingView {
  sessionId: string;
  label: string;
  sourceMode: ApprovalQueueSessionSourceMode;
}

export interface ApprovalQueueItemDetailView {
  requestId: string;
  runId: string;
  taskId?: string;
  taskTitle: string;
  summary: string;
  state: ApprovalQueueItemState;
  riskLevel: RiskLevel | "none";
  requestedAt: string;
  decidedAt?: string;
  actor?: string;
  note?: string;
  session?: ApprovalQueueSessionBindingView;
  actionPlanCount: number;
  actionPlans: ApprovalQueueActionPlanSnapshotView[];
  sourceMode: ApprovalQueueItemSourceMode;
}

export interface ApprovalQueueSummaryView {
  totalCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
}

export interface ApprovalQueueProjectionView {
  projection: "approval_queue";
  generatedAt: string;
  summary: ApprovalQueueSummaryView;
  items: ApprovalQueueItemDetailView[];
}
