import type { RunEvent, TaskSpec, TaskStatus } from "../domain/models.js";

export interface BackfilledSessionWindow {
  sessionId: string;
  attemptNumber?: number;
  startedAt?: string;
  windowEndExclusive?: string;
  sourceMode: "run_event_backfill" | "task_status_backfill";
  events: RunEvent[];
}

export function buildBackfilledSessionWindows(
  task: TaskSpec,
  taskEvents: RunEvent[],
): BackfilledSessionWindow[] {
  const sortedEvents = [...taskEvents].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const startEvents = sortedEvents.filter((event) => event.type === "task_started");

  if (startEvents.length === 0) {
    if (sortedEvents.length === 0 && !isTaskPastPlanning(task.status)) {
      return [];
    }
    return [{
      sessionId: `backfill:${encodeURIComponent(task.id)}:status`,
      ...(sortedEvents[0] ? { startedAt: sortedEvents[0].timestamp } : {}),
      sourceMode: sortedEvents.length > 0 ? "run_event_backfill" : "task_status_backfill",
      events: sortedEvents,
    }];
  }

  return startEvents.map((startEvent, index) => {
    const nextStartEvent = startEvents[index + 1];
    return {
      sessionId: `backfill:${encodeURIComponent(task.id)}:attempt:${index + 1}`,
      attemptNumber: index + 1,
      startedAt: startEvent.timestamp,
      ...(nextStartEvent ? { windowEndExclusive: nextStartEvent.timestamp } : {}),
      sourceMode: "run_event_backfill",
      events: sortedEvents.filter((event) =>
        event.timestamp >= startEvent.timestamp &&
        (!nextStartEvent || event.timestamp < nextStartEvent.timestamp)
      ),
    };
  });
}

function isTaskPastPlanning(status: TaskStatus): boolean {
  return status === "running" || status === "validating" || status === "completed" || status === "failed_retryable" || status === "failed_terminal" || status === "blocked" || status === "cancelled" || status === "awaiting_approval";
}
