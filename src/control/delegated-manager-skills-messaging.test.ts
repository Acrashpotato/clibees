import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { MultiAgentConfig } from "../domain/config.js";
import type { RunRecord } from "../domain/models.js";
import { createApp } from "../app/create-app.js";
import { FileEventStore } from "../storage/event-store.js";
import { MAX_MANAGER_COORDINATION_TASKS } from "./run-coordinator/core.js";
import {
  buildExecutionRuntime,
  createDelegatedConfig,
  createDelegatedRegistry,
} from "./delegated-manager.test-helpers.js";
import {
  buildActiveManagerCoordinationTask,
  buildRunningWorkerTask,
} from "./delegated-manager-skills.helpers.js";

test("running manager-thread user message appends follow-up coordination and keeps worker running state", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-manager-running-followup-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "manager-running-followup", "utf8");

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

  const started = (await app.entrypoint.handle(["run", "running followup"])) as RunRecord;
  const managerSession = await app.runCoordinator.ensureManagerSession(started.runId);
  const seedGraph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(seedGraph);
  const initialManagerTask = seedGraph
    ? Object.values(seedGraph.tasks).find(
        (task) =>
          task.kind === "plan" &&
          task.requiredCapabilities.includes("delegation"),
      )
    : undefined;
  assert.ok(initialManagerTask);
  const runningWorkerTask = buildRunningWorkerTask(workspaceDir, "task-running-worker");
  await app.dependencies.runStore.saveGraph(started.runId, {
    ...seedGraph!,
    tasks: {
      ...seedGraph!.tasks,
      [runningWorkerTask.id]: runningWorkerTask,
    },
    readyQueue: [...new Set([...seedGraph!.readyQueue, initialManagerTask!.id])],
  });
  await app.dependencies.runStore.updateRun({
    ...started,
    status: "running",
    currentTaskId: runningWorkerTask.id,
    updatedAt: new Date().toISOString(),
  });

  const postResult = await app.runCoordinator.postThreadMessage(
    started.runId,
    managerSession.thread.threadId,
    {
      actorId: "console-user",
      body: "Please queue this manager update after current in-flight coordination.",
      clientRequestId: "running-followup-message",
    },
  );
  assert.equal(postResult.resumed, false);

  const afterGraph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(afterGraph);
  assert.equal(afterGraph?.tasks[runningWorkerTask.id]?.status, "running");
  const triggeredCoordinationTask = afterGraph
    ? Object.values(afterGraph.tasks).find(
        (task) => task.metadata?.triggerMessageId === postResult.message.messageId,
      )
    : undefined;
  assert.ok(triggeredCoordinationTask);
  assert.equal(triggeredCoordinationTask?.title, "Manager coordination");
  assert.ok(
    triggeredCoordinationTask?.dependsOn.includes(initialManagerTask!.id),
  );

  const managerMessages = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  assert.ok(
    managerMessages.some(
      (message) =>
        message.role === "manager" &&
        message.metadata?.source === "manager_ack" &&
        message.metadata?.triggerMessageId === postResult.message.messageId,
    ),
  );
});

test("running manager-thread progress query responds with status and does not enqueue coordination", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-manager-running-progress-only-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "manager-running-progress-only", "utf8");

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

  const started = (await app.entrypoint.handle(["run", "progress only"])) as RunRecord;
  const managerSession = await app.runCoordinator.ensureManagerSession(started.runId);
  const seedGraph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(seedGraph);
  const runningWorkerTask = buildRunningWorkerTask(workspaceDir, "task-running-progress-worker");
  await app.dependencies.runStore.saveGraph(started.runId, {
    ...seedGraph!,
    tasks: {
      ...seedGraph!.tasks,
      [runningWorkerTask.id]: runningWorkerTask,
    },
    readyQueue: seedGraph!.readyQueue.filter((taskId) => taskId !== runningWorkerTask.id),
  });
  await app.dependencies.runStore.updateRun({
    ...started,
    status: "running",
    currentTaskId: runningWorkerTask.id,
    updatedAt: new Date().toISOString(),
  });

  const postResult = await app.runCoordinator.postThreadMessage(
    started.runId,
    managerSession.thread.threadId,
    {
      actorId: "console-user",
      body: "任务情况如何？",
      clientRequestId: "running-progress-only",
    },
  );
  assert.equal(postResult.resumed, false);

  const afterGraph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(afterGraph);
  assert.equal(afterGraph?.tasks[runningWorkerTask.id]?.status, "running");
  const triggeredCoordinationTask = afterGraph
    ? Object.values(afterGraph.tasks).find(
        (task) => task.metadata?.triggerMessageId === postResult.message.messageId,
      )
    : undefined;
  assert.equal(triggeredCoordinationTask, undefined);

  const managerMessages = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  const progressReply = managerMessages.find(
    (message) =>
      message.role === "manager" &&
      message.metadata?.source === "manager_progress" &&
      message.metadata?.triggerMessageId === postResult.message.messageId,
  );
  assert.ok(progressReply);
  assert.equal(progressReply?.metadata?.intent, "progress_query");
});

