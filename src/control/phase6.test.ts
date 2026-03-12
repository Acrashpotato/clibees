import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import type { AgentConfig, MultiAgentConfig } from "../domain/config.js";
import type {
  AgentCapability,
  ContextBundle,
  InvocationPlan,
  RunInspection,
  RunRecord,
  RunEvent,
  RunGraph,
  TaskSpec,
} from "../domain/models.js";
import { AdapterRegistry } from "../execution/adapter-registry.js";
import type { AgentAdapter } from "../execution/agent-adapter.js";
import { RuleBasedRouter } from "../decision/router.js";
import { DefaultContextAssembler } from "../decision/context-assembler.js";
import { FileBlackboardStore } from "../storage/blackboard-store.js";
import { FileArtifactStore } from "../storage/artifact-store.js";
import { FileEventStore } from "../storage/event-store.js";
import { FileWorkspaceStateStore } from "../storage/workspace-state-store.js";
import { FileProjectMemoryStore } from "../storage/project-memory-store.js";
import { createApp } from "../app/create-app.js";

function buildTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "task-phase6",
    title: "Phase 6 task",
    kind: "execute",
    goal: "Exercise the routing and execution chain",
    instructions: ["Select an agent", "Build context", "Run the command"],
    inputs: [],
    dependsOn: [],
    requiredCapabilities: ["planning"],
    workingDirectory: process.cwd(),
    expectedArtifacts: [],
    acceptanceCriteria: ["Task completes end-to-end"],
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

function buildGraph(runId: string, task: TaskSpec): RunGraph {
  return {
    runId,
    schemaVersion: 1,
    revision: 1,
    tasks: {
      [task.id]: task,
    },
    edges: [],
    readyQueue: [task.id],
    completedTaskIds: [],
    failedTaskIds: [],
    cancelledTaskIds: [],
    metadata: {},
  };
}

class FakeAdapter implements AgentAdapter {
  constructor(
    public readonly agentId: string,
    private readonly capability: AgentCapability,
  ) {}

  async probe(): Promise<AgentCapability> {
    return this.capability;
  }

  async planInvocation(): Promise<InvocationPlan> {
    throw new Error("Not implemented.");
  }

  async *run(): AsyncIterable<RunEvent> {
    return;
  }

  async interrupt(): Promise<void> {
    return Promise.resolve();
  }
}

test("RuleBasedRouter prefers low-cost compatible agents and falls back from unavailable preferred agents", async () => {
  const registry = new AdapterRegistry();
  registry.register(
    new FakeAdapter("expensive", {
      agentId: "expensive",
      supportsNonInteractive: true,
      supportsStructuredOutput: false,
      supportsCwd: true,
      supportsAutoApproveFlags: false,
      supportsStreaming: true,
      supportsActionPlanning: true,
      supportsResume: false,
      supportedCapabilities: ["planning"],
      defaultProfileId: "default",
    }),
  );
  registry.register(
    new FakeAdapter("cheap", {
      agentId: "cheap",
      supportsNonInteractive: true,
      supportsStructuredOutput: false,
      supportsCwd: true,
      supportsAutoApproveFlags: false,
      supportsStreaming: true,
      supportsActionPlanning: true,
      supportsResume: false,
      supportedCapabilities: ["planning"],
      defaultProfileId: "default",
    }),
  );

  const agents: AgentConfig[] = [
    {
      id: "expensive",
      command: "expensive-cli",
      priority: 1,
      profiles: [
        {
          id: "default",
          label: "Default",
          capabilities: ["planning"],
          costTier: "high",
        },
      ],
    },
    {
      id: "cheap",
      command: "cheap-cli",
      priority: 5,
      profiles: [
        {
          id: "default",
          label: "Default",
          capabilities: ["planning"],
          costTier: "low",
        },
      ],
    },
  ];

  const router = new RuleBasedRouter({
    adapterRegistry: registry,
    agents,
    routing: {
      preferLowCost: true,
    },
  });

  const selected = await router.selectAgent(buildTask());
  assert.equal(selected.agentId, "cheap");

  const fallback = await router.selectAgent(
    buildTask({ preferredAgent: "missing-agent" }),
  );
  assert.equal(fallback.agentId, "cheap");
  assert.match(fallback.reason, /fell back/);
});

