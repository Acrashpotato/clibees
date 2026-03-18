import type { RunEventType, RunStatus, TaskStatus } from "./status.js";

export interface RunRequest {
  goal: string;
  workspacePath: string;
  configPath?: string;
  metadata?: Record<string, unknown>;
}

export interface RunRecord {
  schemaVersion: number;
  runId: string;
  goal: string;
  status: RunStatus;
  workspacePath: string;
  configPath?: string;
  currentTaskId?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface TaskRecord {
  schemaVersion: number;
  runId: string;
  taskId: string;
  status: TaskStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface RunEvent<P = Record<string, unknown>> {
  schemaVersion: number;
  id: string;
  type: RunEventType;
  runId: string;
  taskId?: string;
  timestamp: string;
  payload: P;
}