test("running manager-thread replan request remains idempotent for repeated client request id", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-manager-running-idempotent-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "manager-running-idempotent", "utf8");

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

  const started = (await app.entrypoint.handle(["run", "idempotent message"])) as RunRecord;
  const managerSession = await app.runCoordinator.ensureManagerSession(started.runId);
  await app.dependencies.runStore.updateRun({
    ...started,
    status: "running",
    updatedAt: new Date().toISOString(),
  });

  const first = await app.runCoordinator.postThreadMessage(
    started.runId,
    managerSession.thread.threadId,
    {
      actorId: "console-user",
      body: "Please redo this and queue exactly one new delegated task.",
      clientRequestId: "idempotent-running-message",
    },
  );
  const second = await app.runCoordinator.postThreadMessage(
    started.runId,
    managerSession.thread.threadId,
    {
      actorId: "console-user",
      body: "Please redo this and queue exactly one new delegated task.",
      clientRequestId: "idempotent-running-message",
    },
  );
  assert.equal(first.message.messageId, second.message.messageId);
  assert.equal(second.resumed, false);

  const latestGraph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(latestGraph);
  const triggeredCoordinationTasks = latestGraph
    ? Object.values(latestGraph.tasks).filter(
        (task) => task.metadata?.triggerMessageId === first.message.messageId,
      )
    : [];
  assert.equal(triggeredCoordinationTasks.length, 1);

  const managerMessages = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  const ackMessages = managerMessages.filter(
    (message) =>
      message.role === "manager" &&
      message.metadata?.source === "manager_ack" &&
      message.metadata?.triggerMessageId === first.message.messageId,
  );
  assert.equal(ackMessages.length, 1);
});

test("running manager-thread repeated progress queries do not append duplicate coordination tasks", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-manager-running-progress-repeat-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "manager-running-progress-repeat", "utf8");

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

  const started = (await app.entrypoint.handle(["run", "progress repeat"])) as RunRecord;
  const managerSession = await app.runCoordinator.ensureManagerSession(started.runId);
  const seedGraph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(seedGraph);
  const runningWorkerTask = buildRunningWorkerTask(workspaceDir, "task-running-progress-repeat-worker");
  await app.dependencies.runStore.saveGraph(started.runId, {
    ...seedGraph!,
    tasks: {
      ...seedGraph!.tasks,
      [runningWorkerTask.id]: runningWorkerTask,
    },
    readyQueue: seedGraph!.readyQueue.filter((taskId) => taskId !== runningWorkerTask.id),
  });
  await app.dependencies.runStore.updateRun({
    ...started,
    status: "running",
    currentTaskId: runningWorkerTask.id,
    updatedAt: new Date().toISOString(),
  });

  const messageIds: string[] = [];
  for (const [index, prompt] of [
    "任务情况如何？",
    "进展怎么样了？",
    "为什么不回复进度？",
  ].entries()) {
    const postResult = await app.runCoordinator.postThreadMessage(
      started.runId,
      managerSession.thread.threadId,
      {
        actorId: "console-user",
        body: prompt,
        clientRequestId: `running-progress-repeat-${index + 1}`,
      },
    );
    messageIds.push(postResult.message.messageId);
  }

  const latestGraph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(latestGraph);
  const triggeredCoordinationTasks = latestGraph
    ? Object.values(latestGraph.tasks).filter((task) => {
        const triggerMessageId = task.metadata?.triggerMessageId;
        return typeof triggerMessageId === "string" && messageIds.includes(triggerMessageId);
      })
    : [];
  assert.equal(triggeredCoordinationTasks.length, 0);

  const managerMessages = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  const progressMessages = managerMessages.filter(
    (message) =>
      message.role === "manager" &&
      message.metadata?.source === "manager_progress" &&
      typeof message.metadata?.triggerMessageId === "string" &&
      messageIds.includes(message.metadata.triggerMessageId),
  );
  assert.equal(progressMessages.length, 3);
});

test("running manager-thread user message returns manager ack when coordination queue is saturated", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-manager-running-saturated-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "manager-running-saturated", "utf8");

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

  const started = (await app.entrypoint.handle(["run", "saturated queue"])) as RunRecord;
  const managerSession = await app.runCoordinator.ensureManagerSession(started.runId);
  const seedGraph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(seedGraph);
  const initialManagerTask = seedGraph
    ? Object.values(seedGraph.tasks).find(
        (task) =>
          task.kind === "plan" &&
          task.requiredCapabilities.includes("delegation"),
      )
    : undefined;
  assert.ok(initialManagerTask);

  const saturatedTasks = Array.from({ length: MAX_MANAGER_COORDINATION_TASKS }).map(
    (_, index) =>
      buildActiveManagerCoordinationTask(
        workspaceDir,
        `task-saturated-manager-${index + 1}`,
        [initialManagerTask!.id],
      ),
  );
  await app.dependencies.runStore.saveGraph(started.runId, {
    ...seedGraph!,
    tasks: {
      ...seedGraph!.tasks,
      ...Object.fromEntries(saturatedTasks.map((task) => [task.id, task])),
    },
    readyQueue: [
      ...new Set([
        ...seedGraph!.readyQueue,
        ...saturatedTasks.map((task) => task.id),
      ]),
    ],
  });
  await app.dependencies.runStore.updateRun({
    ...started,
    status: "running",
    updatedAt: new Date().toISOString(),
  });

  const postResult = await app.runCoordinator.postThreadMessage(
    started.runId,
    managerSession.thread.threadId,
    {
      actorId: "console-user",
      body: "Queue one more manager coordination even if busy.",
      clientRequestId: "saturated-manager-message",
    },
  );
  assert.equal(postResult.resumed, false);

  const afterGraph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(afterGraph);
  const triggeredCoordinationTask = afterGraph
    ? Object.values(afterGraph.tasks).find(
        (task) => task.metadata?.triggerMessageId === postResult.message.messageId,
      )
    : undefined;
  assert.equal(triggeredCoordinationTask, undefined);

  const managerMessages = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  const ackMessage = managerMessages.find(
    (message) =>
      message.role === "manager" &&
      message.metadata?.source === "manager_ack" &&
      message.metadata?.triggerMessageId === postResult.message.messageId,
  );
  assert.ok(ackMessage);
  assert.match(ackMessage?.body ?? "", /currently saturated/i);
});


