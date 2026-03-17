import type {
  InspectionSummary,
  RunEvent,
  RunStatus,
  TaskSpec,
  TaskStatus,
} from "../domain/models.js";
import type { WorkspaceLaneStatus } from "./models.js";

export function mapRunStatus(status: RunStatus | string): WorkspaceLaneStatus {
  switch (status) {
    case "waiting_approval":
      return "awaiting_approval";
    case "paused":
    case "planning":
    case "ready":
    case "replanning":
    case "created":
      return "paused";
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      return "running";
  }
}

export function mapTaskStatus(status: TaskStatus): WorkspaceLaneStatus {
  switch (status) {
    case "awaiting_approval":
      return "awaiting_approval";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    case "cancelled":
    case "failed_retryable":
    case "failed_terminal":
      return "failed";
    case "pending":
    case "ready":
      return "paused";
    default:
      return "running";
  }
}

export function mapValidationState(
  outcome: string | undefined,
  taskStatus: TaskStatus,
): "pass" | "warn" | "fail" {
  if (outcome === "pass" || taskStatus === "completed") {
    return "pass";
  }
  if (
    outcome === "fail_retryable" ||
    outcome === "fail_replan_needed" ||
    outcome === "blocked" ||
    taskStatus === "blocked" ||
    taskStatus === "failed_retryable" ||
    taskStatus === "failed_terminal"
  ) {
    return "fail";
  }
  return "warn";
}

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return (
    status === "routing" ||
    status === "context_building" ||
    status === "queued" ||
    status === "running" ||
    status === "awaiting_approval" ||
    status === "validating"
  );
}

export function isActiveSessionBackfillTaskStatus(status: TaskStatus): boolean {
  return status === "running" || status === "awaiting_approval";
}

export function isDownstreamReadyStatus(status: TaskStatus): boolean {
  return (
    status === "ready" ||
    status === "routing" ||
    status === "context_building" ||
    status === "queued" ||
    status === "running" ||
    status === "awaiting_approval" ||
    status === "validating"
  );
}

export function isTaskPastPlanning(status: TaskStatus): boolean {
  return (
    status === "running" ||
    status === "validating" ||
    status === "completed" ||
    status === "failed_retryable" ||
    status === "failed_terminal" ||
    status === "blocked" ||
    status === "cancelled" ||
    status === "awaiting_approval"
  );
}

export function buildTaskOwnerLabel(
  task: TaskSpec,
  fallbackSuffix: "task" | "lane" = "task",
): string {
  if (task.assignedAgent) {
    return task.assignedAgent;
  }
  if (task.preferredAgent) {
    return task.preferredAgent;
  }
  if (task.requiredCapabilities.length > 0) {
    return task.requiredCapabilities.join(", ");
  }
  return `${task.kind} ${fallbackSuffix}`;
}

export function resolveTaskAgentId(task: TaskSpec): string {
  return (
    task.assignedAgent ??
    task.preferredAgent ??
    task.requiredCapabilities[0] ??
    "unassigned"
  );
}

export function buildTaskStatusReason(
  task: TaskSpec,
  validationSummary: string | undefined,
  approvalSummary: string | undefined,
  summary: Pick<InspectionSummary, "latestFailure" | "latestBlocker">,
): string {
  if (approvalSummary) {
    return approvalSummary;
  }

  switch (task.status) {
    case "pending":
      return "Waiting for dependencies before this task can be scheduled.";
    case "ready":
      return "Ready to resume execution.";
    case "routing":
      return "Selecting an agent for this task.";
    case "context_building":
      return "Building task context from memory, blackboard, and artifacts.";
    case "queued":
      return "Queued for execution.";
    case "running":
      return "Task process is currently running.";
    case "validating":
      return "Execution finished and validation is in progress.";
    case "completed":
      return validationSummary ?? "Task completed successfully.";
    case "failed_retryable":
      return validationSummary ?? "Task failed and can be retried.";
    case "failed_terminal":
      return validationSummary ?? summary.latestFailure ?? "Task failed.";
    case "blocked":
      return validationSummary ?? summary.latestBlocker ?? "Task is blocked.";
    case "cancelled":
      return "Task was cancelled.";
    case "awaiting_approval":
      return approvalSummary ?? "Waiting for approval before execution can continue.";
    default:
      return `Task is currently ${task.status}.`;
  }
}

export function resolveTaskId(event: RunEvent): string | undefined {
  if (event.taskId) {
    return event.taskId;
  }
  const payload = event.payload as { taskId?: unknown };
  return typeof payload.taskId === "string" ? payload.taskId : undefined;
}

export function buildTerminalPreview(
  task: TaskSpec,
  taskEvents: RunEvent[],
  validationSummary?: string,
  maxLines = 6,
): string[] {
  const lines = taskEvents
    .filter((event) => event.type === "agent_message")
    .flatMap((event) => {
      const payload = event.payload as { message?: unknown };
      return typeof payload.message === "string"
        ? payload.message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        : [];
    });

  if (lines.length > 0) {
    return lines.slice(-maxLines);
  }

  const fallback = [
    `$ task ${task.id}`,
    `> ${task.title}`,
    `> status: ${task.status}`,
    validationSummary ? `> ${validationSummary}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return fallback.length > 0 ? fallback : ["No terminal output recorded yet."];
}
