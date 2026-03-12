import type {
  GraphPatch,
  MemoryRecord,
  RunEvent,
  RunGraph,
  RunRecord,
  TaskSpec,
  TaskRecord,
  TaskStatus,
  ValidationResult,
} from "../domain/models.js";
import { SCHEMA_VERSION, assertTaskStatusTransition } from "../domain/models.js";
import { FileConfigLoader } from "../config/file-config-loader.js";
import type { Planner, PlannerInput, ReplanInput } from "../decision/planner.js";
import type { ConfigLoader } from "../control/entrypoint.js";
import { Entrypoint } from "../control/entrypoint.js";
import { GraphManager } from "../control/graph-manager.js";
import {
  RunCoordinator,
  type RunCoordinatorDependencies,
} from "../control/run-coordinator.js";
import { FileEventStore, type EventStore } from "../storage/event-store.js";
import {
  FileProjectMemoryStore,
  type ProjectMemoryStore,
} from "../storage/project-memory-store.js";
import { FileRunStore, type RunStore, type TaskRecordPatch } from "../storage/run-store.js";
import { createId, resolvePath } from "../shared/runtime.js";

export interface AppDependencies extends RunCoordinatorDependencies {
  configLoader: ConfigLoader;
}

export interface AppContainer {
  entrypoint: Entrypoint;
  runCoordinator: RunCoordinator;
  graphManager: GraphManager;
  dependencies: AppDependencies;
}

export function createApp(
  overrides: Partial<AppDependencies> & { stateRootDir?: string } = {},
): AppContainer {
  const graphManager = overrides.graphManager ?? new GraphManager();
  const planner = overrides.planner ?? new StaticPlanner();
  const stateRootDir = overrides.stateRootDir ?? resolvePath(".multi-agent/state");
  const runStore = overrides.runStore ?? new FileRunStore(stateRootDir);
  const eventStore = overrides.eventStore ?? new FileEventStore(stateRootDir);
  const projectMemoryStore =
    overrides.projectMemoryStore ??
    new FileProjectMemoryStore(resolvePath(".multi-agent/memory"));
  const configLoader = overrides.configLoader ?? new FileConfigLoader();

  const dependencies: AppDependencies = {
    ...overrides,
    configLoader,
    planner,
    graphManager,
    runStore,
    eventStore,
    projectMemoryStore,
  };

  const runCoordinator = new RunCoordinator(dependencies);

  return {
    entrypoint: new Entrypoint(configLoader, runCoordinator),
    runCoordinator,
    graphManager,
    dependencies,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class StaticPlanner implements Planner {
  async createInitialPlan(input: PlannerInput): Promise<TaskSpec[]> {
    return [
      {
        id: createId("task"),
        title: `Bootstrap task for ${input.goal}`,
        kind: "plan",
        goal: input.goal,
        instructions: [`Clarify and execute goal: ${input.goal}`],
        inputs: [],
        dependsOn: [],
        requiredCapabilities: ["planning"],
        workingDirectory: input.workspacePath,
        expectedArtifacts: [],
        acceptanceCriteria: ["Initial task graph created."],
        validator: {
          mode: "none",
        },
        riskLevel: "low",
        allowedActions: [],
        timeoutMs: 60_000,
        retryPolicy: {
          maxAttempts: 1,
          backoffMs: 0,
          retryOn: [],
        },
        budget: undefined,
        preferredAgent: undefined,
        assignedAgent: undefined,
        status: "pending",
      },
    ];
  }

  async replan(_input: ReplanInput): Promise<GraphPatch> {
    return {
      operation: "append_tasks",
      reason: "Static planner does not provide replanning yet.",
      tasks: [],
    };
  }
}

class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunRecord>();
  private readonly graphs = new Map<string, RunGraph>();

  async createRun(record: RunRecord): Promise<void> {
    this.runs.set(record.runId, clone(record));
  }

  async updateRun(record: RunRecord): Promise<void> {
    this.runs.set(record.runId, clone(record));
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    return this.runs.has(runId) ? clone(this.runs.get(runId)!) : null;
  }

  async saveGraph(runId: string, graph: RunGraph): Promise<void> {
    this.graphs.set(runId, clone(graph));
  }

  async getGraph(runId: string): Promise<RunGraph | null> {
    return this.graphs.has(runId) ? clone(this.graphs.get(runId)!) : null;
  }

  async updateTaskStatus(
    runId: string,
    taskId: string,
    update: TaskStatus | TaskRecordPatch,
  ): Promise<TaskRecord> {
    const graph = this.graphs.get(runId);
    if (!graph) {
      throw new Error(`Run graph "${runId}" was not found.`);
    }

    const task = graph.tasks[taskId];
    if (!task) {
      throw new Error(`Task "${taskId}" was not found in run "${runId}".`);
    }

    const patch = typeof update === "string" ? { status: update } : update;
    const nextStatus = patch.status ?? task.status;
    if (nextStatus !== task.status) {
      assertTaskStatusTransition(task.status, nextStatus);
    }

    graph.tasks[taskId] = {
      ...task,
      status: nextStatus,
    };

    return {
      schemaVersion: SCHEMA_VERSION,
      runId,
      taskId,
      status: nextStatus,
      attempts: patch.attempts ?? 0,
      ...(patch.startedAt === null
        ? {}
        : { startedAt: patch.startedAt }),
      ...(patch.finishedAt === null
        ? {}
        : { finishedAt: patch.finishedAt }),
    };
  }

  async getTaskRecord(runId: string, taskId: string): Promise<TaskRecord | null> {
    const graph = this.graphs.get(runId);
    const task = graph?.tasks[taskId];
    if (!task) {
      return null;
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      runId,
      taskId,
      status: task.status,
      attempts: 0,
    };
  }
}

class InMemoryEventStore implements EventStore {
  private readonly eventsByRunId = new Map<string, RunEvent[]>();

  async append(event: RunEvent): Promise<void> {
    const events = this.eventsByRunId.get(event.runId) ?? [];
    events.push(clone(event));
    this.eventsByRunId.set(event.runId, events);
  }

  async list(runId: string): Promise<RunEvent[]> {
    return clone(this.eventsByRunId.get(runId) ?? []);
  }

  async last(runId: string): Promise<RunEvent | null> {
    const events = this.eventsByRunId.get(runId) ?? [];
    const event = events.at(-1);
    return event ? clone(event) : null;
  }

  async getLastConsistentState(runId: string) {
    const lastEvent = await this.last(runId);
    if (!lastEvent) {
      return null;
    }

    return {
      runId,
      lastEventId: lastEvent.id,
      lastEventType: lastEvent.type,
      lastTimestamp: lastEvent.timestamp,
      completedTaskIds: [],
      failedTaskIds: [],
      blockedTaskIds: [],
      taskCheckpoints: {},
    };
  }
}

class InMemoryProjectMemoryStore implements ProjectMemoryStore {
  private readonly records: MemoryRecord[] = [];

  async recall(_query: { text: string; scope: string; tags?: string[] }): Promise<MemoryRecord[]> {
    return clone(this.records);
  }

  async persist(records: MemoryRecord[]): Promise<void> {
    this.records.push(
      ...clone(records).map((record) => ({
        ...record,
        schemaVersion: record.schemaVersion ?? SCHEMA_VERSION,
      })),
    );
  }
}

