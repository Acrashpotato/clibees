import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { MultiAgentConfig } from "../domain/config.js";
import type { RunInspection, RunRecord } from "../domain/models.js";
import { createApp } from "../app/create-app.js";
import { FileEventStore } from "../storage/event-store.js";
import {
  buildExecutionRuntime,
  createDelegatedConfig,
  createDelegatedRegistry,
} from "./delegated-manager.test-helpers.js";
import {
  buildWorkerTask,
  setupStaleRunningRun,
} from "./delegated-manager-extra.helpers.js";

test("worker completion report skips manager coordination when runnable non-manager tasks already exist", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-worker-complete-gate-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "worker-complete-gate", "utf8");

  const config = createDelegatedConfig(workspaceDir);
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry: createDelegatedRegistry(),
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

  const started = (await app.entrypoint.handle(["run", "worker completion gate"])) as RunRecord;
  const seedRun = await app.dependencies.runStore.getRun(started.runId);
  const seedGraph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(seedRun);
  assert.ok(seedGraph);
  const managerTask = Object.values(seedGraph!.tasks).find(
    (task) =>
      task.kind === "plan" &&
      task.requiredCapabilities.includes("delegation"),
  );
  assert.ok(managerTask);
  const completedWorkerTask = buildWorkerTask(
    workspaceDir,
    "task-worker-complete",
    "completed",
    [managerTask!.id],
    {
      title: "Completed branch",
      goal: "Completed branch output.",
      expectedArtifacts: ["branch-a.txt"],
    },
  );
  const readyWorkerTask = buildWorkerTask(
    workspaceDir,
    "task-worker-ready",
    "ready",
    [managerTask!.id],
    {
      title: "Ready branch",
      goal: "Ready branch output.",
      expectedArtifacts: ["branch-b.txt"],
    },
  );
  const graphWithRunnableBranch = {
    ...seedGraph!,
    tasks: {
      ...seedGraph!.tasks,
      [completedWorkerTask.id]: completedWorkerTask,
      [readyWorkerTask.id]: readyWorkerTask,
    },
    readyQueue: [...new Set([...seedGraph!.readyQueue, readyWorkerTask.id])],
  };
  await app.dependencies.runStore.saveGraph(started.runId, graphWithRunnableBranch);

  const coordinatorAny = app.runCoordinator as any;
  const runConfig = coordinatorAny.resolveRunExecutionConfig(seedRun, config);
  const services = coordinatorAny.resolveExecutionServices(seedRun, runConfig);
  const beforeTaskCount = Object.keys(graphWithRunnableBranch.tasks).length;
  await coordinatorAny.reportWorkerCompletionToManager(
    seedRun,
    graphWithRunnableBranch,
    completedWorkerTask,
    services,
  );

  const latestGraph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(latestGraph);
  assert.equal(Object.keys(latestGraph!.tasks).length, beforeTaskCount);
  const coordinationTasks = Object.values(latestGraph!.tasks).filter(
    (task) => task.title === "Manager coordination",
  );
  assert.equal(coordinationTasks.length, 0);

  const managerMessages = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  assert.ok(
    managerMessages.some(
      (message) =>
        message.role === "worker" &&
        message.metadata?.source === "worker_completion" &&
        message.metadata?.taskId === completedWorkerTask.id,
    ),
  );
});

test("inspect auto-pauses stalled running run and records orchestrator interruption note", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-run-health-inspect-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "run-health-inspect", "utf8");

  const config = createDelegatedConfig(workspaceDir);
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry: createDelegatedRegistry(),
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

  const started = (await app.entrypoint.handle(["run", "run health inspect"])) as RunRecord;
  await setupStaleRunningRun({
    app,
    runId: started.runId,
    workspaceDir,
    eventStore,
  });

  const inspection = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspection.run.status, "paused");
  const latestRun = await app.dependencies.runStore.getRun(started.runId);
  assert.equal(latestRun?.status, "paused");
  const managerMessages = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  const interruptionMessage = managerMessages.find(
    (message) =>
      message.role === "system" &&
      message.metadata?.source === "health_check" &&
      message.metadata?.trigger === "inspect",
  );
  assert.ok(interruptionMessage);
  assert.match(interruptionMessage?.body ?? "", /orchestrator interruption/i);
});

test("resume auto-pauses stalled running run before scheduling", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-run-health-resume-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "run-health-resume", "utf8");

  const config = createDelegatedConfig(workspaceDir);
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry: createDelegatedRegistry(),
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

  const started = (await app.entrypoint.handle(["run", "run health resume"])) as RunRecord;
  await setupStaleRunningRun({
    app,
    runId: started.runId,
    workspaceDir,
    eventStore,
  });

  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "paused");
  const latestRun = await app.dependencies.runStore.getRun(started.runId);
  assert.equal(latestRun?.status, "paused");
  const managerMessages = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  assert.ok(
    managerMessages.some(
      (message) =>
        message.role === "system" &&
        message.metadata?.source === "health_check" &&
        message.metadata?.trigger === "resume",
    ),
  );
});

test("postThreadMessage auto-pauses stalled running run before appending user message", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-run-health-post-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "run-health-post", "utf8");

  const config = createDelegatedConfig(workspaceDir);
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry: createDelegatedRegistry(),
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

  const started = (await app.entrypoint.handle(["run", "run health post"])) as RunRecord;
  await setupStaleRunningRun({
    app,
    runId: started.runId,
    workspaceDir,
    eventStore,
  });
  const runBeforePost = await app.dependencies.runStore.getRun(started.runId);
  assert.equal(runBeforePost?.status, "running");

  const now = new Date().toISOString();
  await app.dependencies.sessionStore.upsertThread({
    schemaVersion: 1,
    threadId: "task-thread-health-check",
    runId: started.runId,
    scope: "task_session",
    createdAt: now,
    updatedAt: now,
    metadata: {
      owner: "test",
    },
  });
  const posted = await app.runCoordinator.postThreadMessage(
    started.runId,
    "task-thread-health-check",
    {
      actorId: "console-user",
      body: "health check trigger",
      clientRequestId: "health-check-post-thread",
    },
  );
  assert.equal(posted.run.status, "paused");
  assert.equal(posted.resumed, false);
  const latestRun = await app.dependencies.runStore.getRun(started.runId);
  assert.equal(latestRun?.status, "paused");
  const managerMessages = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  assert.ok(
    managerMessages.some(
      (message) =>
        message.role === "system" &&
        message.metadata?.source === "health_check" &&
        message.metadata?.trigger === "postThreadMessage",
    ),
  );
});

