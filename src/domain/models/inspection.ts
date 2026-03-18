import type { RunGraph } from "./graph.js";
import type { BlackboardEntry } from "./execution.js";
import type { RunEvent, RunRecord } from "./run-core.js";
import type { ArtifactKind, RiskLevel, RunEventType, RunStatus, TaskStatus } from "./status.js";

export interface InspectionTimelineEntry {
  eventId: string;
  type: RunEventType;
  timestamp: string;
  taskId?: string;
  title: string;
  details: string[];
}

export interface InspectionArtifactItem {
  id: string;
  taskId?: string;
  kind: ArtifactKind;
  uri: string;
  summary: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface InspectionArtifactGroup {
  taskId?: string;
  taskTitle: string;
  artifacts: InspectionArtifactItem[];
}

export interface InspectionBlackboardEntry {
  id: string;
  taskId?: string;
  summary: string;
  references: string[];
  updatedAt: string;
}

export interface InspectionBlackboardScope {
  scope: BlackboardEntry["scope"];
  latestSummary?: string;
  entries: InspectionBlackboardEntry[];
}

export interface InspectionValidationItem {
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  outcome?: string;
  summary: string;
  details: string[];
  updatedAt?: string;
}

export interface InspectionApprovalItem {
  requestId: string;
  taskId?: string;
  summary: string;
  state: "pending" | "approved" | "rejected";
  actor?: string;
  decidedAt?: string;
  riskLevel?: RiskLevel;
}

export interface InspectionSummary {
  runStatus: RunStatus;
  completedTasks: number;
  failedTasks: number;
  blockedTasks: number;
  pendingApprovals: number;
  latestFailure?: string;
  latestBlocker?: string;
  latestReplan?: string;
  latestValidation?: string;
}

/**
 * Transitional aggregate used to support legacy inspect/workspace-style reads
 * while the repository migrates to dedicated page projections.
 */
export interface RunInspection {
  run: RunRecord;
  graph: RunGraph;
  events: RunEvent[];
  timeline: InspectionTimelineEntry[];
  artifacts: InspectionArtifactGroup[];
  blackboard: InspectionBlackboardScope[];
  validation: InspectionValidationItem[];
  approvals: InspectionApprovalItem[];
  summary: InspectionSummary;
}
