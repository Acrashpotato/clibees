export type ManagerProjectionStatus =
  | "running"
  | "awaiting_approval"
  | "blocked"
  | "paused"
  | "completed"
  | "failed";

export type ManagerMessageRole = "user" | "manager" | "worker" | "system";
export type ManagerProjectionRiskLevel = "low" | "medium" | "high" | "none";

export interface ManagerChatRunSummary {
  runId: string;
  goal: string;
  status: ManagerProjectionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ManagerChatSessionBinding {
  sessionId: string;
  threadId: string;
  sourceMode: "task_session" | "run_event_backfill";
}

export interface ManagerChatMessage {
  messageId: string;
  threadId: string;
  sessionId?: string;
  role: ManagerMessageRole;
  actorId: string;
  body: string;
  createdAt: string;
  replyToMessageId?: string;
  sourceMode: "session_message" | "run_event_backfill";
}

export interface ManagerWorkerQueueItem {
  taskId: string;
  title: string;
  status: ManagerProjectionStatus;
  agentId: string;
  lastActivityAt: string;
  sessionId?: string;
  skillId?: string;
}

export interface ManagerPendingApprovalItem {
  requestId: string;
  taskId?: string;
  summary: string;
  riskLevel: ManagerProjectionRiskLevel;
  requestedAt?: string;
}

export interface ManagerChatProjectionView {
  projection: "manager_chat";
  generatedAt: string;
  run: ManagerChatRunSummary;
  managerSession?: ManagerChatSessionBinding;
  timeline: ManagerChatMessage[];
  workerQueue: ManagerWorkerQueueItem[];
  pendingApprovals: ManagerPendingApprovalItem[];
}

export function createEmptyManagerChatProjection(runId = "manager"): ManagerChatProjectionView {
  return {
    projection: "manager_chat",
    generatedAt: "",
    run: {
      runId,
      goal: "No run selected.",
      status: "paused",
      createdAt: "",
      updatedAt: "",
    },
    timeline: [],
    workerQueue: [],
    pendingApprovals: [],
  };
}
