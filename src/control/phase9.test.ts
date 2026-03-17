import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import type { MultiAgentConfig } from "../domain/config.js";
import type {
  ActionPlan,
  AgentCapability,
  ContextBundle,
  InvocationPlan,
  RunEvent,
  RunInspection,
  RunRecord,
  TaskSpec,
  ValidationResult,
} from "../domain/models.js";
import type { Planner, PlannerInput, ReplanInput } from "../decision/planner.js";
import type { ValidationInput, Validator } from "../decision/validator.js";
import { createApp } from "../app/create-app.js";
import { GraphManager } from "./graph-manager.js";
import { AdapterRegistry } from "../execution/adapter-registry.js";
import type { AgentAdapter } from "../execution/agent-adapter.js";
import { FileEventStore } from "../storage/event-store.js";
import { FileWorkspaceStateStore } from "../storage/workspace-state-store.js";

function buildTask(workspaceDir: string, overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "task-default",
    title: "Phase 9 task",
    kind: "execute",
    goal: "Exercise Phase 9",
    instructions: ["Execute the task"],
    inputs: [],
    dependsOn: [],
    requiredCapabilities: ["planning"],
    workingDirectory: workspaceDir,
    expectedArtifacts: [],
    acceptanceCriteria: ["Task completes"],
    validator: { mode: "none" },
    riskLevel: "low",
    allowedActions: [],
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 0,
      retryOn: ["validation_fail"],
    },
    status: "ready",
    ...overrides,
  };
}

function buildConfig(
  workspaceDir: string,
  overrides: Partial<MultiAgentConfig> = {},
): MultiAgentConfig {
  return {
    version: 1,
    agents: [
      {
        id: "codex",
        command: "node",
        priority: 1,
        profiles: [
          {
            id: "default",
            label: "Default",
            capabilities: ["planning"],
            defaultArgs: [],
            defaultCwd: workspaceDir,
            costTier: "low",
          },
        ],
      },
    ],
    planner: {
      mode: "static",
      agentId: "codex",
    },
    routing: {
      defaultAgentId: "codex",
      preferLowCost: true,
    },
    safety: {
      approvalThreshold: "high",
      blockedActions: [],
    },
    memory: {
      enabled: false,
      rootDir: path.join(workspaceDir, ".multi-agent", "memory"),
    },
    workspace: {
      rootDir: workspaceDir,
      allowOutsideWorkspaceWrites: false,
    },
    validation: {
      defaultTimeoutMs: 60_000,
      enableBuildChecks: true,
    },
    logging: {
      level: "info",
      persistEvents: true,
    },
    ...overrides,
  };
}

class Phase9Planner implements Planner {
  constructor(
    private readonly tasks: TaskSpec[],
    private readonly replanPatch = {
      operation: "append_tasks" as const,
      reason: "No replanning configured.",
      tasks: [] as TaskSpec[],
    },
  ) {}

  async createInitialPlan(_input: PlannerInput): Promise<TaskSpec[]> {
    return this.tasks.map((task) => ({ ...task }));
  }

  async replan(_input: ReplanInput) {
    return {
      ...this.replanPatch,
      tasks: this.replanPatch.tasks.map((task) => ({ ...task })),
    };
  }
}

class Phase9Adapter implements AgentAdapter {
  constructor(
    public readonly agentId: string,
    private readonly actionPlansByTaskId: Record<string, ActionPlan[]> = {},
  ) {}

  async probe(): Promise<AgentCapability> {
    return {
      agentId: this.agentId,
      supportsNonInteractive: true,
      supportsStructuredOutput: true,
      supportsCwd: true,
      supportsAutoApproveFlags: false,
      supportsStreaming: true,
      supportsActionPlanning: true,
      supportsResume: false,
      supportedCapabilities: ["planning"],
      defaultProfileId: "default",
    };
  }

  async planInvocation(
    task: TaskSpec,
    _context: ContextBundle,
  ): Promise<InvocationPlan> {
    return {
      taskId: task.id,
      agentId: this.agentId,
      command: "node",
      args: ["-e", `process.stdout.write(${JSON.stringify(task.id)});`],
      cwd: task.workingDirectory,
      actionPlans: (this.actionPlansByTaskId[task.id] ?? []).map((action) => ({
        ...action,
      })),
    };
  }

  async *run(): AsyncIterable<RunEvent> {
    return;
  }

  async interrupt(): Promise<void> {
    return;
  }
}

