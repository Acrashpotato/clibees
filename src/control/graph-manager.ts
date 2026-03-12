import type {
  GraphEdge,
  GraphPatch,
  RunGraph,
  TaskSpec,
  TaskStatus,
} from "../domain/models.js";
import {
  SCHEMA_VERSION,
  assertTaskStatusTransition,
} from "../domain/models.js";

const PATCHABLE_STATUSES = new Set<TaskStatus>([
  "pending",
  "ready",
  "routing",
  "context_building",
  "queued",
  "failed_retryable",
]);

export class GraphManager {
  createGraph(runId: string, tasks: TaskSpec[]): RunGraph {
    const taskMap: Record<string, TaskSpec> = {};

    for (const task of tasks) {
      if (taskMap[task.id]) {
        throw new Error(`Duplicate task id "${task.id}".`);
      }

      taskMap[task.id] = this.cloneTask(task, {
        status: task.dependsOn.length === 0 ? "ready" : "pending",
      });
    }

    const edges = this.buildEdges(taskMap);
    this.assertAcyclic(taskMap);

    return {
      runId,
      schemaVersion: SCHEMA_VERSION,
      revision: 1,
      tasks: taskMap,
      edges,
      readyQueue: this.collectReadyQueue(taskMap),
      completedTaskIds: [],
      failedTaskIds: [],
      cancelledTaskIds: [],
      metadata: {},
    };
  }

  updateTaskStatus(graph: RunGraph, taskId: string, status: TaskStatus): RunGraph {
    const task = graph.tasks[taskId];

    if (!task) {
      throw new Error(`Unknown task "${taskId}".`);
    }

    assertTaskStatusTransition(task.status, status);

    const nextReadyQueue = graph.readyQueue.filter(
      (candidate) => candidate !== taskId,
    );
    if (status === "ready") {
      nextReadyQueue.push(taskId);
    }

    return {
      ...graph,
      revision: graph.revision + 1,
      tasks: {
        ...graph.tasks,
        [taskId]: {
          ...task,
          status,
        },
      },
      readyQueue: nextReadyQueue,
    };
  }

  applyPatch(graph: RunGraph, patch: GraphPatch): RunGraph {
    switch (patch.operation) {
      case "append_tasks":
        return this.appendTasks(graph, patch.tasks ?? []);
      case "cancel_pending_tasks":
        return this.cancelPendingTasks(graph, patch.targetTaskIds ?? []);
      case "replace_pending_subgraph":
        return this.replacePendingSubgraph(
          graph,
          patch.targetTaskIds ?? [],
          patch.tasks ?? [],
        );
      default:
        throw new Error(`Unsupported graph patch operation "${String(patch.operation)}".`);
    }
  }

  private appendTasks(graph: RunGraph, tasks: TaskSpec[]): RunGraph {
    if (tasks.length === 0) {
      return graph;
    }

    const nextGraph = this.cloneGraph(graph);
    for (const task of tasks) {
      if (nextGraph.tasks[task.id]) {
        throw new Error(`Task "${task.id}" already exists in the graph.`);
      }
      nextGraph.tasks[task.id] = this.cloneTask(task);
    }

    nextGraph.edges = this.buildEdges(nextGraph.tasks);
    this.assertAcyclic(nextGraph.tasks);
    this.recomputePatchableTaskStatuses(nextGraph);
    nextGraph.revision += 1;
    nextGraph.readyQueue = this.collectReadyQueue(nextGraph.tasks);
    return nextGraph;
  }

  private cancelPendingTasks(graph: RunGraph, targetTaskIds: string[]): RunGraph {
    if (targetTaskIds.length === 0) {
      throw new Error("cancel_pending_tasks requires at least one targetTaskId.");
    }

    const nextGraph = this.cloneGraph(graph);
    for (const taskId of targetTaskIds) {
      const task = nextGraph.tasks[taskId];
      if (!task) {
        throw new Error(`Task "${taskId}" was not found in the graph.`);
      }
      this.assertPatchableTask(task, patchLabel(taskId, "cancel"));
      nextGraph.tasks[taskId] = {
        ...task,
        status: "cancelled",
      };
      if (!nextGraph.cancelledTaskIds.includes(taskId)) {
        nextGraph.cancelledTaskIds.push(taskId);
      }
      nextGraph.completedTaskIds = nextGraph.completedTaskIds.filter(
        (candidate) => candidate !== taskId,
      );
      nextGraph.failedTaskIds = nextGraph.failedTaskIds.filter(
        (candidate) => candidate !== taskId,
      );
    }

    nextGraph.revision += 1;
    nextGraph.readyQueue = this.collectReadyQueue(nextGraph.tasks);
    return nextGraph;
  }

  private replacePendingSubgraph(
    graph: RunGraph,
    targetTaskIds: string[],
    tasks: TaskSpec[],
  ): RunGraph {
    if (targetTaskIds.length === 0) {
      throw new Error("replace_pending_subgraph requires at least one targetTaskId.");
    }

    const nextGraph = this.cloneGraph(graph);
    const removableTaskIds = this.collectReplaceableTaskIds(nextGraph, targetTaskIds);

    for (const taskId of removableTaskIds) {
      delete nextGraph.tasks[taskId];
    }

    nextGraph.edges = nextGraph.edges.filter(
      (edge) => !removableTaskIds.has(edge.from) && !removableTaskIds.has(edge.to),
    );
    nextGraph.readyQueue = nextGraph.readyQueue.filter(
      (taskId) => !removableTaskIds.has(taskId),
    );
    nextGraph.completedTaskIds = nextGraph.completedTaskIds.filter(
      (taskId) => !removableTaskIds.has(taskId),
    );
    nextGraph.failedTaskIds = nextGraph.failedTaskIds.filter(
      (taskId) => !removableTaskIds.has(taskId),
    );
    nextGraph.cancelledTaskIds = nextGraph.cancelledTaskIds.filter(
      (taskId) => !removableTaskIds.has(taskId),
    );

    return this.appendTasks(nextGraph, tasks);
  }

