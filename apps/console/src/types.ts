export type LaneStatus =
  | "running"
  | "awaiting_approval"
  | "blocked"
  | "paused"
  | "completed"
  | "failed";

export type RiskLevel = "low" | "medium" | "high";

export interface WorkspaceMetric {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

export interface ApprovalItem {
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

export interface ArtifactSummary {
  label: string;
  value: string;
}

export interface ValidationSummary {
  title: string;
  state: "pass" | "warn" | "fail";
}

export interface ActionQueueItem {
  id: string;
  runId?: string;
  requestId?: string;
  laneId?: string;
  kind: "approval" | "blocked" | "issue";
  priority: number;
  tone: "neutral" | "warning" | "danger";
  sourceLabel: string;
  title: string;
  summary: string;
  recommendedActionLabel: string;
  actionTo?: string;
}

export interface LaneView {
  laneId: string;
  agentId: string;
  role: string;
  status: LaneStatus;
  statusReason: string;
  currentTaskTitle: string;
  lastActivityAt: string;
  approvalState: string;
  riskLevel: RiskLevel;
  terminalPreview: string[];
  handoffHint: string;
  artifacts: ArtifactSummary[];
  validations: ValidationSummary[];
}

export interface WorkspaceView {
  runId: string;
  goal: string;
  runStatus: LaneStatus;
  stage: string;
  metrics: WorkspaceMetric[];
  lanes: LaneView[];
  approvals: ApprovalItem[];
  handoffs: HandoffView[];
  focusLaneId: string;
  issues: string[];
  createdAt: string;
  updatedAt: string;
  canResume: boolean;
}

export interface RunSummaryView {
  runId: string;
  goal: string;
  status: LaneStatus;
  stage: string;
  startedAt: string;
  updatedAt: string;
  activeLanes: number;
  blockedLanes: number;
  pendingApprovals: number;
  summary: string;
}

export interface InspectTimelineEntry {
  eventId: string;
  type: string;
  timestamp: string;
  taskId?: string;
  title: string;
  details: string[];
}

export interface InspectSummaryView {
  runStatus: string;
  completedTasks: number;
  failedTasks: number;
  blockedTasks: number;
  pendingApprovals: number;
  latestFailure?: string;
  latestBlocker?: string;
  latestReplan?: string;
  latestValidation?: string;
}

export interface InspectView {
  run: {
    runId: string;
    goal: string;
    status: string;
    currentTaskId?: string;
    createdAt: string;
    updatedAt: string;
  };
  timeline: InspectTimelineEntry[];
  approvals: Array<{
    requestId: string;
    taskId?: string;
    summary: string;
    state: "pending" | "approved" | "rejected";
    actor?: string;
    decidedAt?: string;
    riskLevel?: RiskLevel;
  }>;
  validation: Array<{
    taskId: string;
    taskTitle: string;
    taskStatus: string;
    outcome?: string;
    summary: string;
    details: string[];
    updatedAt?: string;
  }>;
  artifacts: Array<{
    taskId?: string;
    taskTitle: string;
    artifacts: Array<{
      id: string;
      kind: string;
      uri: string;
      summary: string;
      createdAt: string;
    }>;
  }>;
  summary: InspectSummaryView;
}
