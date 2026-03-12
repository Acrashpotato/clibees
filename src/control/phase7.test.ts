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
} from "../domain/models.js";
import type { Planner, PlannerInput, ReplanInput } from "../decision/planner.js";
import { AdapterRegistry } from "../execution/adapter-registry.js";
import type { AgentAdapter } from "../execution/agent-adapter.js";
import { createApp } from "../app/create-app.js";
import { FileEventStore } from "../storage/event-store.js";

function buildTask(workspaceDir: string, overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "task-phase7",
    title: "Phase 7 task",
    kind: "execute",
    goal: "Exercise the safety and approval chain",
    instructions: ["Review actions", "Request approval when needed", "Execute if approved"],
    inputs: [],
    dependsOn: [],
    requiredCapabilities: ["planning"],
    workingDirectory: workspaceDir,
    expectedArtifacts: [],
    acceptanceCriteria: ["Safety review and approval flow is enforced"],
    validator: { mode: "none" },
    riskLevel: "low",
    allowedActions: [],
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: [],
    },
    status: "ready",
    ...overrides,
  };
}

function buildConfig(
  workspaceDir: string,
  safety: MultiAgentConfig["safety"],
): MultiAgentConfig {
  return {
    version: 1,
    agents: [
      {
        id: "local-default",
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
      agentId: "local-default",
    },
    routing: {
      defaultAgentId: "local-default",
      preferLowCost: true,
    },
    safety,
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
  };
}

class SingleTaskPlanner implements Planner {
  constructor(private readonly task: TaskSpec) {}

  async createInitialPlan(_input: PlannerInput): Promise<TaskSpec[]> {
    return [{ ...this.task }];
  }

  async replan(_input: ReplanInput) {
    return {
      operation: "append_tasks" as const,
      reason: "Phase 7 tests do not replan.",
      tasks: [],
    };
  }
}

class ApprovalTestAdapter implements AgentAdapter {
  constructor(
    public readonly agentId: string,
    private readonly actionPlans: ActionPlan[],
  ) {}

  async probe(): Promise<AgentCapability> {
    return {
      agentId: this.agentId,
      supportsNonInteractive: true,
      supportsStructuredOutput: false,
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
      args: ["-e", "process.stdout.write('phase7');"],
      cwd: task.workingDirectory,
      actionPlans: this.actionPlans.map((action) => ({
        ...action,
        taskId: undefined,
      })) as ActionPlan[],
    };
  }

  async *run(): AsyncIterable<RunEvent> {
    return;
  }

  async interrupt(): Promise<void> {
    return;
  }
}

function buildExecutionRuntime(
  eventStore: FileEventStore,
  counter: { count: number },
): NonNullable<ReturnType<typeof createApp>["dependencies"]["executionRuntime"]> {
  return {
    async *execute(runId, task, invocation): AsyncIterable<RunEvent> {
      counter.count += 1;
      const events: RunEvent[] = [
        {
          schemaVersion: 1,
          id: `evt-start-${counter.count}`,
          type: "task_started",
          runId,
          taskId: task.id,
          timestamp: "2026-03-11T14:00:00.000Z",
          payload: {
            agentId: invocation.agentId,
            command: invocation.command,
            args: invocation.args,
            cwd: invocation.cwd,
          },
        },
        {
          schemaVersion: 1,
          id: `evt-complete-${counter.count}`,
          type: "task_completed",
          runId,
          taskId: task.id,
          timestamp: "2026-03-11T14:00:01.000Z",
          payload: {
            agentId: invocation.agentId,
            exitCode: 0,
          },
        },
      ];

      for (const event of events) {
        await eventStore.append(event);
        yield event;
      }
    },
    async interrupt(): Promise<void> {
      return;
    },
  };
}

async function setupPhase7App(options: {
  safety: MultiAgentConfig["safety"];
  actionPlans: ActionPlan[];
  taskOverrides?: Partial<TaskSpec>;
}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase7-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "phase7.txt"), "phase7", "utf8");

  const config = buildConfig(workspaceDir, options.safety);
  const task = buildTask(workspaceDir, options.taskOverrides);
  const registry = new AdapterRegistry();
  registry.register(new ApprovalTestAdapter("local-default", options.actionPlans));
  const eventStore = new FileEventStore(stateRootDir);
  const executionCounter = { count: 0 };
  const app = createApp({
    stateRootDir,
    planner: new SingleTaskPlanner(task),
    adapterRegistry: registry,
    eventStore,
    executionRuntime: buildExecutionRuntime(eventStore, executionCounter),
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
    eventStore,
    executionCounter,
    task,
  };
}

