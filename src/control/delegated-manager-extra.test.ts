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

import { buildExecutionRuntime, createDelegatedConfig, createDelegatedRegistry } from "./delegated-manager.test-helpers.js";

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
