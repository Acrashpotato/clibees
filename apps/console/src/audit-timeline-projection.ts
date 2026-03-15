import type { RiskLevel } from "./view-models";

export type AuditTimelineRunStatus =
  | "created"
  | "planning"
  | "ready"
  | "running"
  | "waiting_approval"
  | "replanning"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type AuditTimelineEntryKind =
  | "lifecycle"
  | "session"
  | "approval"
  | "validation"
  | "artifact"
  | "replan";
export type AuditTimelineEntrySourceMode = "run_event";
export type AuditTimelineApprovalSourceMode =
  | "approval_artifact"
  | "inspection_approval";
export type AuditTimelineValidationSourceMode =
  | "validation_record"
  | "task_status_backfill";
export type AuditTimelineArtifactSourceMode = "artifact_record";
export type AuditTimelineReplanSourceMode = "run_event";
export type AuditTimelineSessionSourceMode =
  | "run_event_backfill"
  | "task_status_backfill";

export interface AuditTimelineSummaryView {
  runStatus: AuditTimelineRunStatus;
  totalEventCount: number;
  approvalEventCount: number;
  validationEventCount: number;
  artifactEventCount: number;
  replanCount: number;
  sessionEventCount: number;
  latestEventAt?: string;
  latestFailure?: string;
  latestBlocker?: string;
  latestReplan?: string;
  latestValidation?: string;
}

export interface AuditTimelineEntryView {
  eventId: string;
  timestamp: string;
  kind: AuditTimelineEntryKind;
  type: string;
  title: string;
  details: string[];
  taskId?: string;
  taskTitle?: string;
  sessionId?: string;
  approvalRequestId?: string;
  artifactId?: string;
  sourceMode: AuditTimelineEntrySourceMode;
}

export interface AuditTimelineApprovalHistoryItemView {
  requestId: string;
  taskId?: string;
  taskTitle: string;
  summary: string;
  state: "pending" | "approved" | "rejected";
  riskLevel: RiskLevel | "none";
  requestedAt: string;
  decidedAt?: string;
  actor?: string;
  note?: string;
  sessionId?: string;
  sourceMode: AuditTimelineApprovalSourceMode;
}

export interface AuditTimelineValidationRecordView {
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  outcome?: string;
  summary: string;
  details: string[];
  updatedAt?: string;
  sessionId?: string;
  sourceMode: AuditTimelineValidationSourceMode;
}

export interface AuditTimelineArtifactHighlightView {
  artifactId: string;
  kind: string;
  uri: string;
  summary: string;
  createdAt: string;
  sessionId?: string;
}

export interface AuditTimelineArtifactGroupView {
  taskId?: string;
  taskTitle: string;
  totalCount: number;
  latestCreatedAt?: string;
  artifactKinds: string[];
  highlights: AuditTimelineArtifactHighlightView[];
  sourceMode: AuditTimelineArtifactSourceMode;
}

export interface AuditTimelineReplanRecordView {
  eventId: string;
  type: "replan_requested" | "replan_applied";
  timestamp: string;
  title: string;
  details: string[];
  taskId?: string;
  taskTitle?: string;
  sourceMode: AuditTimelineReplanSourceMode;
}

export interface AuditTimelineSessionEventView {
  eventId: string;
  sessionId: string;
  taskId: string;
  taskTitle: string;
  timestamp: string;
  type: string;
  title: string;
  summary: string;
  sourceMode: AuditTimelineSessionSourceMode;
}

export interface AuditTimelineProjectionView {
  projection: "audit_timeline";
  generatedAt: string;
  runId: string;
  graphRevision: number;
  summary: AuditTimelineSummaryView;
  entries: AuditTimelineEntryView[];
  approvals: AuditTimelineApprovalHistoryItemView[];
  validations: AuditTimelineValidationRecordView[];
  artifacts: AuditTimelineArtifactGroupView[];
  replans: AuditTimelineReplanRecordView[];
  sessionEvents: AuditTimelineSessionEventView[];
}

export function createEmptyAuditTimelineProjection(
  runId = "",
): AuditTimelineProjectionView {
  return {
    projection: "audit_timeline",
    generatedAt: "",
    runId,
    graphRevision: 0,
    summary: {
      runStatus: "paused",
      totalEventCount: 0,
      approvalEventCount: 0,
      validationEventCount: 0,
      artifactEventCount: 0,
      replanCount: 0,
      sessionEventCount: 0,
    },
    entries: [],
    approvals: [],
    validations: [],
    artifacts: [],
    replans: [],
    sessionEvents: [],
  };
}