  private collectReplaceableTaskIds(
    graph: RunGraph,
    targetTaskIds: string[],
  ): Set<string> {
    const removable = new Set<string>();

    for (const taskId of targetTaskIds) {
      const task = graph.tasks[taskId];
      if (!task) {
        throw new Error(`Task "${taskId}" was not found in the graph.`);
      }
      this.assertPatchableTask(task, patchLabel(taskId, "replace"));
      removable.add(taskId);
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of graph.edges) {
        if (!removable.has(edge.from) || removable.has(edge.to)) {
          continue;
        }

        const task = graph.tasks[edge.to];
        if (!task) {
          continue;
        }
        this.assertPatchableTask(task, patchLabel(edge.to, "replace descendant"));

        const hasBlockingExternalDependency = task.dependsOn.some((dependencyId) => {
          if (removable.has(dependencyId)) {
            return false;
          }
          const dependency = graph.tasks[dependencyId];
          return dependency ? dependency.status !== "completed" : true;
        });

        if (hasBlockingExternalDependency) {
          continue;
        }

        removable.add(edge.to);
        changed = true;
      }
    }

    return removable;
  }

  private recomputePatchableTaskStatuses(graph: RunGraph): void {
    for (const [taskId, task] of Object.entries(graph.tasks)) {
      if (!PATCHABLE_STATUSES.has(task.status)) {
        continue;
      }

      const dependenciesSatisfied = task.dependsOn.every(
        (dependencyId) => graph.tasks[dependencyId]?.status === "completed",
      );
      graph.tasks[taskId] = {
        ...task,
        status: dependenciesSatisfied ? "ready" : "pending",
      };
    }
  }

  private buildEdges(taskMap: Record<string, TaskSpec>): GraphEdge[] {
    return Object.values(taskMap).flatMap((task) =>
      task.dependsOn.map((dependencyId) => {
        if (!taskMap[dependencyId]) {
          throw new Error(
            `Task "${task.id}" depends on missing task "${dependencyId}".`,
          );
        }

        return { from: dependencyId, to: task.id };
      }),
    );
  }

  private collectReadyQueue(taskMap: Record<string, TaskSpec>): string[] {
    return Object.values(taskMap)
      .filter((task) => task.status === "ready")
      .map((task) => task.id)
      .sort();
  }

  private cloneGraph(graph: RunGraph): RunGraph {
    return {
      ...graph,
      tasks: Object.fromEntries(
        Object.entries(graph.tasks).map(([taskId, task]) => [taskId, this.cloneTask(task)]),
      ),
      edges: graph.edges.map((edge) => ({ ...edge })),
      readyQueue: [...graph.readyQueue],
      completedTaskIds: [...graph.completedTaskIds],
      failedTaskIds: [...graph.failedTaskIds],
      cancelledTaskIds: [...graph.cancelledTaskIds],
      metadata: { ...graph.metadata },
    };
  }

  private cloneTask(task: TaskSpec, overrides: Partial<TaskSpec> = {}): TaskSpec {
    return {
      ...task,
      dependsOn: [...task.dependsOn],
      instructions: [...task.instructions],
      inputs: [...task.inputs],
      requiredCapabilities: [...task.requiredCapabilities],
      expectedArtifacts: [...task.expectedArtifacts],
      acceptanceCriteria: [...task.acceptanceCriteria],
      allowedActions: [...task.allowedActions],
      ...(task.validator.children
        ? {
            validator: {
              ...task.validator,
              children: task.validator.children.map((child) => ({ ...child })),
            },
          }
        : { validator: { ...task.validator } }),
      ...(task.budget ? { budget: { ...task.budget } } : {}),
      retryPolicy: {
        ...task.retryPolicy,
        retryOn: [...task.retryPolicy.retryOn],
      },
      ...overrides,
    };
  }

  private assertPatchableTask(task: TaskSpec, label: string): void {
    if (!PATCHABLE_STATUSES.has(task.status)) {
      throw new Error(`${label} is not patchable because it is ${task.status}.`);
    }
  }

  private assertAcyclic(taskMap: Record<string, TaskSpec>): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (taskId: string): void => {
      if (visited.has(taskId)) {
        return;
      }

      if (visiting.has(taskId)) {
        throw new Error(`Cycle detected at task "${taskId}".`);
      }

      visiting.add(taskId);
      for (const dependencyId of taskMap[taskId].dependsOn) {
        visit(dependencyId);
      }
      visiting.delete(taskId);
      visited.add(taskId);
    };

    for (const taskId of Object.keys(taskMap)) {
      visit(taskId);
    }
  }
}

function patchLabel(taskId: string, action: string): string {
  return `Task "${taskId}" cannot ${action}`;
}
