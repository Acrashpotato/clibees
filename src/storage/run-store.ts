import type {
  RunGraph,
  RunRecord,
  TaskRecord,
  TaskStatus,
} from "../domain/models.js";
import { SCHEMA_VERSION, assertTaskStatusTransition } from "../domain/models.js";
import { ensureDirectory, pathExists, readJsonFile, writeJsonFile } from "../shared/runtime.js";
import {
  createStateLayout,
  getRunStatePaths,
  getTaskRecordPath,
  type StateLayout,
} from "./state-layout.js";

export interface TaskRecordPatch {
  status?: TaskStatus;
  attempts?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface RunStore {
  createRun(record: RunRecord): Promise<void>;
  updateRun(record: RunRecord): Promise<void>;
  getRun(runId: string): Promise<RunRecord | null>;
  saveGraph(runId: string, graph: RunGraph): Promise<void>;
  getGraph(runId: string): Promise<RunGraph | null>;
  updateTaskStatus(
    runId: string,
    taskId: string,
    update: TaskStatus | TaskRecordPatch,
  ): Promise<TaskRecord>;
  getTaskRecord(runId: string, taskId: string): Promise<TaskRecord | null>;
}

export class FileRunStore implements RunStore {
  private readonly layout: StateLayout;

  constructor(rootDir?: string) {
    this.layout = createStateLayout(rootDir);
  }

  async createRun(record: RunRecord): Promise<void> {
    const paths = getRunStatePaths(this.layout, record.runId);
    if (await pathExists(paths.runFile)) {
      throw new Error(`Run "${record.runId}" already exists.`);
    }

    await ensureDirectory(paths.runDir);
    await writeJsonFile(paths.runFile, record);
  }

  async updateRun(record: RunRecord): Promise<void> {
    const paths = getRunStatePaths(this.layout, record.runId);
    if (!(await pathExists(paths.runFile))) {
      throw new Error(`Run "${record.runId}" was not found.`);
    }

    await writeJsonFile(paths.runFile, record);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const filePath = getRunStatePaths(this.layout, runId).runFile;
    return this.readOptionalJsonFile<RunRecord>(filePath, `run "${runId}"`);
  }

  async saveGraph(runId: string, graph: RunGraph): Promise<void> {
    const paths = getRunStatePaths(this.layout, runId);
    if (!(await pathExists(paths.runFile))) {
      throw new Error(`Run "${runId}" was not found.`);
    }

    await writeJsonFile(paths.graphFile, graph);
    await ensureDirectory(paths.tasksDir);

    for (const task of Object.values(graph.tasks)) {
      const existingRecord = await this.getTaskRecord(runId, task.id);
      const nextRecord: TaskRecord = {
        schemaVersion: existingRecord?.schemaVersion ?? SCHEMA_VERSION,
        runId,
        taskId: task.id,
        status: task.status,
        attempts: existingRecord?.attempts ?? 0,
        startedAt: existingRecord?.startedAt,
        finishedAt: existingRecord?.finishedAt,
      };

      await writeJsonFile(
        getTaskRecordPath(this.layout, runId, task.id),
        nextRecord,
      );
    }
  }

  async getGraph(runId: string): Promise<RunGraph | null> {
    const filePath = getRunStatePaths(this.layout, runId).graphFile;
    return this.readOptionalJsonFile<RunGraph>(filePath, `graph for run "${runId}"`);
  }

  async updateTaskStatus(
    runId: string,
    taskId: string,
    update: TaskStatus | TaskRecordPatch,
  ): Promise<TaskRecord> {
    const graph = await this.getGraph(runId);
    if (!graph) {
      throw new Error(`Run graph "${runId}" was not found.`);
    }

    const graphTask = graph.tasks[taskId];
    if (!graphTask) {
      throw new Error(`Task "${taskId}" was not found in run "${runId}".`);
    }

    const currentRecord =
      (await this.getTaskRecord(runId, taskId)) ?? {
        schemaVersion: SCHEMA_VERSION,
        runId,
        taskId,
        status: graphTask.status,
        attempts: 0,
      };

    const patch = typeof update === "string" ? { status: update } : update;
    const nextStatus = patch.status ?? currentRecord.status;

    if (nextStatus !== currentRecord.status) {
      assertTaskStatusTransition(currentRecord.status, nextStatus);
      graph.tasks[taskId] = {
        ...graphTask,
        status: nextStatus,
      };
      graph.readyQueue = graph.readyQueue.filter((candidate) => candidate !== taskId);
      if ((nextStatus === "ready" || nextStatus === "queued") && !graph.readyQueue.includes(taskId)) {
        graph.readyQueue.push(taskId);
      }
      graph.completedTaskIds = graph.completedTaskIds.filter(
        (candidate) => candidate !== taskId,
      );
      graph.failedTaskIds = graph.failedTaskIds.filter(
        (candidate) => candidate !== taskId,
      );
      graph.cancelledTaskIds = graph.cancelledTaskIds.filter(
        (candidate) => candidate !== taskId,
      );
      if (nextStatus === "completed") {
        graph.completedTaskIds.push(taskId);
      }
      if (
        nextStatus === "failed_retryable" ||
        nextStatus === "failed_terminal" ||
        nextStatus === "blocked"
      ) {
        graph.failedTaskIds.push(taskId);
      }
      if (nextStatus === "cancelled") {
        graph.cancelledTaskIds.push(taskId);
      }
      await writeJsonFile(getRunStatePaths(this.layout, runId).graphFile, graph);
    }

    const nextRecord: TaskRecord = {
      schemaVersion: currentRecord.schemaVersion,
      runId,
      taskId,
      status: nextStatus,
      attempts: patch.attempts ?? currentRecord.attempts,
      ...(patch.startedAt === null
        ? {}
        : { startedAt: patch.startedAt ?? currentRecord.startedAt }),
      ...(patch.finishedAt === null
        ? {}
        : { finishedAt: patch.finishedAt ?? currentRecord.finishedAt }),
    };

    await writeJsonFile(
      getTaskRecordPath(this.layout, runId, taskId),
      nextRecord,
    );

    return nextRecord;
  }

  async getTaskRecord(runId: string, taskId: string): Promise<TaskRecord | null> {
    const filePath = getTaskRecordPath(this.layout, runId, taskId);
    return this.readOptionalJsonFile<TaskRecord>(
      filePath,
      `task "${taskId}" in run "${runId}"`,
    );
  }

  private async readOptionalJsonFile<T>(
    filePath: string,
    label: string,
  ): Promise<T | null> {
    if (!(await pathExists(filePath))) {
      return null;
    }

    try {
      return await readJsonFile<T>(filePath);
    } catch (error) {
      throw new Error(`Failed to read ${label} from "${filePath}".`, {
        cause: error,
      });
    }
  }
}
