import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { MultiAgentConfig } from "../domain/config.js";
import type {
  AgentCapability,
  InvocationPlan,
  RunEvent,
  RunInspection,
  RunRecord,
  TaskSpec,
} from "../domain/models.js";
import { createApp } from "../app/create-app.js";
import { AdapterRegistry } from "../execution/adapter-registry.js";
import type { AgentAdapter } from "../execution/agent-adapter.js";
import { FileEventStore } from "../storage/event-store.js";

class DelegationAdapter implements AgentAdapter {
  constructor(
    public readonly agentId: string,
    private readonly capability: AgentCapability,
  ) {}

  async probe(): Promise<AgentCapability> {
    return this.capability;
  }

  async planInvocation(task: TaskSpec): Promise<InvocationPlan> {
    return {
      taskId: task.id,
      agentId: this.agentId,
      command: "node",
      args: ["-e", "process.stdout.write('ok');"],
      cwd: task.workingDirectory,
      actionPlans: [],
    };
  }

  async *run(
    _runId: string,
    _invocation: InvocationPlan,
  ): AsyncIterable<RunEvent> {
    return;
  }

  async interrupt(): Promise<void> {
    return;
  }
}

function buildExecutionRuntime(
  eventStore: FileEventStore,
  options: {
    managerShouldFail?: boolean;
    managerNoMoreTasks?: boolean;
    managerDelegatedTasks?: Array<{
      title: string;
      goal: string;
      preferredAgent?: string;
      dependsOn?: string[];
      requiredCapabilities?: string[];
      instructions?: string[];
      expectedArtifacts?: string[];
      acceptanceCriteria?: string[];
    }>;
  } = {},
) {
  return {
    async *execute(
      runId: string,
      task: TaskSpec,
      invocation: InvocationPlan,
    ): AsyncIterable<RunEvent> {
      const isManagerTask =
        task.kind === "plan" && task.requiredCapabilities.includes("delegation");
      const managerDelegationPayload =
        isManagerTask
          ? {
              structuredOutput: {
                ...(options.managerNoMoreTasks
                  ? {
                      managerReply: "No additional delegated work is required.",
                      managerDecision: "no_more_tasks",
                      delegatedTasks: [],
                    }
                  : {
                      managerReply: "Delegating work to the worker agent.",
                      managerDecision: "continue",
                      delegatedTasks: options.managerDelegatedTasks ?? [
                        {
                          title: "Worker implementation",
                          goal: "Implement the delegated user goal end-to-end.",
                          preferredAgent: "cli-worker",
                          dependsOn: [],
                          requiredCapabilities: ["planning"],
                          instructions: ["Implement the requested goal in the workspace."],
                          expectedArtifacts: ["Concrete implementation output."],
                          acceptanceCriteria: ["Delegated goal is completed."],
                        },
                      ],
                    }),
              },
            }
          : {};
      const events: RunEvent[] = [
        {
          schemaVersion: 1,
          id: `evt-start-${task.id}`,
          type: "task_started",
          runId,
          taskId: task.id,
          timestamp: "2026-03-16T10:00:00.000Z",
          payload: {
            agentId: invocation.agentId,
            command: invocation.command,
            args: invocation.args,
            cwd: invocation.cwd,
          },
        },
      ];
      if (isManagerTask && options.managerShouldFail) {
        events.push({
          schemaVersion: 1,
          id: `evt-fail-${task.id}`,
          type: "task_failed",
          runId,
          taskId: task.id,
          timestamp: "2026-03-16T10:00:01.000Z",
          payload: {
            agentId: invocation.agentId,
            exitCode: 1,
            output: "manager failed before producing delegation json",
          },
        });
      } else {
        events.push({
          schemaVersion: 1,
          id: `evt-complete-${task.id}`,
          type: "task_completed",
          runId,
          taskId: task.id,
          timestamp: "2026-03-16T10:00:01.000Z",
          payload: {
            agentId: invocation.agentId,
            exitCode: 0,
            ...managerDelegationPayload,
          },
        });
      }

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

function createDelegatedConfig(workspaceDir: string): MultiAgentConfig {
  return {
    version: 1,
    agents: [
      {
        id: "cli-manager",
        command: "node",
        priority: 1,
        profiles: [
          {
            id: "default",
            label: "Manager",
            capabilities: ["planning", "delegation"],
            defaultArgs: [],
            defaultCwd: workspaceDir,
            costTier: "low",
          },
        ],
      },
      {
        id: "cli-worker",
        command: "node",
        priority: 2,
        profiles: [
          {
            id: "default",
            label: "Worker",
            capabilities: ["planning"],
            defaultArgs: [],
            defaultCwd: workspaceDir,
            costTier: "low",
          },
        ],
      },
    ],
    planner: {
      mode: "delegated",
      agentId: "cli-manager",
    },
    routing: {
      defaultAgentId: "cli-worker",
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

function createDelegatedRegistry(): AdapterRegistry {
  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.register(
    new DelegationAdapter("cli-manager", {
      agentId: "cli-manager",
      supportsNonInteractive: true,
      supportsStructuredOutput: true,
      supportsCwd: true,
      supportsAutoApproveFlags: false,
      supportsStreaming: true,
      supportsActionPlanning: true,
      supportsResume: false,
      supportedCapabilities: ["planning", "delegation"],
      defaultProfileId: "default",
    }),
  );
  adapterRegistry.register(
    new DelegationAdapter("cli-worker", {
      agentId: "cli-worker",
      supportsNonInteractive: true,
      supportsStructuredOutput: true,
      supportsCwd: true,
      supportsAutoApproveFlags: false,
      supportsStreaming: true,
      supportsActionPlanning: true,
      supportsResume: false,
      supportedCapabilities: ["planning"],
      defaultProfileId: "default",
    }),
  );
  return adapterRegistry;
}

test("delegated manager task appends worker tasks and dispatches to worker agent", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-delegated-manager-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "delegated", "utf8");

  const config = createDelegatedConfig(workspaceDir);
  const adapterRegistry = createDelegatedRegistry();

  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry,
    eventStore,
    executionRuntime: buildExecutionRuntime(eventStore),
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

  const started = (await app.entrypoint.handle([
    "run",
    "Ship",
    "delegated",
    "manager",
  ])) as RunRecord;
  assert.equal(started.status, "ready");
  assert.equal(started.metadata["plannerMode"], "delegated");
  assert.deepEqual(started.metadata["agentIds"], ["cli-manager", "cli-worker"]);

  const initialGraph = await app.dependencies.runStore.getGraph(started.runId);
  assert.equal(initialGraph ? Object.keys(initialGraph.tasks).length : 0, 1);
  const initialManagerTask = initialGraph ? Object.values(initialGraph.tasks)[0] : undefined;
  assert.equal(initialManagerTask?.kind, "plan");
  assert.equal(initialManagerTask?.preferredAgent, "cli-manager");
  const managerSession = await app.dependencies.sessionStore.getSession(
    started.runId,
    "manager_primary",
  );
  const managerThread = await app.dependencies.sessionStore.getThread(
    started.runId,
    "manager_primary",
  );
  assert.ok(managerSession);
  assert.ok(managerThread);

  const completed = (await app.entrypoint.handle([
    "resume",
    started.runId,
  ])) as RunRecord;
  assert.equal(completed.status, "completed");

  const inspection = (await app.entrypoint.handle([
    "inspect",
    started.runId,
  ])) as RunInspection;
  const tasks = Object.values(inspection.graph.tasks);
  assert.ok(tasks.length >= 2);

  const managerTask = tasks.find(
    (candidate) =>
      candidate.kind === "plan" &&
      candidate.requiredCapabilities.includes("delegation"),
  );
  const workerTasks = tasks.filter(
    (candidate) => candidate.id !== managerTask?.id && candidate.assignedAgent === "cli-worker",
  );

  assert.ok(managerTask);
  assert.ok(workerTasks.length > 0);
  assert.equal(managerTask?.assignedAgent, "cli-manager");
  assert.ok(workerTasks.some((workerTask) => workerTask.status === "completed"));
  assert.ok(
    workerTasks.some((workerTask) => workerTask.dependsOn.includes(managerTask?.id ?? "")),
  );
  assert.ok(
    workerTasks.some((workerTask) =>
      workerTask.instructions.some((instruction) =>
        instruction.includes("Expected artifacts (exact target paths):"),
      ),
    ),
  );
  assert.ok(inspection.events.some((event) => event.type === "replan_applied"));
  const managerMessages = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  assert.ok(
    managerMessages.some(
      (message) => message.role === "worker" && message.body.includes("completed"),
    ),
  );
});

test("delegated manager aligns delegated worker cwd with expected artifact directory", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-delegated-manager-cwd-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "delegated-cwd", "utf8");

  const config = createDelegatedConfig(workspaceDir);
  const adapterRegistry = createDelegatedRegistry();
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry,
    eventStore,
    executionRuntime: buildExecutionRuntime(eventStore, {
      managerDelegatedTasks: [
        {
          title: "Worker writes artifact to target folder",
          goal: "Write artifact in expected folder.",
          preferredAgent: "cli-worker",
          requiredCapabilities: ["planning"],
          instructions: ["Write exactly where expectedArtifacts points."],
          expectedArtifacts: ["test01/tetris/index.html"],
          acceptanceCriteria: ["Artifact is created in the expected folder."],
        },
      ],
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

  const started = (await app.entrypoint.handle([
    "run",
    "Verify delegated worker cwd",
  ])) as RunRecord;
  const completed = (await app.entrypoint.handle([
    "resume",
    started.runId,
  ])) as RunRecord;
  assert.equal(completed.status, "completed");

  const inspection = (await app.entrypoint.handle([
    "inspect",
    started.runId,
  ])) as RunInspection;
  const managerTask = Object.values(inspection.graph.tasks).find(
    (candidate) =>
      candidate.kind === "plan" &&
      candidate.requiredCapabilities.includes("delegation"),
  );
  const workerTask = Object.values(inspection.graph.tasks).find(
    (candidate) => candidate.id !== managerTask?.id,
  );

  assert.ok(workerTask);
  assert.equal(workerTask?.workingDirectory, path.join(workspaceDir, "test01", "tetris"));
});

test("delegated manager resolves delegated dependsOn references by task title", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-delegated-manager-deps-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "delegated-deps", "utf8");

  const config = createDelegatedConfig(workspaceDir);
  const adapterRegistry = createDelegatedRegistry();
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry,
    eventStore,
    executionRuntime: buildExecutionRuntime(eventStore, {
      managerDelegatedTasks: [
        {
          title: "Implement game loop",
          goal: "Build the delegated gameplay implementation.",
          preferredAgent: "cli-worker",
          requiredCapabilities: ["planning"],
          instructions: ["Implement the delegated game logic."],
          expectedArtifacts: ["test01/script.js"],
          acceptanceCriteria: ["Gameplay implementation is complete."],
        },
        {
          title: "Document controls",
          goal: "Write documentation for the delegated gameplay implementation.",
          preferredAgent: "cli-worker",
          dependsOn: ["Implement game loop"],
          requiredCapabilities: ["planning"],
          instructions: ["Document the implemented controls and usage."],
          expectedArtifacts: ["test01/README.md"],
          acceptanceCriteria: ["Documentation matches the implemented controls."],
        },
      ],
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

  const started = (await app.entrypoint.handle([
    "run",
    "Verify delegated dependency ordering",
  ])) as RunRecord;
  const completed = (await app.entrypoint.handle([
    "resume",
    started.runId,
  ])) as RunRecord;
  assert.equal(completed.status, "completed");

  const inspection = (await app.entrypoint.handle([
    "inspect",
    started.runId,
  ])) as RunInspection;
  const tasks = Object.values(inspection.graph.tasks);
  const managerTask = tasks.find(
    (candidate) =>
      candidate.kind === "plan" &&
      candidate.requiredCapabilities.includes("delegation"),
  );
  const implementationTask = tasks.find(
    (candidate) => candidate.title === "Implement game loop",
  );
  const documentationTask = tasks.find(
    (candidate) => candidate.title === "Document controls",
  );

  assert.ok(managerTask);
  assert.ok(implementationTask);
  assert.ok(documentationTask);
  assert.ok(documentationTask?.dependsOn.includes(managerTask!.id));
  assert.ok(documentationTask?.dependsOn.includes(implementationTask!.id));
  assert.ok(!documentationTask?.dependsOn.includes("Implement game loop"));
  assert.ok(
    inspection.graph.edges.some(
      (edge) =>
        edge.from === implementationTask?.id &&
        edge.to === documentationTask?.id,
    ),
  );
});

test("delegated manager honors workspace allowOutsideWorkspaceWrites when run metadata omits it", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-delegated-manager-outside-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "delegated-outside", "utf8");

  const outsideArtifact = path.join(rootDir, "test01", "tetris", "index.html");
  const config = createDelegatedConfig(workspaceDir);
  config.workspace.allowOutsideWorkspaceWrites = true;
  const adapterRegistry = createDelegatedRegistry();
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry,
    eventStore,
    executionRuntime: buildExecutionRuntime(eventStore, {
      managerDelegatedTasks: [
        {
          title: "Worker writes outside workspace",
          goal: "Write artifact outside workspace root.",
          preferredAgent: "cli-worker",
          requiredCapabilities: ["planning"],
          instructions: ["Write exactly where expectedArtifacts points."],
          expectedArtifacts: [outsideArtifact],
          acceptanceCriteria: ["Artifact is created in outside target folder."],
        },
      ],
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

  const started = (await app.entrypoint.handle([
    "run",
    "Verify delegated outside-workspace cwd",
  ])) as RunRecord;
  const completed = (await app.entrypoint.handle([
    "resume",
    started.runId,
  ])) as RunRecord;
  assert.equal(completed.status, "completed");

  const inspection = (await app.entrypoint.handle([
    "inspect",
    started.runId,
  ])) as RunInspection;
  const managerTask = Object.values(inspection.graph.tasks).find(
    (candidate) =>
      candidate.kind === "plan" &&
      candidate.requiredCapabilities.includes("delegation"),
  );
  const workerTask = Object.values(inspection.graph.tasks).find(
    (candidate) => candidate.id !== managerTask?.id,
  );

  assert.ok(workerTask);
  assert.equal(workerTask?.workingDirectory, path.dirname(outsideArtifact));
});

test("delegated manager keeps dynamic worker metadata for capability-specific tasks", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-delegated-manager-dynamic-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "delegated-dynamic", "utf8");

  const config = createDelegatedConfig(workspaceDir);
  const adapterRegistry = createDelegatedRegistry();
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry,
    eventStore,
    executionRuntime: buildExecutionRuntime(eventStore, {
      managerDelegatedTasks: [
        {
          title: "Frontend implementation",
          goal: "Build the delegated frontend task end-to-end.",
          preferredAgent: "cli-worker",
          requiredCapabilities: ["planning", "frontend", "javascript"],
          instructions: ["Deliver the delegated frontend output."],
          expectedArtifacts: ["Concrete frontend implementation output."],
          acceptanceCriteria: ["Delegated frontend goal is completed."],
        },
      ],
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

  const started = (await app.entrypoint.handle([
    "run",
    "Ship",
    "dynamic",
    "worker",
  ])) as RunRecord;
  const completed = (await app.entrypoint.handle([
    "resume",
    started.runId,
  ])) as RunRecord;
  assert.equal(completed.status, "completed");

  const storedRun = await app.dependencies.runStore.getRun(started.runId);
  assert.ok(storedRun);
  const metadataAgentIds = Array.isArray(storedRun?.metadata.agentIds)
    ? (storedRun?.metadata.agentIds as string[])
    : [];
  assert.ok(
    metadataAgentIds.some((agentId) =>
      agentId.startsWith("cli-worker-worker-planning-frontend-javascript"),
    ),
  );

  const dynamicAgents = Array.isArray(storedRun?.metadata.dynamicAgents)
    ? (storedRun?.metadata.dynamicAgents as Array<Record<string, unknown>>)
    : [];
  assert.ok(dynamicAgents.length > 0);
  assert.ok(
    dynamicAgents.some((agent) => {
      if (typeof agent.id !== "string" || !Array.isArray(agent.profiles)) {
        return false;
      }
      const capabilities = agent.profiles.flatMap((profile) => {
        if (
          typeof profile === "object" &&
          profile !== null &&
          Array.isArray((profile as { capabilities?: unknown[] }).capabilities)
        ) {
          return (profile as { capabilities: string[] }).capabilities;
        }
        return [];
      });
      return (
        agent.id.startsWith("cli-worker-worker-planning-frontend-javascript") &&
        capabilities.includes("frontend") &&
        capabilities.includes("javascript")
      );
    }),
  );
});

test("delegated manager failure still dispatches fallback worker task", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-delegated-manager-fail-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "delegated-fail", "utf8");

  const config = createDelegatedConfig(workspaceDir);
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry: createDelegatedRegistry(),
    eventStore,
    executionRuntime: buildExecutionRuntime(eventStore, {
      managerShouldFail: true,
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

  const started = (await app.entrypoint.handle([
    "run",
    "Ship",
    "delegated",
    "manager",
    "fallback",
  ])) as RunRecord;
  const completed = (await app.entrypoint.handle([
    "resume",
    started.runId,
  ])) as RunRecord;
  assert.equal(completed.status, "completed");

  const inspection = (await app.entrypoint.handle([
    "inspect",
    started.runId,
  ])) as RunInspection;
  const managerTask = Object.values(inspection.graph.tasks).find(
    (candidate) =>
      candidate.kind === "plan" &&
      candidate.requiredCapabilities.includes("delegation"),
  );
  const workerTask = Object.values(inspection.graph.tasks).find(
    (candidate) => candidate.id !== managerTask?.id,
  );

  assert.ok(managerTask);
  assert.ok(workerTask);
  assert.equal(managerTask?.status, "completed");
  assert.equal(workerTask?.status, "completed");
  assert.equal(workerTask?.assignedAgent, "cli-worker");
  assert.equal(workerTask?.timeoutMs, 900_000);
  assert.ok(
    inspection.events.some(
      (event) => event.type === "task_failed" && event.taskId === managerTask?.id,
    ),
  );
});

test("delegated manager no_more_tasks writes manager reply and converges without worker dispatch", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-delegated-manager-no-more-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "delegated-no-more", "utf8");

  const config = createDelegatedConfig(workspaceDir);
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry: createDelegatedRegistry(),
    eventStore,
    executionRuntime: buildExecutionRuntime(eventStore, {
      managerNoMoreTasks: true,
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

  const started = (await app.entrypoint.handle([
    "run",
    "No more delegated tasks",
  ])) as RunRecord;
  const completed = (await app.entrypoint.handle([
    "resume",
    started.runId,
  ])) as RunRecord;
  assert.equal(completed.status, "completed");

  const inspection = (await app.entrypoint.handle([
    "inspect",
    started.runId,
  ])) as RunInspection;
  const tasks = Object.values(inspection.graph.tasks);
  assert.equal(tasks.length, 1);
  const managerMessages = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  assert.ok(
    managerMessages.some(
      (message) =>
        message.role === "manager" &&
        message.body.includes("No additional delegated work is required."),
    ),
  );
});

test("selectedCli equal planner manager still boots delegated manager task", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-delegated-manager-cli-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "delegated-selected-cli", "utf8");

  const config = createDelegatedConfig(workspaceDir);
  const app = createApp({
    stateRootDir,
    planner: {
      async createInitialPlan() {
        throw new Error("delegated bootstrap should not use static planner");
      },
      async replan() {
        return {
          operation: "append_tasks" as const,
          reason: "not used",
          tasks: [],
        };
      },
    },
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

  const started = await app.runCoordinator.startRun({
    goal: "delegated cli aware boot",
    workspacePath: workspaceDir,
    metadata: {
      configVersion: 1,
      plannerMode: "delegated",
      plannerAgentId: "cli-manager",
      agentIds: ["cli-manager", "cli-worker"],
      selectedCli: "cli-manager",
    },
  });

  const graph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(graph);
  const bootTask = graph ? Object.values(graph.tasks)[0] : undefined;
  assert.equal(bootTask?.kind, "plan");
  assert.ok(bootTask?.requiredCapabilities.includes("delegation"));
});
