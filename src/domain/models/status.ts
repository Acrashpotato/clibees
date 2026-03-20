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
    "awaiting_approval",
    "validating",
    "failed_retryable",
    "failed_terminal",
    "blocked",
    "cancelled",
  ],
  validating: [
    "awaiting_approval",
    "completed",
    "failed_retryable",
    "failed_terminal",
    "blocked",
    "cancelled",
  ],
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
