import type { InspectionArtifactItem, RunEvent } from "../domain/models.js";
import type { AuditTimelineEntryKind, AuditTimelineEntryView } from "./audit-timeline-models.js";

export function classifyEventKind(type: RunEvent["type"]): AuditTimelineEntryKind {
  switch (type) {
    case "approval_requested":
    case "approval_decided":
      return "approval";
    case "validation_started":
    case "validation_passed":
    case "validation_failed":
      return "validation";
    case "artifact_created":
      return "artifact";
    case "replan_requested":
    case "replan_applied":
      return "replan";
    case "task_started":
    case "agent_selected":
    case "context_built":
    case "invocation_planned":
    case "agent_message":
    case "task_completed":
    case "task_failed":
    case "task_blocked":
      return "session";
    default:
      return "lifecycle";
  }
}

export function countEntries(
  entries: AuditTimelineEntryView[],
  kind: AuditTimelineEntryKind,
): number {
  return entries.filter((entry) => entry.kind === kind).length;
}

export function uniqueArtifactKinds(
  artifacts: InspectionArtifactItem[],
): InspectionArtifactItem["kind"][] {
  return [...new Set(artifacts.map((artifact) => artifact.kind))];
}

export function buildTimelineTitle(
  type: RunEvent["type"],
  taskTitle: string | undefined,
  payload: Record<string, unknown>,
): string {
  switch (type) {
    case "run_started":
      return "Run started";
    case "memory_recalled":
      return "Project memory recalled";
    case "task_planned":
      return `Task planned: ${String(payload.title ?? taskTitle ?? "unknown")}`;
    case "agent_selected":
      return `Agent selected${taskTitle ? `: ${taskTitle}` : ""}`;
    case "context_built":
      return `Context built${taskTitle ? `: ${taskTitle}` : ""}`;
    case "invocation_planned":
      return `Invocation planned${taskTitle ? `: ${taskTitle}` : ""}`;
    case "approval_requested":
      return `Approval requested${taskTitle ? `: ${taskTitle}` : ""}`;
    case "approval_decided":
      return `Approval ${String(payload.decision ?? "updated")}${taskTitle ? `: ${taskTitle}` : ""}`;
    case "task_started":
      return `Task started${taskTitle ? `: ${taskTitle}` : ""}`;
    case "task_completed":
      return `Task completed${taskTitle ? `: ${taskTitle}` : ""}`;
    case "task_failed":
      return `Task failed${taskTitle ? `: ${taskTitle}` : ""}`;
    case "task_blocked":
      return `Task blocked${taskTitle ? `: ${taskTitle}` : ""}`;
    case "validation_started":
      return `Validation started${taskTitle ? `: ${taskTitle}` : ""}`;
    case "validation_passed":
      return `Validation passed${taskTitle ? `: ${taskTitle}` : ""}`;
    case "validation_failed":
      return `Validation failed${taskTitle ? `: ${taskTitle}` : ""}`;
    case "replan_requested":
      return "Replan requested";
    case "replan_applied":
      return "Replan applied";
    case "workspace_drift_detected":
      return "Workspace drift detected";
    case "run_finished":
      return `Run finished with status ${String(payload.status ?? "unknown")}`;
    default:
      return type.replaceAll("_", " ");
  }
}

export function buildTimelineDetails(payload: Record<string, unknown>): string[] {
  const details: string[] = [];

  for (const key of ["summary", "reason", "actor", "command", "validatorMode", "status", "skillId"]) {
    const value = payload[key];
    if (typeof value === "string") {
      details.push(`${key}: ${value}`);
    }
  }

  if (typeof payload.count === "number") {
    details.push(`count: ${payload.count}`);
  }

  if (Array.isArray(payload.reasons)) {
    details.push(
      ...payload.reasons.filter((value): value is string => typeof value === "string"),
    );
  }

  return details;
}
