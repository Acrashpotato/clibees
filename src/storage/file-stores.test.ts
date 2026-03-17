import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileEventStore } from "./event-store.js";
import { FileRunStore } from "./run-store.js";
import { FileSessionStore } from "./session-store.js";
import type {
  MessageThreadRecord,
  RunEvent,
  RunGraph,
  RunRecord,
  TaskSessionRecord,
  TaskSpec,
} from "../domain/models.js";
import { SCHEMA_VERSION } from "../domain/models.js";

const WORKSPACE_PATH = process.cwd().replace(/\\/g, "/");

function buildRunRecord(runId: string): RunRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    goal: "Ship phase 2",
    status: "ready",
    workspacePath: WORKSPACE_PATH,
    createdAt: "2026-03-11T10:00:00.000Z",
    updatedAt: "2026-03-11T10:00:00.000Z",
    metadata: {},
  };
}

function buildTask(taskId: string, dependsOn: string[] = []): TaskSpec {
  return {
    id: taskId,
    title: taskId,
    kind: "execute",
    goal: `Goal for ${taskId}`,
    instructions: [],
    inputs: [],
    dependsOn,
    requiredCapabilities: [],
    workingDirectory: ".",
    expectedArtifacts: [],
    acceptanceCriteria: [],
    validator: { mode: "none" },
    riskLevel: "low",
    allowedActions: [],
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: [],
    },
    status: dependsOn.length === 0 ? "ready" : "pending",
  };
}

function buildGraph(runId: string): RunGraph {
  const taskA = buildTask("task-a");
  const taskB = buildTask("task-b", ["task-a"]);

  return {
    runId,
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    tasks: {
      [taskA.id]: taskA,
      [taskB.id]: taskB,
    },
    edges: [{ from: "task-a", to: "task-b" }],
    readyQueue: ["task-a"],
    completedTaskIds: [],
    failedTaskIds: [],
    cancelledTaskIds: [],
    metadata: {},
  };
}

function buildEvent(
  runId: string,
  id: string,
  type: RunEvent["type"],
  timestamp: string,
  taskId?: string,
): RunEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    type,
    runId,
    taskId,
    timestamp,
    payload: taskId ? { taskId } : {},
  };
}

test("FileRunStore persists runs, graphs, and task records", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clibees-run-store-"));
  const store = new FileRunStore(tempDir);
  const run = buildRunRecord("run-001");
  const graph = buildGraph(run.runId);

  await store.createRun(run);
  await store.saveGraph(run.runId, graph);
  await store.updateTaskStatus(run.runId, "task-a", { status: "routing" });
  await store.updateTaskStatus(run.runId, "task-a", { status: "context_building" });
  await store.updateTaskStatus(run.runId, "task-a", { status: "queued" });
  const updatedTask = await store.updateTaskStatus(run.runId, "task-a", {
    status: "running",
    attempts: 1,
    startedAt: "2026-03-11T10:01:00.000Z",
  });
  await store.updateRun({
    ...run,
    currentTaskId: "task-a",
    updatedAt: "2026-03-11T10:01:00.000Z",
  });

  const savedRun = await store.getRun(run.runId);
  const savedGraph = await store.getGraph(run.runId);
  const taskRecord = await store.getTaskRecord(run.runId, "task-a");

  assert.deepEqual(savedRun?.currentTaskId, "task-a");
  assert.equal(savedGraph?.tasks["task-a"].status, "running");
  assert.equal(updatedTask.status, "running");
  assert.equal(taskRecord?.status, updatedTask.status);
  assert.equal(taskRecord?.schemaVersion, updatedTask.schemaVersion);
  assert.equal(taskRecord?.attempts, 1);
  assert.equal(taskRecord?.startedAt, "2026-03-11T10:01:00.000Z");
});

test("FileRunStore tolerates empty directories and fails clearly on corrupt JSON", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clibees-run-empty-"));
  const store = new FileRunStore(tempDir);

  assert.equal(await store.getRun("missing-run"), null);
  assert.equal(await store.getGraph("missing-run"), null);
  assert.equal(await store.getTaskRecord("missing-run", "missing-task"), null);

  const brokenRunFile = path.join(tempDir, "runs", "broken-run", "run.json");
  await mkdir(path.dirname(brokenRunFile), { recursive: true });
  await writeFile(brokenRunFile, "{not-json}", "utf8");

  await assert.rejects(
    () => store.getRun("broken-run"),
    /Failed to read run "broken-run"/,
  );
});

