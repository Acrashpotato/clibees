import type {
  InspectionApprovalItem,
  InspectionArtifactItem,
  InspectionValidationItem,
  RunEvent,
  RunInspection,
  TaskSpec,
  TaskStatus,
} from "../domain/models.js";
import type {
  TaskDetailDependencyItemView,
  TaskDetailValidationSummaryView,
  WorkspaceLaneStatus,
} from "./models.js";
import { buildEventSummary } from "./event-view-helpers.js";
import {
  buildTaskStatusReason,
  mapTaskStatus,
  resolveTaskId,
  resolveTaskAgentId,
} from "./task-view-helpers.js";

interface RuntimeContractSynthesis {
  goal: string;
  inputs: string[];
  acceptanceCriteria: string[];
  expectedArtifacts: string[];
}

export function groupPendingApprovalsByTaskId(
  approvals: InspectionApprovalItem[],
): Map<string, InspectionApprovalItem[]> {
  const grouped = new Map<string, InspectionApprovalItem[]>();

  for (const approval of approvals) {
    if (!approval.taskId || approval.state !== "pending") {
      continue;
    }

    const scoped = grouped.get(approval.taskId) ?? [];
    scoped.push(approval);
    grouped.set(approval.taskId, scoped);
  }

  return grouped;
}

export function groupEventsByTaskId(events: RunEvent[]): Map<string, RunEvent[]> {
  const grouped = new Map<string, RunEvent[]>();

  for (const event of events) {
    const taskId = resolveTaskId(event);
    if (!taskId) {
      continue;
    }

    const scoped = grouped.get(taskId) ?? [];
    scoped.push(event);
    grouped.set(taskId, scoped);
  }

  return grouped;
}

export function buildLatestActivity(
  task: TaskSpec,
  taskEvents: RunEvent[],
  validation: InspectionValidationItem | undefined,
  inspection: RunInspection,
): { timestamp: string; summary: string } {
  const latestEvent = [...taskEvents]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];

  if (latestEvent) {
    return {
      timestamp: latestEvent.timestamp,
      summary: buildEventSummary(latestEvent),
    };
  }

  if (validation?.updatedAt) {
    return {
      timestamp: validation.updatedAt,
      summary: validation.summary,
    };
  }

  return {
    timestamp: inspection.run.updatedAt,
    summary: `Task is currently ${task.status}.`,
  };
}

export function synthesizeRuntimeContract(
  task: TaskSpec,
  taskEvents: RunEvent[],
  taskArtifacts: InspectionArtifactItem[],
  validation: InspectionValidationItem | undefined,
): RuntimeContractSynthesis {
  const latestCommandResult = [...taskArtifacts]
    .filter((artifact) => artifact.kind === "command_result")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const invocationMeta = latestCommandResult?.metadata as {
    invocation?: {
      stdin?: unknown;
      command?: unknown;
      args?: unknown;
      cwd?: unknown;
    };
    payload?: {
      exitCode?: unknown;
    };
  } | undefined;

  const runtimePrompt = extractRuntimePrompt(invocationMeta?.invocation?.stdin);
  const goal = runtimePrompt ?? task.goal;

  const latestTaskStart = [...taskEvents]
    .filter((event) => event.type === "task_started")
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];
  const latestAgentId = (latestTaskStart?.payload as { agentId?: unknown } | undefined)?.agentId;
  const command = typeof invocationMeta?.invocation?.command === "string"
    ? invocationMeta.invocation.command
    : undefined;
  const args = Array.isArray(invocationMeta?.invocation?.args)
    ? invocationMeta?.invocation?.args.filter((value): value is string => typeof value === "string")
    : [];
  const cwd = typeof invocationMeta?.invocation?.cwd === "string"
    ? invocationMeta.invocation.cwd
    : undefined;
  const exitCode = typeof invocationMeta?.payload?.exitCode === "number"
    ? invocationMeta.payload.exitCode
    : undefined;

  const inputs = uniqueLimited([
    ...task.inputs,
    ...(runtimePrompt ? [`Runtime prompt: ${clipLine(runtimePrompt)}`] : []),
    ...(typeof latestAgentId === "string" ? [`Agent: ${latestAgentId}`] : []),
    ...(command ? [`Invocation: ${command}${args.length > 0 ? ` ${args.join(" ")}` : ""}`] : []),
    ...(cwd ? [`Working directory: ${cwd}`] : []),
  ], 8);

  const acceptanceCriteria = uniqueLimited([
    ...task.acceptanceCriteria,
    ...(validation?.summary ? [`Validation: ${validation.summary}`] : []),
    ...(typeof exitCode === "number" ? [`Latest command exited with code ${exitCode}.`] : []),
    ...(task.status === "completed" ? ["Task reaches completed status."] : []),
  ], 8);

  const expectedArtifacts = uniqueLimited([
    ...task.expectedArtifacts,
    ...deriveExpectedArtifactHints(taskArtifacts),
  ], 8);

  return {
    goal,
    inputs,
    acceptanceCriteria,
    expectedArtifacts,
  };
}

