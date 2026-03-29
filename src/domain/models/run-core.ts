import type { RunEventType, RunStatus, TaskStatus } from "./status.js";

export interface RunRequest {
  name?: string;
  goal: string;
  workspacePath: string;
  configPath?: string;
  metadata?: Record<string, unknown>;
}

export interface RunRecord {
  schemaVersion: number;
  runId: string;
  name?: string;
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

export function deriveRunName(goal: string, maxLength = 48): string {
  const compact = goal.replace(/\s+/g, " ").trim();
  if (compact.length === 0) {
    return "Untitled run";
  }
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

export function resolveRunName(run: { name?: string; goal: string }): string {
  const explicitName = typeof run.name === "string" ? run.name.trim() : "";
  if (explicitName.length > 0) {
    return explicitName;
  }
  return deriveRunName(run.goal);
}
