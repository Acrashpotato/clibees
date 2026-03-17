export const SCHEMA_VERSION = 1;

export type TaskKind = "plan" | "execute" | "validate";
export type RiskLevel = "low" | "medium" | "high";
export type RunStatus =
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
export type TaskStatus =
  | "pending"
  | "ready"
  | "routing"
  | "context_building"
  | "awaiting_approval"
  | "queued"
  | "running"
  | "validating"
  | "completed"
  | "failed_retryable"
  | "failed_terminal"
  | "blocked"
  | "cancelled";
export type ValidationOutcome =
  | "pass"
  | "fail_retryable"
  | "fail_replan_needed"
  | "blocked";
export type GraphPatchOperation =
  | "append_tasks"
  | "replace_pending_subgraph"
  | "cancel_pending_tasks";
export type ArtifactKind =
  | "file_change"
  | "command_result"
  | "structured_output"
  | "validation_result"
  | "approval_record";
export type MemoryKind =
  | "constraint"
  | "decision"
  | "entity"
  | "risk"
  | "todo";
export type MemoryStatus = "active" | "superseded" | "invalid";
export type ApprovalDecision = "approved" | "rejected";
export type RunEventType =
  | "run_started"
  | "memory_recalled"
  | "task_planned"
  | "workspace_drift_detected"
  | "task_queued"
  | "task_started"
  | "agent_selected"
  | "context_built"
  | "invocation_planned"
  | "approval_requested"
  | "approval_decided"
  | "agent_message"
  | "artifact_created"
  | "validation_started"
  | "validation_passed"
  | "validation_failed"
  | "task_completed"
  | "task_failed"
  | "task_blocked"
  | "replan_requested"
  | "replan_applied"
  | "run_finished";

export const RUN_STATUS_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  created: ["planning", "cancelled"],
  planning: ["ready", "failed", "cancelled"],
  ready: ["running", "replanning", "paused", "cancelled"],
  running: ["waiting_approval", "replanning", "paused", "completed", "failed", "cancelled"],
  waiting_approval: ["running", "paused", "failed", "cancelled"],
  replanning: ["ready", "running", "failed", "cancelled"],
  paused: ["ready", "running", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["ready", "cancelled"],
  ready: ["routing", "cancelled"],
  routing: ["context_building", "blocked", "failed_terminal", "cancelled"],
  context_building: [
    "awaiting_approval",
    "queued",
    "blocked",
    "failed_terminal",
    "cancelled",
  ],
  awaiting_approval: ["queued", "blocked", "cancelled"],
  queued: ["routing", "running", "cancelled"],
  running: [
    "validating",
    "failed_retryable",
    "failed_terminal",
    "blocked",
    "cancelled",
  ],
  validating: ["completed", "failed_retryable", "failed_terminal", "blocked", "cancelled"],
  completed: [],
  failed_retryable: ["routing", "queued", "blocked", "failed_terminal", "cancelled"],
  failed_terminal: [],
  blocked: [],
  cancelled: [],
};

export function canTransitionRunStatus(
  from: RunStatus,
  to: RunStatus,
): boolean {
  return RUN_STATUS_TRANSITIONS[from].includes(to);
}

export function canTransitionTaskStatus(
  from: TaskStatus,
  to: TaskStatus,
): boolean {
  return TASK_STATUS_TRANSITIONS[from].includes(to);
}

export function assertRunStatusTransition(
  from: RunStatus,
  to: RunStatus,
): void {
  if (!canTransitionRunStatus(from, to)) {
    throw new Error(`Run status cannot transition from "${from}" to "${to}".`);
  }
}

export function assertTaskStatusTransition(
  from: TaskStatus,
  to: TaskStatus,
): void {
  if (!canTransitionTaskStatus(from, to)) {
    throw new Error(`Task status cannot transition from "${from}" to "${to}".`);
  }
}

export interface BudgetSpec {
  maxInputChars?: number;
  maxOutputChars?: number;
  maxDurationMs?: number;
}

