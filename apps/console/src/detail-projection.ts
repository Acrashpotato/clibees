import type { ExecutionStatus, RiskLevel, ValidationSummary } from "./view-models";

export type DetailProjectionStatus = ExecutionStatus;
export type DetailValidationState = ValidationSummary["state"];
export type TaskDetailSessionSourceMode =
  | "task_session"
  | "run_event_backfill"
  | "task_status_backfill";
export type TaskDetailValidationSourceMode = "validation_record" | "task_status_backfill";
export type TaskDetailApprovalSourceMode = "approval_request" | "inspection_approval";
export type SessionDetailSourceMode = "task_session" | "run_event_backfill" | "task_status_backfill";
export type SessionDetailMessageSourceMode = "session_message" | "run_event_agent_message";
export type SessionDetailToolSourceMode = "tool_call" | "artifact_record" | "invocation_event_backfill";
export type SessionDetailApprovalSourceMode = "approval_request" | "inspection_approval";
export type SessionDetailValidationSourceMode = "validation_record" | "task_status_backfill";
export type SessionDetailTerminalSourceMode =
  | "transcript_stream"
  | "agent_message_backfill"
  | "task_status_backfill";

export interface TaskDetailOverviewView {
  taskId: string;
  title: string;
  kind: string;
  goal: string;
  status: DetailProjectionStatus;
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
  status: DetailProjectionStatus;
  statusReason: string;
  ownerLabel: string;
  latestActivityAt: string;
  latestActivitySummary: string;
}

export interface TaskDetailSessionSummaryView {
  sessionId?: string;
  label: string;
  status: DetailProjectionStatus;
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
  state: DetailValidationState;
  summary: string;
  details: string[];
  updatedAt?: string;
  sourceMode: TaskDetailValidationSourceMode;
}

export interface TaskDetailArtifactItemView {
  artifactId: string;
  kind: string;
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

export interface SessionDetailOverviewView {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  taskKind: string;
  status: DetailProjectionStatus;
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
  state: DetailValidationState;
  summary: string;
  details: string[];
  updatedAt?: string;
  sourceMode: SessionDetailValidationSourceMode;
}

export interface SessionDetailArtifactItemView {
  artifactId: string;
  kind: string;
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

export function createEmptyTaskDetailProjection(
  runId = "workspace",
  taskId = "task",
): TaskDetailProjectionView {
  return {
    projection: "task_detail",
    generatedAt: "",
    runId,
    graphRevision: 0,
    taskId,
    overview: {
      taskId,
      title: "No task selected.",
      kind: "task",
      goal: "",
      status: "paused",
      statusReason: "Select a task to inspect.",
      ownerLabel: "unassigned",
      riskLevel: "low",
      inputs: [],
      acceptanceCriteria: [],
      expectedArtifacts: [],
      latestActivityAt: "",
      latestActivitySummary: "",
      sessionCount: 0,
      activeSessionCount: 0,
      pendingApprovalCount: 0,
      artifactCount: 0,
    },
    upstream: [],
    downstream: [],
    sessions: [],
    validation: {
      state: "warn",
      summary: "Validation data is not loaded yet.",
      details: [],
      sourceMode: "task_status_backfill",
    },
    artifacts: {
      totalCount: 0,
      highlights: [],
    },
  };
}

export function createEmptySessionDetailProjection(
  runId = "workspace",
  sessionId = "session",
): SessionDetailProjectionView {
  return {
    projection: "session_detail",
    generatedAt: "",
    runId,
    graphRevision: 0,
    sessionId,
    overview: {
      sessionId,
      taskId: "task",
      taskTitle: "No session selected.",
      taskKind: "task",
      status: "paused",
      statusReason: "Select a session to inspect.",
      agentId: "unassigned",
      ownerLabel: "unassigned",
      lastActivityAt: "",
      latestActivitySummary: "",
      pendingApprovalCount: 0,
      sourceMode: "task_status_backfill",
    },
    messages: [],
    toolCalls: [],
    approvals: [],
    validation: {
      state: "warn",
      summary: "Validation data is not loaded yet.",
      details: [],
      sourceMode: "task_status_backfill",
    },
    artifacts: {
      totalCount: 0,
      items: [],
    },
    terminalPreview: {
      lines: [],
      sourceMode: "task_status_backfill",
    },
  };
}
