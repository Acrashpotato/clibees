import type {
  AuditTimelineApprovalHistoryItemView,
  AuditTimelineEntryKind,
  AuditTimelineRunStatus,
} from "../../../audit-timeline-projection";

type CopyFn = (zh: string, en: string) => string;

export function runStatusLabel(status: AuditTimelineRunStatus, copy: CopyFn): string {
  switch (status) {
    case "created":
      return copy("已创建", "Created");
    case "planning":
      return copy("规划中", "Planning");
    case "ready":
      return copy("就绪", "Ready");
    case "running":
      return copy("运行中", "Running");
    case "waiting_approval":
      return copy("待审批", "Waiting approval");
    case "replanning":
      return copy("重规划中", "Replanning");
    case "paused":
      return copy("已暂停", "Paused");
    case "completed":
      return copy("已完成", "Completed");
    case "failed":
      return copy("失败", "Failed");
    case "cancelled":
      return copy("已取消", "Cancelled");
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

export function eventKindLabel(kind: AuditTimelineEntryKind, copy: CopyFn): string {
  switch (kind) {
    case "lifecycle":
      return copy("生命周期", "Lifecycle");
    case "session":
      return copy("会话", "Session");
    case "approval":
      return copy("审批", "Approval");
    case "validation":
      return copy("验证", "Validation");
    case "artifact":
      return copy("产物", "Artifact");
    case "replan":
      return copy("重规划", "Replan");
  }
}

export function approvalStateLabel(
  state: AuditTimelineApprovalHistoryItemView["state"],
  copy: CopyFn,
): string {
  switch (state) {
    case "pending":
      return copy("待处理", "Pending");
    case "approved":
      return copy("已批准", "Approved");
    case "rejected":
      return copy("已拒绝", "Rejected");
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

export function sourceLabel(sourceMode: string, copy: CopyFn): string {
  switch (sourceMode) {
    case "run_event":
      return copy("运行事件", "Run event");
    case "approval_artifact":
      return copy("审批快照", "Approval artifact");
    case "inspection_approval":
      return copy("审计回填", "Inspection fallback");
    case "validation_record":
      return copy("验证记录", "Validation record");
    case "task_status_backfill":
      return copy("状态回填", "Status backfill");
    case "artifact_record":
      return copy("产物记录", "Artifact record");
    case "run_event_backfill":
      return copy("事件回填", "Event backfill");
    default:
      return sourceMode.replaceAll("_", " ");
  }
}
