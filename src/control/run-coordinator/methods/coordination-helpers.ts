import type { RunGraph, TaskSpec } from "../../../domain/models.js";
import { isManagerCoordinationTask, isTaskTerminalStatus } from "../helpers/index.js";

export function findManagerCoordinationByTriggerMessageId(
  graph: RunGraph,
  triggerMessageId: string,
): TaskSpec | undefined {
  return Object.values(graph.tasks).find((task) => {
    if (!isManagerCoordinationTask(task)) {
      return false;
    }
    const metadataTrigger = task.metadata?.triggerMessageId;
    return metadataTrigger === triggerMessageId;
  });
}

export function summarizeNonTerminalTasksForCoordination(graph: RunGraph): string {
  const nonTerminalTasks = Object.values(graph.tasks).filter(
    (task) => !isTaskTerminalStatus(task.status),
  );
  if (nonTerminalTasks.length === 0) {
    return "(none)";
  }
  const topTasks = nonTerminalTasks.slice(0, 12).map((task) => {
    const compactGoal = task.goal.replace(/\s+/g, " ").trim().slice(0, 100);
    return `- [${task.status}] ${task.title} :: ${compactGoal}`;
  });
  if (nonTerminalTasks.length > topTasks.length) {
    topTasks.push(`- ... ${nonTerminalTasks.length - topTasks.length} more`);
  }
  return topTasks.join("\n");
}