test("Phase 7 blocks configured high-risk actions before execution", async () => {
  const { app, executionCounter } = await setupPhase7App({
    safety: {
      approvalThreshold: "high",
      blockedActions: ["git_push"],
    },
    actionPlans: [
      {
        id: "action-phase7-blocked",
        kind: "git_push",
        command: "git",
        args: ["push", "origin", "main"],
        cwd: process.cwd(),
        riskLevel: "high",
        requiresApproval: true,
        reason: "Push the current branch.",
      },
    ],
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "7", "blocked"])) as RunRecord;
  assert.equal(started.status, "ready");

  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "failed");
  assert.equal(executionCounter.count, 0);

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.deepEqual(
    inspected.events.map((event) => event.type),
    [
      "run_started",
      "memory_recalled",
      "task_planned",
      "agent_selected",
      "context_built",
      "invocation_planned",
      "task_blocked",
      "run_finished",
    ],
  );
  assert.equal(inspected.graph.tasks["task-phase7"]?.status, "blocked");
});

test("Phase 7 approval command lists pending requests and resumes execution after approval", async () => {
  const { app, executionCounter } = await setupPhase7App({
    safety: {
      approvalThreshold: "medium",
      blockedActions: [],
    },
    actionPlans: [
      {
        id: "action-phase7-approve",
        kind: "git_push",
        command: "git",
        args: ["push", "origin", "feature/phase7"],
        cwd: process.cwd(),
        riskLevel: "high",
        requiresApproval: true,
        reason: "Push the Phase 7 branch.",
      },
    ],
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "7", "approval"])) as RunRecord;
  const paused = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(paused.status, "waiting_approval");
  assert.equal(executionCounter.count, 0);

  const pending = (await app.entrypoint.handle(["approvals", started.runId])) as Array<{ id: string }>;
  assert.equal(pending.length, 1);

  const approved = (await app.entrypoint.handle([
    "approve",
    started.runId,
    pending[0]!.id,
    "--actor",
    "tester",
    "--note",
    "approved-for-phase7",
  ])) as RunRecord;
  assert.equal(approved.status, "completed");
  assert.equal(executionCounter.count, 1);

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.deepEqual(
    inspected.events.map((event) => event.type),
    [
      "run_started",
      "memory_recalled",
      "task_planned",
      "agent_selected",
      "context_built",
      "invocation_planned",
      "approval_requested",
      "artifact_created",
      "approval_decided",
      "artifact_created",
      "agent_selected",
      "context_built",
      "invocation_planned",
      "task_queued",
      "task_started",
      "task_completed",
      "artifact_created",
      "validation_started",
      "artifact_created",
      "validation_passed",
      "run_finished",
    ],
  );
  assert.equal(inspected.graph.tasks["task-phase7"]?.status, "completed");
});

test("Phase 7 reject command blocks the task and terminates the run", async () => {
  const { app, executionCounter } = await setupPhase7App({
    safety: {
      approvalThreshold: "medium",
      blockedActions: [],
    },
    actionPlans: [
      {
        id: "action-phase7-reject",
        kind: "delete_file",
        command: "rm",
        args: ["-rf", "dist"],
        cwd: process.cwd(),
        riskLevel: "high",
        requiresApproval: true,
        reason: "Delete the build directory.",
      },
    ],
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "7", "reject"])) as RunRecord;
  const paused = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(paused.status, "waiting_approval");

  const pending = (await app.entrypoint.handle(["approvals", started.runId])) as Array<{ id: string }>;
  assert.equal(pending.length, 1);

  const rejected = (await app.entrypoint.handle([
    "reject",
    started.runId,
    pending[0]!.id,
    "--actor",
    "reviewer",
    "--note",
    "unsafe",
  ])) as RunRecord;
  assert.equal(rejected.status, "failed");
  assert.equal(executionCounter.count, 0);

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.deepEqual(
    inspected.events.map((event) => event.type),
    [
      "run_started",
      "memory_recalled",
      "task_planned",
      "agent_selected",
      "context_built",
      "invocation_planned",
      "approval_requested",
      "artifact_created",
      "approval_decided",
      "artifact_created",
      "task_blocked",
      "run_finished",
    ],
  );
  assert.equal(inspected.graph.tasks["task-phase7"]?.status, "blocked");
});

