import type { RunEvent } from "../domain/models.js";
import { appendFile, readFile } from "node:fs/promises";
import { ensureDirectory, pathExists } from "../shared/runtime.js";
import {
  createStateLayout,
  getRunStatePaths,
  type StateLayout,
} from "./state-layout.js";

export interface EventFilter {
  taskId?: string;
  types?: RunEvent["type"][];
  since?: string;
  until?: string;
}

export interface TaskCheckpoint {
  taskId: string;
  lastEventId: string;
  lastEventType: RunEvent["type"];
  timestamp: string;
}

export interface EventRecoveryState {
  runId: string;
  lastEventId: string;
  lastEventType: RunEvent["type"];
  lastTimestamp: string;
  activeTaskId?: string;
  waitingApprovalTaskId?: string;
  completedTaskIds: string[];
  failedTaskIds: string[];
  blockedTaskIds: string[];
  taskCheckpoints: Record<string, TaskCheckpoint>;
}

export interface EventStore {
  append(event: RunEvent): Promise<void>;
  list(runId: string, filter?: EventFilter): Promise<RunEvent[]>;
  last(runId: string): Promise<RunEvent | null>;
  getLastConsistentState(runId: string): Promise<EventRecoveryState | null>;
}

export class FileEventStore implements EventStore {
  private readonly layout: StateLayout;

  constructor(rootDir?: string) {
    this.layout = createStateLayout(rootDir);
  }

  async append(event: RunEvent): Promise<void> {
    const eventsFile = getRunStatePaths(this.layout, event.runId).eventsFile;
    await ensureDirectory(getRunStatePaths(this.layout, event.runId).runDir);
    await appendFile(eventsFile, `${JSON.stringify(event)}\n`, "utf8");
  }

  async list(runId: string, filter?: EventFilter): Promise<RunEvent[]> {
    const events = await this.readEvents(runId);

    return events.filter((event) => {
      const taskId = getEventTaskId(event);

      if (filter?.taskId && taskId !== filter.taskId) {
        return false;
      }

      if (filter?.types && !filter.types.includes(event.type)) {
        return false;
      }

      if (filter?.since && event.timestamp < filter.since) {
        return false;
      }

      if (filter?.until && event.timestamp > filter.until) {
        return false;
      }

      return true;
    });
  }

  async last(runId: string): Promise<RunEvent | null> {
    const events = await this.readEvents(runId);
    return events.at(-1) ?? null;
  }

  async getLastConsistentState(runId: string): Promise<EventRecoveryState | null> {
    const events = await this.readEvents(runId);
    const lastEvent = events.at(-1);
    if (!lastEvent) {
      return null;
    }

    const completedTaskIds = new Set<string>();
    const failedTaskIds = new Set<string>();
    const blockedTaskIds = new Set<string>();
    const taskCheckpoints: Record<string, TaskCheckpoint> = {};
    let activeTaskId: string | undefined;
    let waitingApprovalTaskId: string | undefined;

    for (const event of events) {
      const taskId = getEventTaskId(event);

      if (taskId) {
        taskCheckpoints[taskId] = {
          taskId,
          lastEventId: event.id,
          lastEventType: event.type,
          timestamp: event.timestamp,
        };
      }

      switch (event.type) {
        case "task_started":
        case "task_queued":
        case "validation_started":
          activeTaskId = taskId ?? activeTaskId;
          break;
        case "approval_requested":
          waitingApprovalTaskId = taskId ?? waitingApprovalTaskId;
          break;
        case "approval_decided":
          if (!taskId || waitingApprovalTaskId === taskId) {
            waitingApprovalTaskId = undefined;
          }
          break;
        case "task_completed":
        case "validation_passed":
          if (taskId) {
            completedTaskIds.add(taskId);
            failedTaskIds.delete(taskId);
            blockedTaskIds.delete(taskId);
          }
          if (activeTaskId === taskId) {
            activeTaskId = undefined;
          }
          break;
        case "task_failed":
        case "validation_failed":
          if (taskId) {
            failedTaskIds.add(taskId);
            completedTaskIds.delete(taskId);
          }
          if (activeTaskId === taskId) {
            activeTaskId = undefined;
          }
          break;
        case "task_blocked":
          if (taskId) {
            blockedTaskIds.add(taskId);
            completedTaskIds.delete(taskId);
            failedTaskIds.delete(taskId);
          }
          if (activeTaskId === taskId) {
            activeTaskId = undefined;
          }
          break;
        case "run_finished":
          activeTaskId = undefined;
          waitingApprovalTaskId = undefined;
          break;
      }
    }

    return {
      runId,
      lastEventId: lastEvent.id,
      lastEventType: lastEvent.type,
      lastTimestamp: lastEvent.timestamp,
      activeTaskId,
      waitingApprovalTaskId,
      completedTaskIds: [...completedTaskIds],
      failedTaskIds: [...failedTaskIds],
      blockedTaskIds: [...blockedTaskIds],
      taskCheckpoints,
    };
  }

  private async readEvents(runId: string): Promise<RunEvent[]> {
    const eventsFile = getRunStatePaths(this.layout, runId).eventsFile;
    if (!(await pathExists(eventsFile))) {
      return [];
    }

    let content: string;
    try {
      content = await readFile(eventsFile, "utf8");
    } catch (error) {
      throw new Error(`Failed to read events for run "${runId}".`, {
        cause: error,
      });
    }

    const events: RunEvent[] = [];
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

    for (const [index, line] of lines.entries()) {
      try {
        events.push(JSON.parse(line) as RunEvent);
      } catch (error) {
        throw new Error(
          `Failed to parse events for run "${runId}" at line ${index + 1}.`,
          { cause: error },
        );
      }
    }

    return events;
  }
}

function getEventTaskId(event: RunEvent): string | undefined {
  if (event.taskId) {
    return event.taskId;
  }

  const payload = event.payload as Record<string, unknown>;
  return typeof payload.taskId === "string" ? payload.taskId : undefined;
}
