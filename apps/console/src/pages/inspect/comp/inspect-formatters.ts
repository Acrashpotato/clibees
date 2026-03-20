import type {
  AuditTimelineApprovalHistoryItemView,
  AuditTimelineEntryKind,
  AuditTimelineRunStatus,
} from "../../../audit-timeline-projection";

export function runStatusLabel(status: AuditTimelineRunStatus): string {
  switch (status) {
    case "created":
      return "已创建";
    case "planning":
      return "规划中";
    case "ready":
      return "就绪";
    case "running":
      return "运行中";
    case "waiting_approval":
      return "待审批";
    case "replanning":
      return "重规划中";
    case "paused":
      return "已暂停";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

export function runStatusPill(
  status: AuditTimelineRunStatus,
): "running" | "awaiting_approval" | "paused" | "completed" | "failed" {
  switch (status) {
    case "running":
    case "planning":
    case "replanning":
      return "running";
    case "waiting_approval":
      return "awaiting_approval";
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      return "paused";
  }
}

export function eventKindLabel(kind: AuditTimelineEntryKind): string {
  switch (kind) {
    case "lifecycle":
      return "生命周期";
    case "session":
      return "会话";
    case "approval":
      return "审批";
    case "validation":
      return "验证";
    case "artifact":
      return "产物";
    case "replan":
      return "重规划";
  }
}

export function approvalStateLabel(
  state: AuditTimelineApprovalHistoryItemView["state"],
): string {
  switch (state) {
    case "pending":
      return "待处理";
    case "approved":
      return "已批准";
    case "rejected":
      return "已拒绝";
  }
}

export function approvalStatePill(
  state: AuditTimelineApprovalHistoryItemView["state"],
): "awaiting_approval" | "completed" | "failed" {
  switch (state) {
    case "pending":
      return "awaiting_approval";
    case "approved":
      return "completed";
    case "rejected":
      return "failed";
  }
}

export function riskTone(
  riskLevel: AuditTimelineApprovalHistoryItemView["riskLevel"],
): "low" | "medium" | "high" {
  return riskLevel === "none" ? "low" : riskLevel;
}

export function sourceLabel(sourceMode: string): string {
  switch (sourceMode) {
    case "run_event":
      return "运行事件";
    case "approval_artifact":
      return "审批快照";
    case "inspection_approval":
      return "审计回填";
    case "validation_record":
      return "验证记录";
    case "task_status_backfill":
      return "状态回填";
    case "artifact_record":
      return "产物记录";
    case "run_event_backfill":
      return "事件回填";
    default:
      return sourceMode.replaceAll("_", " ");
  }
}
