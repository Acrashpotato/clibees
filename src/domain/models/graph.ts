import type {
  GraphPatchOperation,
  RiskLevel,
  TaskKind,
  TaskStatus,
} from "./status.js";

export interface BudgetSpec {
  maxInputChars?: number;
  maxOutputChars?: number;
  maxDurationMs?: number;
}

export interface ActionPolicy {
  kind: string;
  allow: boolean;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  retryOn: Array<"adapter_error" | "timeout" | "validation_fail">;
}

export interface ValidatorSpec {
  mode: "none" | "files" | "command" | "schema" | "composite";
  commands?: string[];
  requiredFiles?: string[];
  outputSchemaId?: string;
  children?: ValidatorSpec[];
}

export interface TaskSpec {
  id: string;
  title: string;
  kind: TaskKind;
  goal: string;
  instructions: string[];
  inputs: string[];
  dependsOn: string[];
  requiredCapabilities: string[];
  preferredAgent?: string;
  assignedAgent?: string;
  workingDirectory: string;
  expectedArtifacts: string[];
  acceptanceCriteria: string[];
  validator: ValidatorSpec;
  riskLevel: RiskLevel;
  allowedActions: ActionPolicy[];
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  budget?: BudgetSpec;
  status: TaskStatus;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface RunGraph {
  runId: string;
  schemaVersion: number;
  revision: number;
  tasks: Record<string, TaskSpec>;
  edges: GraphEdge[];
  readyQueue: string[];
  completedTaskIds: string[];
  failedTaskIds: string[];
  cancelledTaskIds: string[];
  metadata: Record<string, unknown>;
}

export interface GraphPatch {
  operation: GraphPatchOperation;
  reason: string;
  tasks?: TaskSpec[];
  targetTaskIds?: string[];
  anchorTaskId?: string;
}
