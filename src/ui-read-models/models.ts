import type { RiskLevel } from "../domain/models.js";

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

export interface RunListItemView {
  runId: string;
  goal: string;
  status: WorkspaceLaneStatus;
  stage: string;
  startedAt: string;
  updatedAt: string;
  activeLanes: number;
  blockedLanes: number;
  pendingApprovals: number;
  summary: string;
}
