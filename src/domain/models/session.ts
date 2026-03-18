export type TaskSessionScope = "manager_primary" | "task_session";
export type TaskSessionRole = "manager" | "worker";
export type SessionMessageRole = "user" | "manager" | "worker" | "system";

export interface TaskSessionRecord {
  schemaVersion: number;
  sessionId: string;
  runId: string;
  scope: TaskSessionScope;
  role: TaskSessionRole;
  threadId: string;
  taskId?: string;
  agentId?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface MessageThreadRecord {
  schemaVersion: number;
  threadId: string;
  runId: string;
  scope: TaskSessionScope;
  sessionId?: string;
  taskId?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface SessionMessageRecord {
  schemaVersion: number;
  messageId: string;
  runId: string;
  threadId: string;
  role: SessionMessageRole;
  body: string;
  actorId: string;
  createdAt: string;
  sessionId?: string;
  replyToMessageId?: string;
  clientRequestId?: string;
  metadata: Record<string, unknown>;
}