export function deriveExpectedArtifactHints(artifacts: InspectionArtifactItem[]): string[] {
  const hints: string[] = [];
  const kinds = new Set(artifacts.map((artifact) => artifact.kind));
  if (kinds.has("command_result")) {
    hints.push("Command execution result record.");
  }
  if (kinds.has("file_change")) {
    hints.push("Workspace file change output.");
  }
  if (kinds.has("structured_output")) {
    hints.push("Structured output payload.");
  }
  if (kinds.has("validation_result")) {
    hints.push("Validation result summary.");
  }
  if (kinds.has("approval_record")) {
    hints.push("Approval request/decision record.");
  }
  return hints;
}

export function extractRuntimePrompt(stdin: unknown): string | undefined {
  if (typeof stdin !== "string") {
    return undefined;
  }
  const normalized = stdin
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
  if (normalized.length === 0) {
    return undefined;
  }
  return clipLine(normalized, 240);
}

export function uniqueLimited(values: string[], maxItems: number): string[] {
  const next: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (next.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      continue;
    }
    next.push(trimmed);
    if (next.length >= maxItems) {
      break;
    }
  }
  return next;
}

export function clipLine(value: string, maxLength = 160): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

export function compareDependencyItems(
  left: TaskDetailDependencyItemView,
  right: TaskDetailDependencyItemView,
): number {
  return (
    getTaskPriority(left.status) - getTaskPriority(right.status) ||
    right.latestActivityAt.localeCompare(left.latestActivityAt) ||
    left.title.localeCompare(right.title)
  );
}

export function getTaskPriority(status: WorkspaceLaneStatus): number {
  switch (status) {
    case "awaiting_approval":
      return 0;
    case "blocked":
      return 1;
    case "running":
      return 2;
    case "failed":
      return 3;
    case "paused":
      return 4;
    case "completed":
      return 5;
    default:
      return 6;
  }
}

export function resolveBackfilledSessionStatus(
  latestEventType: RunEvent["type"],
  currentTaskStatus: TaskStatus | undefined,
): WorkspaceLaneStatus {
  if (currentTaskStatus) {
    return mapTaskStatus(currentTaskStatus);
  }

  switch (latestEventType) {
    case "approval_requested":
      return "awaiting_approval";
    case "task_blocked":
      return "blocked";
    case "task_failed":
    case "validation_failed":
      return "failed";
    case "task_completed":
    case "validation_passed":
      return "completed";
    default:
      return "running";
  }
}

export function resolveAgentId(event: RunEvent | undefined, task: TaskSpec): string {
  const payload = event?.payload as { agentId?: unknown } | undefined;
  if (typeof payload?.agentId === "string") {
    return payload.agentId;
  }
  if (task.assignedAgent) {
    return task.assignedAgent;
  }
  if (task.preferredAgent) {
    return task.preferredAgent;
  }
  if (task.requiredCapabilities.length > 0) {
    return task.requiredCapabilities[0]!;
  }
  return "unassigned";
}

export function inferValidationStateFromTaskStatus(
  status: TaskStatus,
): TaskDetailValidationSummaryView["state"] {
  if (status === "completed") {
    return "pass";
  }
  if (
    status === "failed_retryable" ||
    status === "failed_terminal" ||
    status === "blocked" ||
    status === "cancelled"
  ) {
    return "fail";
  }
  return "warn";
}

export function buildValidationFallbackSummary(status: TaskStatus): string {
  switch (status) {
    case "completed":
      return "Task completed but no dedicated validation record has been persisted yet.";
    case "failed_retryable":
      return "Task failed and can be retried; a dedicated validation record is not available yet.";
    case "failed_terminal":
      return "Task failed terminally; a dedicated validation record is not available yet.";
    case "blocked":
      return "Task is blocked and has not produced a dedicated validation record.";
    case "cancelled":
      return "Task was cancelled before a dedicated validation record was persisted.";
    default:
      return "Validation has not produced a dedicated record for this task yet.";
  }
}

export function resolveApprovalRequestedAt(
  events: RunEvent[],
  requestId: string,
): string | undefined {
  const event = events.find((candidate) => {
    if (candidate.type !== "approval_requested") {
      return false;
    }
    const payload = candidate.payload as { requestId?: unknown };
    return payload.requestId === requestId;
  });

  return event?.timestamp;
}
