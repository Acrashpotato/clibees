import type { ArtifactKind, RiskLevel } from "../domain/models.js";
import type { WorkspaceLaneStatus } from "./models-core.js";

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

export interface ManagerChatRunSummaryView {
  runId: string;
  goal: string;
  status: WorkspaceLaneStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ManagerChatSessionBindingView {
  sessionId: string;
  threadId: string;
  sourceMode: "task_session" | "run_event_backfill";
}

export interface ManagerChatMessageView {
  messageId: string;
  threadId: string;
  sessionId?: string;
  role: "user" | "manager" | "worker" | "system";
  actorId: string;
  body: string;
  createdAt: string;
  replyToMessageId?: string;
  sourceMode: "session_message" | "run_event_backfill";
}

export interface ManagerWorkerQueueItemView {
  taskId: string;
  title: string;
  status: WorkspaceLaneStatus;
  agentId: string;
  lastActivityAt: string;
  sessionId?: string;
  skillId?: string;
}

export interface ManagerPendingApprovalView {
  requestId: string;
  taskId?: string;
  summary: string;
  riskLevel: RiskLevel | "none";
  requestedAt?: string;
}

export interface ManagerChatProjectionView {
  projection: "manager_chat";
  generatedAt: string;
  run: ManagerChatRunSummaryView;
  managerSession?: ManagerChatSessionBindingView;
  timeline: ManagerChatMessageView[];
  workerQueue: ManagerWorkerQueueItemView[];
  pendingApprovals: ManagerPendingApprovalView[];
}

export type WorkerpollTaskMatchStatus =
  | "matched"
  | "mismatched"
  | "unassigned"
  | "capability_gap";

export interface WorkerpollRunSummaryView {
  runId: string;
  goal: string;
  status: WorkspaceLaneStatus;
  plannerAgentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerpollSummaryView {
  taskCount: number;
  workerCount: number;
  dynamicWorkerCount: number;
  uncoveredTaskCount: number;
}

export interface WorkerpollWorkerView {
  agentId: string;
  source: "configured" | "dynamic" | "metadata";
  command?: string;
  profileIds: string[];
  capabilities: string[];
  isPlanner: boolean;
  priority?: number;
}

export interface WorkerpollTaskView {
  taskId: string;
  title: string;
  kind: "plan" | "execute" | "validate";
  status: WorkspaceLaneStatus;
  requiredCapabilities: string[];
  compatibleWorkers: string[];
  missingCapabilities: string[];
  preferredAgent?: string;
  assignedAgent?: string;
  selectedWorker?: string;
  dependsOn: string[];
  matchStatus: WorkerpollTaskMatchStatus;
  lastActivityAt: string;
}

export interface WorkerpollProjectionView {
  projection: "workerpoll";
  generatedAt: string;
  run: WorkerpollRunSummaryView;
  summary: WorkerpollSummaryView;
  workers: WorkerpollWorkerView[];
  tasks: WorkerpollTaskView[];
}