function buildExecutionRuntime(options: {
  eventStore: FileEventStore;
  onExecute?: (task: TaskSpec) => Promise<void>;
  finalPayloadByTaskId?: Record<string, Record<string, unknown>>;
  executionCounter?: { count: number };
}): NonNullable<ReturnType<typeof createApp>["dependencies"]["executionRuntime"]> {
  return {
    async *execute(runId, task, invocation): AsyncIterable<RunEvent> {
      options.executionCounter && (options.executionCounter.count += 1);
      await options.onExecute?.(task);
      const finalPayload = options.finalPayloadByTaskId?.[task.id] ?? {};
      const events: RunEvent[] = [
        {
          schemaVersion: 1,
          id: `evt-start-${task.id}`,
          type: "task_started",
          runId,
          taskId: task.id,
          timestamp: "2026-03-12T10:00:00.000Z",
          payload: {
            agentId: invocation.agentId,
            command: invocation.command,
            args: invocation.args,
            cwd: invocation.cwd,
          },
        },
        {
          schemaVersion: 1,
          id: `evt-complete-${task.id}`,
          type: "task_completed",
          runId,
          taskId: task.id,
          timestamp: "2026-03-12T10:00:01.000Z",
          payload: {
            agentId: invocation.agentId,
            exitCode: 0,
            ...finalPayload,
          },
        },
      ];

      for (const event of events) {
        await options.eventStore.append(event);
        yield event;
      }
    },
    async interrupt(): Promise<void> {
      return;
    },
  };
}

async function setupPhase9App(options: {
  tasks: TaskSpec[];
  replanTasks?: TaskSpec[];
  actionPlansByTaskId?: Record<string, ActionPlan[]>;
  validator?: Validator;
  onExecute?: (task: TaskSpec) => Promise<void>;
  finalPayloadByTaskId?: Record<string, Record<string, unknown>>;
  configOverrides?: Partial<MultiAgentConfig>;
}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase9-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "phase9", "utf8");

  const tasks = options.tasks.map((task) => ({ ...task, workingDirectory: workspaceDir }));
  const replanTasks = options.replanTasks?.map((task) => ({
    ...task,
    workingDirectory: workspaceDir,
  }));
  const config = buildConfig(workspaceDir, options.configOverrides);
  const planner = new Phase9Planner(
    tasks,
    replanTasks
      ? {
          operation: "append_tasks" as const,
          reason: "Validation requested a follow-up task.",
          tasks: replanTasks,
        }
      : undefined,
  );
  const registry = new AdapterRegistry();
  registry.register(
    new Phase9Adapter("codex", options.actionPlansByTaskId),
  );
  const eventStore = new FileEventStore(stateRootDir);
  const executionCounter = { count: 0 };
  const app = createApp({
    stateRootDir,
    planner,
    adapterRegistry: registry,
    eventStore,
    executionRuntime: buildExecutionRuntime({
      eventStore,
      onExecute: options.onExecute,
      finalPayloadByTaskId: options.finalPayloadByTaskId,
      executionCounter,
    }),
    validator: options.validator,
    configLoader: {
      async load(): Promise<MultiAgentConfig> {
        return config;
      },
    },
    projectMemoryStore: {
      async recall() {
        return [];
      },
      async persist() {
        return;
      },
    },
  });

  return {
    app,
    workspaceDir,
    stateRootDir,
    executionCounter,
  };
}

test("Phase 9 GraphManager append and cancel patches preserve graph integrity", () => {
  const graphManager = new GraphManager();
  const graph = graphManager.createGraph("run-phase9-graph", [
    buildTask(process.cwd(), { id: "task-a", title: "A" }),
    buildTask(process.cwd(), { id: "task-b", title: "B", dependsOn: ["task-a"] }),
  ]);

  const appended = graphManager.applyPatch(graph, {
    operation: "append_tasks",
    reason: "Add an extra pending task.",
    tasks: [
      buildTask(process.cwd(), {
        id: "task-c",
        title: "C",
        dependsOn: ["task-a"],
      }),
    ],
  });
  assert.equal(appended.tasks["task-c"]?.status, "pending");

  const cancelled = graphManager.applyPatch(appended, {
    operation: "cancel_pending_tasks",
    reason: "Drop task B.",
    targetTaskIds: ["task-b"],
  });
  assert.equal(cancelled.tasks["task-b"]?.status, "cancelled");
  assert.ok(cancelled.cancelledTaskIds.includes("task-b"));
});

test("Phase 9 GraphManager replaces pending subgraphs and rejects completed targets", () => {
  const graphManager = new GraphManager();
  const original = graphManager.createGraph("run-phase9-replace", [
    buildTask(process.cwd(), { id: "task-a", title: "A" }),
    buildTask(process.cwd(), { id: "task-b", title: "B", dependsOn: ["task-a"] }),
    buildTask(process.cwd(), { id: "task-c", title: "C", dependsOn: ["task-b"] }),
  ]);

  original.tasks["task-a"] = { ...original.tasks["task-a"]!, status: "completed" };
  original.completedTaskIds.push("task-a");
  original.readyQueue = ["task-b"];
  original.tasks["task-b"] = { ...original.tasks["task-b"]!, status: "ready" };

  const replaced = graphManager.applyPatch(original, {
    operation: "replace_pending_subgraph",
    reason: "Swap B/C for D.",
    targetTaskIds: ["task-b"],
    tasks: [
      buildTask(process.cwd(), {
        id: "task-d",
        title: "D",
        dependsOn: ["task-a"],
      }),
    ],
  });
  assert.equal(replaced.tasks["task-b"], undefined);
  assert.equal(replaced.tasks["task-c"], undefined);
  assert.equal(replaced.tasks["task-d"]?.status, "ready");

  assert.throws(() =>
    graphManager.applyPatch(original, {
      operation: "replace_pending_subgraph",
      reason: "Illegal replace.",
      targetTaskIds: ["task-a"],
      tasks: [],
    }),
  );
});

