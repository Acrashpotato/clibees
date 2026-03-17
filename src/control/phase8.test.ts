import test from "node:test";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import type { MultiAgentConfig } from "../domain/config.js";
import type {
  AgentCapability,
  InvocationPlan,
  RunEvent,
  RunInspection,
  RunRecord,
  TaskSpec,
} from "../domain/models.js";
import type { Planner, PlannerInput, ReplanInput } from "../decision/planner.js";
import { createApp } from "../app/create-app.js";
import { DefaultValidator } from "../decision/validator.js";
import { AdapterRegistry } from "../execution/adapter-registry.js";
import type { AgentAdapter } from "../execution/agent-adapter.js";
import { FileArtifactStore } from "../storage/artifact-store.js";
import { FileBlackboardStore } from "../storage/blackboard-store.js";
import { FileEventStore } from "../storage/event-store.js";

function buildTask(workspaceDir: string, overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "task-phase8",
    title: "Phase 8 task",
    kind: "execute",
    goal: "Exercise validation and artifact archival",
    instructions: ["Execute", "Archive artifacts", "Validate outputs"],
    inputs: [],
    dependsOn: [],
    requiredCapabilities: ["planning"],
    workingDirectory: workspaceDir,
    expectedArtifacts: [],
    acceptanceCriteria: ["Validation runs after execution"],
    validator: { mode: "none" },
    riskLevel: "low",
    allowedActions: [],
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: ["validation_fail"],
    },
    status: "ready",
    ...overrides,
  };
}

function buildConfig(workspaceDir: string): MultiAgentConfig {
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
      reason: "Phase 8 tests do not replan.",
      tasks: [],
    };
  }
}

class ValidationTestAdapter implements AgentAdapter {
  constructor(public readonly agentId: string) {}

  async probe(): Promise<AgentCapability> {
    return {
      agentId: this.agentId,
      supportsNonInteractive: true,
      supportsStructuredOutput: true,
      supportsCwd: true,
      supportsAutoApproveFlags: false,
      supportsStreaming: false,
      supportsActionPlanning: true,
      supportsResume: false,
      supportedCapabilities: ["planning"],
      defaultProfileId: "default",
    };
  }

  async planInvocation(task: TaskSpec): Promise<InvocationPlan> {
    return {
      taskId: task.id,
      agentId: this.agentId,
      command: "node",
      args: ["-e", "process.stdout.write('phase8');"],
      cwd: task.workingDirectory,
      actionPlans: [],
    };
  }

  async *run(_runId: string, _invocation: InvocationPlan): AsyncIterable<RunEvent> {
    return;
  }

  async interrupt(): Promise<void> {
    return;
  }
}

