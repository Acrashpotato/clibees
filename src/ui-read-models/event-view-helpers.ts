import type { RunEvent } from "../domain/models.js";

export function firstNonEmptyLine(message: string): string | undefined {
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

export function buildEventSummary(event: RunEvent): string {
  const payload = event.payload as {
    message?: unknown;
    summary?: unknown;
    reason?: unknown;
    agentId?: unknown;
  };

  if (typeof payload.summary === "string") {
    return payload.summary;
  }
  if (typeof payload.reason === "string") {
    return payload.reason;
  }
  if (typeof payload.message === "string") {
    return firstNonEmptyLine(payload.message) ?? "Agent produced a new message.";
  }
  if (event.type === "task_started" && typeof payload.agentId === "string") {
    return `Task started by ${payload.agentId}.`;
  }
  return event.type.replaceAll("_", " ");
}