test("DefaultContextAssembler injects blackboard, artifacts, memory, and trims to budget", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase6-context-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  const memoryRootDir = path.join(workspaceDir, ".multi-agent", "memory");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "README.md"), "phase6", "utf8");
  await writeFile(path.join(workspaceDir, "notes.txt"), "context", "utf8");

  const blackboardStore = new FileBlackboardStore(stateRootDir);
  const artifactStore = new FileArtifactStore(stateRootDir);
  const workspaceStateStore = new FileWorkspaceStateStore({
    stateRootDir,
    workspaceRootDir: workspaceDir,
  });
  const projectMemoryStore = new FileProjectMemoryStore(memoryRootDir);
  const runId = "run-phase6-context";
  const task = buildTask({
    workingDirectory: workspaceDir,
    budget: {
      maxInputChars: 520,
    },
  });

  await blackboardStore.upsert({
    id: "bb-planner",
    runId,
    scope: "planner",
    summary: "Planner summary for this run.",
    references: ["transcript://task-phase6#1"],
    updatedAt: "2026-03-11T12:00:00.000Z",
  });
  await blackboardStore.upsert({
    id: "bb-agent",
    runId,
    taskId: task.id,
    scope: "agent",
    summary: "Agent-facing fact for the current task.",
    references: ["transcript://task-phase6#2"],
    updatedAt: "2026-03-11T12:01:00.000Z",
  });
  await artifactStore.record({
    id: "artifact-1",
    runId,
    taskId: task.id,
    kind: "command_result",
    uri: "file:///tmp/output.txt",
    summary: "Command output summary.",
    createdAt: "2026-03-11T12:02:00.000Z",
    metadata: {},
  });
  await projectMemoryStore.persist([
    {
      schemaVersion: 1,
      id: "memory-phase6",
      kind: "decision",
      scope: "project",
      subject: "Phase 6",
      content: "Routing and context assembly are implemented.",
      tags: ["phase6", "routing"],
      sourceRunId: "manual-phase6",
      confidence: 0.95,
      validFrom: "2026-03-11T12:03:00.000Z",
      status: "active",
    },
  ]);

  const assembler = new DefaultContextAssembler({
    blackboardStore,
    artifactStore,
    projectMemoryStore,
    workspaceStateStore,
  });

  const context = await assembler.buildContext({
    task,
    selection: {
      agentId: "local-default",
      profileId: "default",
      reason: "selected for planning",
    },
    graph: buildGraph(runId, task),
  });

  const totalChars = [
    context.taskBrief,
    context.workspaceSummary,
    ...context.relevantFacts,
    ...context.relevantDecisions,
    ...context.artifactSummaries,
    ...context.transcriptRefs,
    ...context.agentHints,
  ].reduce((sum, value) => sum + value.length, 0);

  assert.ok(context.relevantFacts.some((fact) => fact.includes("Agent-facing fact")));
  assert.ok(
    context.relevantDecisions.some((decision) => decision.includes("Phase 6")),
  );
  assert.match(context.workspaceSummary, /README.md|notes.txt/);
  assert.ok(totalChars <= 520);
});

test("RunCoordinator resume executes the minimal Phase 6 chain end-to-end", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase6-run-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "index.txt"), "phase6", "utf8");

  const config: MultiAgentConfig = {
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
            defaultArgs: [
              "-e",
              "const prompt = process.argv[1] ?? ''; process.stdout.write(`OUT:${prompt}\\n`);",
            ],
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
    safety: {
      approvalThreshold: "high",
      blockedActions: [],
    },
    memory: {
      enabled: true,
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

  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    eventStore,
    configLoader: {
      async load(): Promise<MultiAgentConfig> {
        return config;
      },
    },
    executionRuntime: {
      async *execute(runId, task, invocation): AsyncIterable<RunEvent> {
        const events: RunEvent[] = [
          {
            schemaVersion: 1,
            id: "evt-start",
            type: "task_started",
            runId,
            taskId: task.id,
            timestamp: "2026-03-11T13:00:00.000Z",
            payload: {
              agentId: invocation.agentId,
              command: invocation.command,
              args: invocation.args,
              cwd: invocation.cwd,
            },
          },
          {
            schemaVersion: 1,
            id: "evt-message",
            type: "agent_message",
            runId,
            taskId: task.id,
            timestamp: "2026-03-11T13:00:01.000Z",
            payload: {
              agentId: invocation.agentId,
              stream: "stdout",
              message: "OUT:phase6\n",
            },
          },
          {
            schemaVersion: 1,
            id: "evt-complete",
            type: "task_completed",
            runId,
            taskId: task.id,
            timestamp: "2026-03-11T13:00:02.000Z",
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

  const started = (await app.entrypoint.handle([
    "run",
    "Ship",
    "Phase",
    "6",
  ])) as RunRecord;
  assert.equal(started.status, "ready");

  const resumed = (await app.entrypoint.handle([
    "resume",
    started.runId,
  ])) as RunRecord;
  assert.equal(resumed.status, "completed");

  const inspected = (await app.entrypoint.handle([
    "inspect",
    started.runId,
  ])) as RunInspection;
  assert.deepEqual(
    inspected.events.map((event) => event.type),
    [
      "run_started",
      "memory_recalled",
      "task_planned",
      "agent_selected",
      "context_built",
      "invocation_planned",
      "task_queued",
      "task_started",
      "agent_message",
      "task_completed",
      "artifact_created",
      "validation_started",
      "artifact_created",
      "validation_passed",
      "run_finished",
    ],
  );
  assert.equal(inspected.graph.completedTaskIds.length, 1);
  const [taskRecord] = Object.values(inspected.graph.tasks);
  assert.equal(taskRecord?.status, "completed");
});

