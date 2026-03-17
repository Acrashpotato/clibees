export type TaskBoardProjectionStatus =
  | "running"
  | "awaiting_approval"
  | "blocked"
  | "paused"
  | "completed"
  | "failed";

export type TaskBoardProjectionRiskLevel = "low" | "medium" | "high";
export type TaskBoardSessionSourceMode = "task_session" | "task_status_backfill";
export type TaskBoardRetrySourceMode = "task_record" | "status_event_backfill";
export type TaskBoardDependencyState = "satisfied" | "active" | "waiting" | "blocked";

export interface TaskBoardGraphSummary {
  totalTaskCount: number;
  completedTaskCount: number;
  activeTaskCount: number;
  blockedTaskCount: number;
  failedTaskCount: number;
  pendingApprovalCount: number;
  activeSessionCount: number;
  dependencyEdgeCount: number;
}

export interface TaskBoardActiveSession {
  sessionId?: string;
  agentId: string;
  status: TaskBoardProjectionStatus;
  lastActivityAt: string;
  pendingApprovalCount: number;
  sourceMode: TaskBoardSessionSourceMode;
}

export interface TaskBoardRetrySummary {
  attempts?: number;
  maxAttempts: number;
  retryable: boolean;
  requeueRecommended: boolean;
  sourceMode: TaskBoardRetrySourceMode;
  lastFailureAt?: string;
  summary: string;
}

export interface TaskBoardTaskNode {
  taskId: string;
  title: string;
  kind: string;
  status: TaskBoardProjectionStatus;
  statusReason: string;
  waitingReason?: string;
  ownerLabel: string;
  riskLevel: TaskBoardProjectionRiskLevel;
  dependsOn: string[];
  downstreamTaskIds: string[];
  depth: number;
  latestActivityAt: string;
  latestActivitySummary: string;
  activeSession?: TaskBoardActiveSession;
  retry: TaskBoardRetrySummary;
}

export interface TaskBoardDependencyEdge {
  edgeId: string;
  fromTaskId: string;
  toTaskId: string;
  state: TaskBoardDependencyState;
  summary: string;
}

export interface TaskBoardProjectionView {
  projection: "task_board";
  generatedAt: string;
  runId: string;
  graphRevision: number;
  currentTaskId?: string;
  summary: TaskBoardGraphSummary;
  tasks: TaskBoardTaskNode[];
  edges: TaskBoardDependencyEdge[];
}

export function createEmptyTaskBoardProjection(runId = "workspace"): TaskBoardProjectionView {
  return {
    projection: "task_board",
    generatedAt: "",
    runId,
    graphRevision: 0,
    summary: {
      totalTaskCount: 0,
      completedTaskCount: 0,
      activeTaskCount: 0,
      blockedTaskCount: 0,
      failedTaskCount: 0,
      pendingApprovalCount: 0,
      activeSessionCount: 0,
      dependencyEdgeCount: 0,
    },
    tasks: [],
    edges: [],
  };
}
