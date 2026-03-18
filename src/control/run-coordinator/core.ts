import type {
  ApprovalDecision,
  ApprovalRequest,
  MessageThreadRecord,
  RunGraph,
  RunInspection,
  RunRecord,
  RunRequest,
  SessionMessageRecord,
  TaskSessionRecord,
} from "../../domain/models.js";
import type { MultiAgentConfig } from "../../domain/config.js";
import type { ContextAssembler } from "../../decision/context-assembler.js";
import type { Validator } from "../../decision/validator.js";
import type { Planner } from "../../decision/planner.js";
import type { Router } from "../../decision/router.js";
import type { AdapterRegistry } from "../../execution/adapter-registry.js";
import type { ApprovalManager } from "../../execution/approval-manager.js";
import type { ExecutionRuntime } from "../../execution/execution-runtime.js";
import type { SafetyManager } from "../../execution/safety-manager.js";
import type { ArtifactStore } from "../../storage/artifact-store.js";
import type { BlackboardStore } from "../../storage/blackboard-store.js";
import type { EventStore } from "../../storage/event-store.js";
import type { ProjectMemoryStore } from "../../storage/project-memory-store.js";
import type { RunStore } from "../../storage/run-store.js";
import type { SessionStore } from "../../storage/session-store.js";
import type { WorkspaceStateStore } from "../../storage/workspace-state-store.js";
import type { SelectedCli } from "../../ui-api/selected-cli.js";
import type { GraphManager } from "../graph-manager.js";
import type { Scheduler } from "../scheduler.js";

export interface RunCoordinatorDependencies {
  planner: Planner;
  graphManager: GraphManager;
  runStore: RunStore;
  eventStore: EventStore;
  sessionStore: SessionStore;
  projectMemoryStore: ProjectMemoryStore;
  router?: Router;
  contextAssembler?: ContextAssembler;
  validator?: Validator;
  executionRuntime?: ExecutionRuntime;
  adapterRegistry?: AdapterRegistry;
  scheduler?: Scheduler;
  blackboardStore?: BlackboardStore;
  artifactStore?: ArtifactStore;
  workspaceStateStore?: WorkspaceStateStore;
  approvalManager?: ApprovalManager;
  safetyManager?: SafetyManager;
}

export interface ExecutionServices {
  router: Router;
  contextAssembler: ContextAssembler;
  validator: Validator;
  executionRuntime: ExecutionRuntime;
  adapterRegistry: AdapterRegistry;
  scheduler: Scheduler;
  approvalManager: ApprovalManager;
  safetyManager: SafetyManager;
  blackboardStore: BlackboardStore;
  artifactStore: ArtifactStore;
  workspaceStateStore: WorkspaceStateStore;
}

export interface TaskProcessingResult {
  graph: RunGraph;
  run: RunRecord;
  halted: boolean;
}

export interface PostThreadMessageInput {
  actorId: string;
  body: string;
  clientRequestId?: string;
  note?: string;
  replyToMessageId?: string;
}

export interface PostThreadMessageResult {
  run: RunRecord;
  thread: MessageThreadRecord;
  message: SessionMessageRecord;
  resumed: boolean;
}

export interface DelegatedTaskTemplate {
  title?: unknown;
  goal?: unknown;
  instructions?: unknown;
  requiredCapabilities?: unknown;
  preferredAgent?: unknown;
  expectedArtifacts?: unknown;
  acceptanceCriteria?: unknown;
  riskLevel?: unknown;
  timeoutMs?: unknown;
  dependsOn?: unknown;
}

export interface ManagerCoordinationOutput {
  delegatedTasks: DelegatedTaskTemplate[];
  managerReply?: string;
  managerDecision?: "continue" | "no_more_tasks";
}

export interface DelegatedTaskDraft {
  template: DelegatedTaskTemplate;
  index: number;
  taskId: string;
  title: string;
}

export type FileManifest = Map<string, { size: number; mtimeMs: number }>;

export const DEFAULT_SELECTED_CLI: SelectedCli = "codex";
export const DEFAULT_TASK_TIMEOUT_MS = 120_000;
export const DEFAULT_DELEGATED_TASK_TIMEOUT_MS = 900_000;
export const MAX_DELEGATED_TASKS = 12;
export const MAX_MANAGER_COORDINATION_TASKS = 6;
export const MANAGER_PRIMARY_SESSION_ID = "manager_primary";
export const MANAGER_PRIMARY_THREAD_ID = "manager_primary";

export class RunCoordinator {
  constructor(private readonly dependencies: RunCoordinatorDependencies) {}
}

export interface RunCoordinator {
  startRun(request: RunRequest): Promise<RunRecord>;
  resumeRun(runId: string, options?: { config?: MultiAgentConfig }): Promise<RunRecord>;
  inspectRun(runId: string): Promise<RunInspection>;
  listPendingApprovals(runId: string): Promise<ApprovalRequest[]>;
  decideApproval(
    runId: string,
    requestId: string,
    decision: ApprovalDecision,
    actor: string,
    note?: string,
    options?: { config?: MultiAgentConfig },
  ): Promise<RunRecord>;
  postThreadMessage(
    runId: string,
    threadId: string,
    input: PostThreadMessageInput,
  ): Promise<PostThreadMessageResult>;
  interactSession(
    runId: string,
    sessionId: string,
    input: PostThreadMessageInput,
  ): Promise<PostThreadMessageResult>;
  ensureManagerSession(
    runId: string,
  ): Promise<{ session: TaskSessionRecord; thread: MessageThreadRecord }>;
}
