import type { RiskLevel } from "./view-models";

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

export function createEmptyApprovalQueueProjection(): ApprovalQueueProjectionView {
  return {
    projection: "approval_queue",
    generatedAt: "",
    summary: {
      totalCount: 0,
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      highRiskCount: 0,
      mediumRiskCount: 0,
      lowRiskCount: 0,
    },
    items: [],
  };
}
