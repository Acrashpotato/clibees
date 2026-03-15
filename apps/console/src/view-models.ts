// Canonical console view models stay task/session-centric even while the
// legacy workspace endpoints still expose lane-shaped payloads.
export type ExecutionStatus =
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
  title: string;
  summary: string;
  riskLevel: RiskLevel;
  requestedAt: string;
  actions: string[];
}

export interface TaskHandoffView {
  id: string;
  fromTaskId: string;
  toTaskId: string;
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
  taskId?: string;
  kind: "approval" | "blocked" | "issue";
  priority: number;
  tone: "neutral" | "warning" | "danger";
  sourceLabel: string;
  title: string;
  summary: string;
  recommendedActionLabel: string;
  actionTo?: string;
}

export interface WorkspaceTaskCardView {
  taskId: string;
  agentId: string;
  role: string;
  status: ExecutionStatus;
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
  runStatus: ExecutionStatus;
  stage: string;
  metrics: WorkspaceMetric[];
  tasks: WorkspaceTaskCardView[];
  approvals: ApprovalItem[];
  handoffs: TaskHandoffView[];
  focusTaskId: string;
  issues: string[];
  createdAt: string;
  updatedAt: string;
  canResume: boolean;
}

export interface RunSummaryView {
  runId: string;
  goal: string;
  status: ExecutionStatus;
  stage: string;
  startedAt: string;
  updatedAt: string;
  activeTaskCount: number;
  activeSessionCount: number;
  blockedTaskCount: number;
  pendingApprovalCount: number;
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