test("FileEventStore appends, filters, and derives recovery state", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clibees-event-store-"));
  const store = new FileEventStore(tempDir);
  const runId = "run-evt-001";

  await store.append(
    buildEvent(runId, "evt-1", "task_queued", "2026-03-11T10:00:00.000Z", "task-a"),
  );
  await store.append(
    buildEvent(runId, "evt-2", "task_started", "2026-03-11T10:00:01.000Z", "task-a"),
  );
  await store.append(
    buildEvent(
      runId,
      "evt-3",
      "approval_requested",
      "2026-03-11T10:00:02.000Z",
      "task-a",
    ),
  );

  const events = await store.list(runId);
  const filtered = await store.list(runId, { taskId: "task-a", types: ["task_started"] });
  const recovery = await store.getLastConsistentState(runId);

  assert.equal(events.length, 3);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "evt-2");
  assert.equal(recovery?.lastEventId, "evt-3");
  assert.equal(recovery?.activeTaskId, "task-a");
  assert.equal(recovery?.waitingApprovalTaskId, "task-a");
  assert.equal(recovery?.taskCheckpoints["task-a"].lastEventType, "approval_requested");
});

test("FileEventStore tolerates empty directories and fails clearly on corrupt JSONL", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clibees-event-empty-"));
  const store = new FileEventStore(tempDir);
  const eventsFile = path.join(tempDir, "runs", "broken-run", "events.jsonl");

  assert.deepEqual(await store.list("missing-run"), []);
  assert.equal(await store.last("missing-run"), null);
  assert.equal(await store.getLastConsistentState("missing-run"), null);

  await mkdir(path.dirname(eventsFile), { recursive: true });
  await writeFile(eventsFile, "{\"id\":\"ok\"}\nnot-json\n", "utf8");

  await assert.rejects(
    () => store.list("broken-run"),
    /Failed to parse events for run "broken-run" at line 2/,
  );
});

test("FileSessionStore persists sessions, threads, and deduplicates by clientRequestId", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clibees-session-store-"));
  const store = new FileSessionStore(tempDir);
  const runId = "run-session-001";
  const sessionId = "manager_primary";
  const threadId = "manager_primary";

  const session: TaskSessionRecord = {
    schemaVersion: SCHEMA_VERSION,
    sessionId,
    runId,
    scope: "manager_primary",
    role: "manager",
    threadId,
    createdAt: "2026-03-16T10:00:00.000Z",
    updatedAt: "2026-03-16T10:00:00.000Z",
    metadata: {},
  };
  const thread: MessageThreadRecord = {
    schemaVersion: SCHEMA_VERSION,
    threadId,
    runId,
    scope: "manager_primary",
    sessionId,
    createdAt: "2026-03-16T10:00:00.000Z",
    updatedAt: "2026-03-16T10:00:00.000Z",
    metadata: {},
  };

  await store.upsertSession(session);
  await store.upsertThread(thread);
  const first = await store.appendMessage({
    runId,
    threadId,
    sessionId,
    role: "user",
    actorId: "console-user",
    body: "hello manager",
    clientRequestId: "request-001",
  });
  const duplicate = await store.appendMessage({
    runId,
    threadId,
    sessionId,
    role: "user",
    actorId: "console-user",
    body: "hello manager",
    clientRequestId: "request-001",
  });
  await store.appendMessage({
    runId,
    threadId,
    sessionId,
    role: "manager",
    actorId: "manager",
    body: "ack",
    clientRequestId: "request-002",
  });

  const sessions = await store.listSessions(runId);
  const threads = await store.listThreads(runId);
  const messages = await store.listMessages(runId, threadId);
  const runMessages = await store.listRunMessages(runId);

  assert.equal(first.messageId, duplicate.messageId);
  assert.equal(sessions.length, 1);
  assert.equal(threads.length, 1);
  assert.equal(messages.length, 2);
  assert.equal(runMessages.length, 2);
});
