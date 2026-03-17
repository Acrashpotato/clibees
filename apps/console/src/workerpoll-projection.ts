export type WorkerpollStatus =
  | "running"
  | "awaiting_approval"
  | "blocked"
  | "paused"
  | "completed"
  | "failed";

export type WorkerpollMatchStatus =
  | "matched"
  | "mismatched"
  | "unassigned"
  | "capability_gap";

export interface WorkerpollRunSummary {
  runId: string;
  goal: string;
  status: WorkerpollStatus;
  plannerAgentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerpollSummary {
  taskCount: number;
  workerCount: number;
  dynamicWorkerCount: number;
  uncoveredTaskCount: number;
}

export interface WorkerpollWorkerItem {
  agentId: string;
  source: "configured" | "dynamic" | "metadata";
  command?: string;
  profileIds: string[];
  capabilities: string[];
  isPlanner: boolean;
  priority?: number;
}

export interface WorkerpollTaskItem {
  taskId: string;
  title: string;
  kind: "plan" | "execute" | "validate";
  status: WorkerpollStatus;
  requiredCapabilities: string[];
  compatibleWorkers: string[];
  missingCapabilities: string[];
  preferredAgent?: string;
  assignedAgent?: string;
  selectedWorker?: string;
  dependsOn: string[];
  matchStatus: WorkerpollMatchStatus;
  lastActivityAt: string;
}

export interface WorkerpollProjectionView {
  projection: "workerpoll";
  generatedAt: string;
  run: WorkerpollRunSummary;
  summary: WorkerpollSummary;
  workers: WorkerpollWorkerItem[];
  tasks: WorkerpollTaskItem[];
}

export function createEmptyWorkerpollProjection(runId = "workerpoll"): WorkerpollProjectionView {
  return {
    projection: "workerpoll",
    generatedAt: "",
    run: {
      runId,
      goal: "No run selected.",
      status: "paused",
      createdAt: "",
      updatedAt: "",
    },
    summary: {
      taskCount: 0,
      workerCount: 0,
      dynamicWorkerCount: 0,
      uncoveredTaskCount: 0,
    },
    workers: [],
    tasks: [],
  };
}