test("Phase 9 captures workspace snapshots and pauses resume when drift is detected", async () => {
  const task1 = buildTask("", { id: "task-build", title: "Build output" });
  const task2 = buildTask("", {
    id: "task-approve",
    title: "Approval step",
    dependsOn: ["task-build"],
  });

  const { app, workspaceDir } = await setupPhase9App({
    tasks: [
      { ...task1, workingDirectory: workspaceDirPlaceholder() },
      { ...task2, workingDirectory: workspaceDirPlaceholder() },
    ],
    actionPlansByTaskId: {
      "task-approve": [
        {
          id: "action-phase9-approve",
          kind: "git_push",
          command: "git",
          args: ["push", "origin", "phase9"],
          cwd: process.cwd(),
          riskLevel: "high",
          requiresApproval: true,
          reason: "Push the Phase 9 branch.",
        },
      ],
    },
    onExecute: async (task) => {
      if (task.id === "task-build") {
        await writeFile(path.join(task.workingDirectory, "generated.txt"), "built", "utf8");
      }
    },
    configOverrides: {
      safety: {
        approvalThreshold: "medium",
        blockedActions: [],
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "9", "drift"])) as RunRecord;
  const waiting = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(waiting.status, "waiting_approval");

  const workspaceStore = new FileWorkspaceStateStore({
    stateRootDir: path.join(workspaceDir, ".multi-agent", "state"),
    workspaceRootDir: workspaceDir,
  });
  const beforeSnapshot = await workspaceStore.getLatestSnapshot(started.runId, {
    phases: ["before_task"],
  });
  const afterSnapshot = await workspaceStore.getLatestSnapshot(started.runId, {
    phases: ["after_task"],
  });
  assert.equal(beforeSnapshot?.taskId, "task-build");
  assert.equal(afterSnapshot?.taskId, "task-build");
  assert.ok(afterSnapshot?.diffSummary.added.includes("generated.txt"));

  await writeFile(path.join(workspaceDir, "seed.txt"), "drifted", "utf8");
  const paused = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(paused.status, "paused");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.ok(inspected.events.some((event) => event.type === "workspace_drift_detected"));
});

test("Phase 9 resume keeps pending approvals suspended without re-executing the task", async () => {
  const { app, executionCounter } = await setupPhase9App({
    tasks: [buildTask(workspaceDirPlaceholder(), { id: "task-waiting" })],
    actionPlansByTaskId: {
      "task-waiting": [
        {
          id: "action-phase9-waiting",
          kind: "git_push",
          command: "git",
          args: ["push", "origin", "phase9"],
          cwd: process.cwd(),
          riskLevel: "high",
          requiresApproval: true,
          reason: "Needs manual approval.",
        },
      ],
    },
    configOverrides: {
      safety: {
        approvalThreshold: "medium",
        blockedActions: [],
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "9", "pending-approval"])) as RunRecord;
  const waiting = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(waiting.status, "waiting_approval");
  assert.equal(executionCounter.count, 0);

  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "waiting_approval");
  assert.equal(executionCounter.count, 0);
});

test("Phase 9 replans after validation requests a new task and completes the replacement work", async () => {
  const replanSource = buildTask(workspaceDirPlaceholder(), {
    id: "task-replan-source",
    title: "Source task",
    validator: { mode: "schema", outputSchemaId: "json_object" },
  });
  const replanFollowup = buildTask(workspaceDirPlaceholder(), {
    id: "task-replan-followup",
    title: "Follow-up task",
  });

  const validator: Validator = {
    async validate(input: ValidationInput): Promise<ValidationResult> {
      if (input.task.id === "task-replan-source") {
        return {
          outcome: "fail_replan_needed",
          summary: "Need a follow-up task.",
          details: ["Source task emitted incomplete output."],
          createdArtifacts: [],
        };
      }
      return {
        outcome: "pass",
        summary: "Follow-up task validated.",
        details: [],
        createdArtifacts: [],
      };
    },
  };

  const { app } = await setupPhase9App({
    tasks: [replanSource],
    replanTasks: [replanFollowup],
    validator,
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "9", "replan"])) as RunRecord;
  const completed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(completed.status, "completed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.graph.tasks["task-replan-source"]?.status, "cancelled");
  assert.equal(inspected.graph.tasks["task-replan-followup"]?.status, "completed");
  assert.ok(inspected.events.some((event) => event.type === "replan_requested"));
  assert.ok(inspected.events.some((event) => event.type === "replan_applied"));
});

function workspaceDirPlaceholder(): string {
  return process.cwd();
}
