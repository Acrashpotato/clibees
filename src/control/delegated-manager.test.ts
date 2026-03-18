import test from "node:test";
import "./delegated-manager-extra.test.js";
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

import { buildExecutionRuntime, createDelegatedConfig, createDelegatedRegistry } from "./delegated-manager.test-helpers.js";

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

test("delegated manager keeps worker cwd inside workspace even when outside writes are allowed", async () => {
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
  assert.equal(workerTask?.workingDirectory, workspaceDir);
});
