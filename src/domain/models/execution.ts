import type { BudgetSpec } from "./graph.js";
import type {
  ApprovalDecision,
  ArtifactKind,
  MemoryKind,
  MemoryStatus,
  RiskLevel,
  ValidationOutcome,
} from "./status.js";

export interface ActionPlan {
  id: string;
  kind: string;
  command?: string;
  args?: string[];
  cwd?: string;
  targets?: string[];
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  reason: string;
}

export interface InvocationPlan {
  taskId: string;
  agentId: string;
  command: string;
  args: string[];
  stdin?: string;
  cwd: string;
  env?: Record<string, string>;
  actionPlans: ActionPlan[];
}

export interface AgentCapability {
  agentId: string;
  supportsNonInteractive: boolean;
  supportsStructuredOutput: boolean;
  supportsCwd: boolean;
  supportsAutoApproveFlags: boolean;
  supportsStreaming: boolean;
  supportsActionPlanning: boolean;
  supportsResume: boolean;
  supportedCapabilities: string[];
  defaultProfileId?: string;
}

export interface AgentProfile {
  agentId: string;
  profileId: string;
  label: string;
  capabilities: string[];
  costTier: "low" | "medium" | "high";
  defaultCwd?: string;
}

export interface ContextBundle {
  taskBrief: string;
  relevantFacts: string[];
  relevantDecisions: string[];
  artifactSummaries: string[];
  workspaceSummary: string;
  transcriptRefs: string[];
  budget?: BudgetSpec;
  agentHints: string[];
}

export interface ValidationResult {
  outcome: ValidationOutcome;
  summary: string;
  details: string[];
  createdArtifacts: string[];
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  taskId: string;
  actionPlans: ActionPlan[];
  reason: string;
  requestedAt: string;
}

export interface ApprovalRecord {
  requestId: string;
  decision: ApprovalDecision;
  decidedAt: string;
  actor: string;
  note?: string;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  taskId?: string;
  kind: ArtifactKind;
  uri: string;
  summary: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface BlackboardEntry {
  id: string;
  runId: string;
  taskId?: string;
  scope: "planner" | "agent" | "validation" | "approval";
  summary: string;
  references: string[];
  updatedAt: string;
}

export interface MemoryRecord {
  schemaVersion: number;
  id: string;
  kind: MemoryKind;
  scope: string;
  subject: string;
  content: string;
  tags: string[];
  sourceRunId: string;
  sourceTaskId?: string;
  confidence: number;
  validFrom: string;
  validUntil?: string;
  status: MemoryStatus;
}

export interface WorkspaceSnapshot {
  id: string;
  runId: string;
  taskId?: string;
  phase: "context" | "before_task" | "after_task";
  baseSnapshotId?: string;
  workingDirectory: string;
  branch?: string;
  head?: string;
  trackedFiles: string[];
  trackedFileStates: Record<string, { size: number; mtimeMs: number }>;
  diffSummary: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
  createdAt: string;
}

export interface WorkspaceDrift {
  hasDrift: boolean;
  severity: "none" | "warning" | "blocking";
  changedFiles: string[];
  unexpectedChanges: string[];
  missingArtifacts: string[];
  branchChanged: boolean;
  headChanged: boolean;
  reasons: string[];
  reason?: string;
}