function buildExecutionRuntime(options: {
  eventStore: FileEventStore;
  onExecute?: (task: TaskSpec) => Promise<void>;
  finalPayload?: Record<string, unknown>;
}) {
  return {
    async *execute(runId: string, task: TaskSpec, invocation: InvocationPlan): AsyncIterable<RunEvent> {
      await options.onExecute?.(task);
      const events: RunEvent[] = [
        {
          schemaVersion: 1,
          id: `evt-start-${task.id}`,
          type: "task_started",
          runId,
          taskId: task.id,
          timestamp: "2026-03-11T15:00:00.000Z",
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
          timestamp: "2026-03-11T15:00:01.000Z",
          payload: {
            agentId: invocation.agentId,
            exitCode: 0,
            ...(options.finalPayload ?? {}),
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

async function setupPhase8App(options: {
  taskOverrides: Partial<TaskSpec>;
  onExecute?: (task: TaskSpec) => Promise<void>;
  finalPayload?: Record<string, unknown>;
}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase8-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "phase8", "utf8");

  const task = buildTask(workspaceDir, options.taskOverrides);
  const config = buildConfig(workspaceDir);
  const registry = new AdapterRegistry();
  registry.register(new ValidationTestAdapter("codex"));
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    planner: new SingleTaskPlanner(task),
    adapterRegistry: registry,
    eventStore,
    executionRuntime: buildExecutionRuntime({
      eventStore,
      onExecute: options.onExecute,
      finalPayload: options.finalPayload,
    }),
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
    stateRootDir,
    task,
  };
}


test("Phase 8 command validator interprets successful command exits", async () => {
  const validator = new DefaultValidator({
    spawnProcess: ((command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      process.nextTick(() => {
        child.stdout.emit("data", `ran ${command} ${args.join(" ")}`.trim());
        child.emit("close", 0, null);
      });
      return child as never;
    }) as never,
  });

  const result = await validator.validate({
    task: buildTask(process.cwd(), {
      validator: {
        mode: "command",
        commands: ["node -e ok"],
      },
    }),
    invocation: {
      taskId: "task-phase8",
      agentId: "local-default",
      command: "node",
      args: [],
      cwd: process.cwd(),
      actionPlans: [],
    },
    artifacts: [],
  });

  assert.equal(result.outcome, "pass");
  assert.match(result.summary, /Validated 1 command check/);
});

test("Phase 8 archives execution artifacts and projects validation summaries", async () => {
  const { app, stateRootDir, task } = await setupPhase8App({
    taskOverrides: {
      validator: {
        mode: "composite",
        children: [
          {
            mode: "files",
            requiredFiles: ["report.txt"],
          },
          {
            mode: "schema",
            outputSchemaId: "json_object",
          },
        ],
      },
    },
    onExecute: async (currentTask) => {
      await writeFile(path.join(currentTask.workingDirectory, "report.txt"), "ok", "utf8");
    },
    finalPayload: {
      structuredOutput: {
        report: "ok",
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "8", "success"])) as RunRecord;
  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "completed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.deepEqual(inspected.events.map((event) => event.type), [
    "run_started",
    "memory_recalled",
    "task_planned",
    "agent_selected",
    "context_built",
    "invocation_planned",
    "task_queued",
    "task_started",
    "task_completed",
    "artifact_created",
    "artifact_created",
    "artifact_created",
    "validation_started",
    "artifact_created",
    "validation_passed",
    "run_finished",
  ]);
  assert.equal(inspected.graph.tasks[task.id]?.status, "completed");

  const artifactStore = new FileArtifactStore(stateRootDir);
  const artifacts = await artifactStore.list(started.runId, { taskId: task.id });
  assert.deepEqual(
    artifacts.map((artifact) => artifact.kind).sort(),
    ["command_result", "file_change", "structured_output", "validation_result"],
  );

  const blackboardStore = new FileBlackboardStore(stateRootDir);
  const entries = await blackboardStore.list(started.runId);
  assert.deepEqual(
    [...new Set(entries.map((entry) => entry.scope))].sort(),
    ["agent", "planner", "validation"],
  );
});

test("Phase 8 maps missing required files to failed_retryable", async () => {
  const { app, stateRootDir, task } = await setupPhase8App({
    taskOverrides: {
      validator: {
        mode: "files",
        requiredFiles: ["missing.txt"],
      },
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 0,
        retryOn: ["validation_fail"],
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "8", "missing-file"])) as RunRecord;
  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "failed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.graph.tasks[task.id]?.status, "failed_retryable");
  assert.ok(inspected.events.some((event) => event.type === "validation_failed"));

  const artifactStore = new FileArtifactStore(stateRootDir);
  const validationArtifact = (await artifactStore.list(started.runId, { kind: "validation_result" }))[0];
  assert.equal(validationArtifact?.metadata.outcome, "fail_retryable");
});

test("Phase 8 maps schema validation failures to failed_terminal", async () => {
  const { app, stateRootDir, task } = await setupPhase8App({
    taskOverrides: {
      validator: {
        mode: "schema",
        outputSchemaId: "json_object",
      },
    },
    finalPayload: {
      structuredOutput: ["bad"],
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "8", "schema-fail"])) as RunRecord;
  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "failed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.graph.tasks[task.id]?.status, "failed_terminal");

  const artifactStore = new FileArtifactStore(stateRootDir);
  const validationArtifact = (await artifactStore.list(started.runId, { kind: "validation_result" }))[0];
  assert.equal(validationArtifact?.metadata.outcome, "fail_replan_needed");
});

test("Phase 8 maps blocked validators to blocked tasks", async () => {
  const { app, task } = await setupPhase8App({
    taskOverrides: {
      validator: {
        mode: "command",
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "8", "blocked"])) as RunRecord;
  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "failed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.graph.tasks[task.id]?.status, "blocked");
  assert.ok(inspected.events.some((event) => event.type === "task_blocked"));
});





