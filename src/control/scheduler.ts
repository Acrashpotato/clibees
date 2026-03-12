import type { RunGraph, TaskSpec } from "../domain/models.js";
import { assertTaskStatusTransition } from "../domain/models.js";

export class Scheduler {
  pickNext(graph: RunGraph): TaskSpec | null {
    for (const taskId of graph.readyQueue) {
      const task = graph.tasks[taskId];
      if (task && (task.status === "ready" || task.status === "queued")) {
        return task;
      }
    }

    return null;
  }

  onTaskCompleted(graph: RunGraph, taskId: string): RunGraph {
    const task = graph.tasks[taskId];
    if (!task) {
      throw new Error(`Unknown task "${taskId}".`);
    }

    if (task.status !== "completed") {
      assertTaskStatusTransition(task.status, "completed");
    }

    const completedTaskIds = graph.completedTaskIds.includes(taskId)
      ? [...graph.completedTaskIds]
      : [...graph.completedTaskIds, taskId];
    const readyQueue = graph.readyQueue.filter((candidate) => candidate !== taskId);
    const nextTasks = {
      ...graph.tasks,
      [taskId]: {
        ...task,
        status: "completed" as const,
      },
    };

    for (const edge of graph.edges) {
      if (edge.from !== taskId) {
        continue;
      }

      const dependentTask = nextTasks[edge.to];
      if (!dependentTask || dependentTask.status !== "pending") {
        continue;
      }

      const dependenciesSatisfied = dependentTask.dependsOn.every(
        (dependencyId) => nextTasks[dependencyId]?.status === "completed",
      );
      if (!dependenciesSatisfied) {
        continue;
      }

      assertTaskStatusTransition(dependentTask.status, "ready");
      nextTasks[edge.to] = {
        ...dependentTask,
        status: "ready",
      };

      if (!readyQueue.includes(edge.to)) {
        readyQueue.push(edge.to);
      }
    }

    return {
      ...graph,
      revision: graph.revision + 1,
      tasks: nextTasks,
      readyQueue,
      completedTaskIds,
    };
  }
}