export interface ActionPolicy {
  kind: string;
  allow: boolean;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  retryOn: Array<"adapter_error" | "timeout" | "validation_fail">;
}

export interface ValidatorSpec {
  mode: "none" | "files" | "command" | "schema" | "composite";
  commands?: string[];
  requiredFiles?: string[];
  outputSchemaId?: string;
  children?: ValidatorSpec[];
}

export interface TaskSpec {
  id: string;
  title: string;
  kind: TaskKind;
  goal: string;
  instructions: string[];
  inputs: string[];
  dependsOn: string[];
  requiredCapabilities: string[];
  preferredAgent?: string;
  assignedAgent?: string;
  workingDirectory: string;
  expectedArtifacts: string[];
  acceptanceCriteria: string[];
  validator: ValidatorSpec;
  riskLevel: RiskLevel;
  allowedActions: ActionPolicy[];
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  budget?: BudgetSpec;
  status: TaskStatus;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface RunGraph {
  runId: string;
  schemaVersion: number;
  revision: number;
  tasks: Record<string, TaskSpec>;
  edges: GraphEdge[];
  readyQueue: string[];
  completedTaskIds: string[];
  failedTaskIds: string[];
  cancelledTaskIds: string[];
  metadata: Record<string, unknown>;
}

export interface GraphPatch {
  operation: GraphPatchOperation;
  reason: string;
  tasks?: TaskSpec[];
  targetTaskIds?: string[];
  anchorTaskId?: string;
}

export interface RunRequest {
  goal: string;
  workspacePath: string;
  configPath?: string;
  metadata?: Record<string, unknown>;
}

export interface RunRecord {
  schemaVersion: number;
  runId: string;
  goal: string;
  status: RunStatus;
  workspacePath: string;
  configPath?: string;
  currentTaskId?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface TaskRecord {
  schemaVersion: number;
  runId: string;
  taskId: string;
  status: TaskStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface RunEvent<P = Record<string, unknown>> {
  schemaVersion: number;
  id: string;
  type: RunEventType;
  runId: string;
  taskId?: string;
  timestamp: string;
  payload: P;
}

export type TaskSessionScope = "manager_primary" | "task_session";
export type TaskSessionRole = "manager" | "worker";
export type SessionMessageRole = "user" | "manager" | "worker" | "system";

export interface TaskSessionRecord {
  schemaVersion: number;
  sessionId: string;
  runId: string;
  scope: TaskSessionScope;
  role: TaskSessionRole;
  threadId: string;
  taskId?: string;
  agentId?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface MessageThreadRecord {
  schemaVersion: number;
  threadId: string;
  runId: string;
  scope: TaskSessionScope;
  sessionId?: string;
  taskId?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface SessionMessageRecord {
  schemaVersion: number;
  messageId: string;
  runId: string;
  threadId: string;
  role: SessionMessageRole;
  body: string;
  actorId: string;
  createdAt: string;
  sessionId?: string;
  replyToMessageId?: string;
  clientRequestId?: string;
  metadata: Record<string, unknown>;
}

export interface ActionPlan {
  id: string;
  kind: string;
  command?: string;
  args?: string[];
  cwd?: string;
  targets?: string[];
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  reason: string;
}

export interface InvocationPlan {
  taskId: string;
  agentId: string;
  command: string;
  args: string[];
  stdin?: string;
  cwd: string;
  env?: Record<string, string>;
  actionPlans: ActionPlan[];
}

export interface AgentCapability {
  agentId: string;
  supportsNonInteractive: boolean;
  supportsStructuredOutput: boolean;
  supportsCwd: boolean;
  supportsAutoApproveFlags: boolean;
  supportsStreaming: boolean;
  supportsActionPlanning: boolean;
  supportsResume: boolean;
  supportedCapabilities: string[];
  defaultProfileId?: string;
}

export interface AgentProfile {
  agentId: string;
  profileId: string;
  label: string;
  capabilities: string[];
  costTier: "low" | "medium" | "high";
  defaultCwd?: string;
}

export interface ContextBundle {
  taskBrief: string;
  relevantFacts: string[];
  relevantDecisions: string[];
  artifactSummaries: string[];
  workspaceSummary: string;
  transcriptRefs: string[];
  budget?: BudgetSpec;
  agentHints: string[];
}

export interface ValidationResult {
  outcome: ValidationOutcome;
  summary: string;
  details: string[];
  createdArtifacts: string[];
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  taskId: string;
  actionPlans: ActionPlan[];
  reason: string;
  requestedAt: string;
}

export interface ApprovalRecord {
  requestId: string;
  decision: ApprovalDecision;
  decidedAt: string;
  actor: string;
  note?: string;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  taskId?: string;
  kind: ArtifactKind;
  uri: string;
  summary: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface BlackboardEntry {
  id: string;
  runId: string;
  taskId?: string;
  scope: "planner" | "agent" | "validation" | "approval";
  summary: string;
  references: string[];
  updatedAt: string;
}

export interface MemoryRecord {
  schemaVersion: number;
  id: string;
  kind: MemoryKind;
  scope: string;
  subject: string;
  content: string;
  tags: string[];
  sourceRunId: string;
  sourceTaskId?: string;
  confidence: number;
  validFrom: string;
  validUntil?: string;
  status: MemoryStatus;
}

export interface WorkspaceSnapshot {
  id: string;
  runId: string;
  taskId?: string;
  phase: "context" | "before_task" | "after_task";
  baseSnapshotId?: string;
  workingDirectory: string;
  branch?: string;
  head?: string;
  trackedFiles: string[];
  trackedFileStates: Record<string, { size: number; mtimeMs: number }>;
  diffSummary: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
  createdAt: string;
}

export interface WorkspaceDrift {
  hasDrift: boolean;
  severity: "none" | "warning" | "blocking";
  changedFiles: string[];
  unexpectedChanges: string[];
  missingArtifacts: string[];
  branchChanged: boolean;
  headChanged: boolean;
  reasons: string[];
  reason?: string;
}

export interface InspectionTimelineEntry {
  eventId: string;
  type: RunEventType;
  timestamp: string;
  taskId?: string;
  title: string;
  details: string[];
}

export interface InspectionArtifactItem {
  id: string;
  taskId?: string;
  kind: ArtifactKind;
  uri: string;
  summary: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface InspectionArtifactGroup {
  taskId?: string;
  taskTitle: string;
  artifacts: InspectionArtifactItem[];
}

export interface InspectionBlackboardEntry {
  id: string;
  taskId?: string;
  summary: string;
  references: string[];
  updatedAt: string;
}

export interface InspectionBlackboardScope {
  scope: BlackboardEntry["scope"];
  latestSummary?: string;
  entries: InspectionBlackboardEntry[];
}

export interface InspectionValidationItem {
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  outcome?: string;
  summary: string;
  details: string[];
  updatedAt?: string;
}

export interface InspectionApprovalItem {
  requestId: string;
  taskId?: string;
  summary: string;
  state: "pending" | "approved" | "rejected";
  actor?: string;
  decidedAt?: string;
  riskLevel?: RiskLevel;
}

export interface InspectionSummary {
  runStatus: RunStatus;
  completedTasks: number;
  failedTasks: number;
  blockedTasks: number;
  pendingApprovals: number;
  latestFailure?: string;
  latestBlocker?: string;
  latestReplan?: string;
  latestValidation?: string;
}

/**
 * Transitional aggregate used to support legacy inspect/workspace-style reads
 * while the repository migrates to dedicated page projections.
 */
export interface RunInspection {
  run: RunRecord;
  graph: RunGraph;
  events: RunEvent[];
  timeline: InspectionTimelineEntry[];
  artifacts: InspectionArtifactGroup[];
  blackboard: InspectionBlackboardScope[];
  validation: InspectionValidationItem[];
  approvals: InspectionApprovalItem[];
  summary: InspectionSummary;
}


