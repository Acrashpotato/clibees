import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { InvocationPlan, RunEvent, TaskSpec } from "../domain/models.js";
import { ProcessExecutionRuntime } from "./execution-runtime.js";
import { FileEventStore } from "../storage/event-store.js";

function buildTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "task-phase5",
    title: "Phase 5 task",
    kind: "execute",
    goal: "Exercise the execution runtime",
    instructions: ["Run the planned command"],
    inputs: [],
    dependsOn: [],
    requiredCapabilities: ["planning"],
    workingDirectory: process.cwd(),
    expectedArtifacts: [],
    acceptanceCriteria: ["Runtime emits lifecycle events"],
    validator: { mode: "none" },
    riskLevel: "low",
    allowedActions: [],
    timeoutMs: 100,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: [],
    },
    status: "queued",
    ...overrides,
  };
}

function buildInvocation(overrides: Partial<InvocationPlan> = {}): InvocationPlan {
  return {
    taskId: "task-phase5",
    agentId: "node-agent",
    command: "node",
    args: ["-e", "process.stdout.write('ok\\n')"],
    cwd: process.cwd(),
    actionPlans: [],
    ...overrides,
  };
}

function createFakeChildProcess(
  onStart: (child: ChildProcess & { stdout: PassThrough; stderr: PassThrough }) => void,
): typeof import("node:child_process").spawn {
  return (() => {
    const child = new EventEmitter() as ChildProcess & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: (signal?: NodeJS.Signals | number) => boolean;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      killed: boolean;
    };

    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.killed = false;
    child.kill = (signal?: NodeJS.Signals | number) => {
      child.killed = true;
      child.signalCode =
        typeof signal === "string" ? signal : "SIGTERM";
      queueMicrotask(() => child.emit("close", null, child.signalCode));
      return true;
    };

    queueMicrotask(() => onStart(child));
    return child;
  }) as typeof import("node:child_process").spawn;
}

test("ProcessExecutionRuntime streams cleaned messages and persists transcript plus events", async () => {
  const stateRootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase5-success-"));
  const eventStore = new FileEventStore(stateRootDir);
  const runtime = new ProcessExecutionRuntime({
    eventStore,
    stateRootDir,
    spawnProcess: createFakeChildProcess((child) => {
      child.stdout.write("\u001b[31mRED\u001b[0m\n");
      child.stderr.write("\u001b[33mWARN\u001b[0m\n");
      Object.defineProperty(child, "exitCode", {
        value: 0,
        writable: true,
        configurable: true,
      });
      child.emit("close", 0, null);
    }),
  });

  const events: RunEvent[] = [];
  for await (const event of runtime.execute(
    "run-phase5-success",
    buildTask(),
    buildInvocation(),
  )) {
    events.push(event);
  }

  assert.deepEqual(
    events.map((event) => event.type),
    ["task_started", "agent_message", "agent_message", "task_completed"],
  );
  assert.equal(events[1]?.payload["message"], "RED\n");
  assert.equal(events[2]?.payload["message"], "WARN\n");

  const persistedEvents = await eventStore.list("run-phase5-success");
  assert.deepEqual(
    persistedEvents.map((event) => event.type),
    ["task_started", "agent_message", "agent_message", "task_completed"],
  );

  const transcriptPath = String(events[0]?.payload["transcriptPath"]);
  const transcriptContent = await readFile(transcriptPath, "utf8");
  assert.match(transcriptContent, /\\u001b\[31mRED\\u001b\[0m/);
  assert.match(transcriptContent, /"stream":"stderr"/);
});

test("ProcessExecutionRuntime emits failed event for non-zero exits", async () => {
  const stateRootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase5-fail-"));
  const eventStore = new FileEventStore(stateRootDir);
  const runtime = new ProcessExecutionRuntime({
    eventStore,
    stateRootDir,
    spawnProcess: createFakeChildProcess((child) => {
      child.stderr.write("boom\n");
      Object.defineProperty(child, "exitCode", {
        value: 3,
        writable: true,
        configurable: true,
      });
      child.emit("close", 3, null);
    }),
  });

  const events: RunEvent[] = [];
  for await (const event of runtime.execute(
    "run-phase5-fail",
    buildTask(),
    buildInvocation(),
  )) {
    events.push(event);
  }

  assert.equal(events.at(-1)?.type, "task_failed");
  assert.equal(events.at(-1)?.payload["exitCode"], 3);
  assert.equal((await eventStore.last("run-phase5-fail"))?.type, "task_failed");
});

test("ProcessExecutionRuntime times out and records stable failure events", async () => {
  const stateRootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase5-timeout-"));
  const eventStore = new FileEventStore(stateRootDir);
  const runtime = new ProcessExecutionRuntime({
    eventStore,
    stateRootDir,
    killGraceMs: 5,
    spawnProcess: createFakeChildProcess((child) => {
      child.stdout.write("still-running\n");
    }),
  });

  const events: RunEvent[] = [];
  for await (const event of runtime.execute(
    "run-phase5-timeout",
    buildTask({ timeoutMs: 20 }),
    buildInvocation(),
  )) {
    events.push(event);
  }

  assert.equal(events[0]?.type, "task_started");
  assert.equal(events[1]?.type, "agent_message");
  assert.equal(events.at(-1)?.type, "task_failed");
  assert.equal(events.at(-1)?.payload["reason"], "timeout");
  assert.equal(events.at(-1)?.payload["timeoutMs"], 20);
  assert.equal((await eventStore.last("run-phase5-timeout"))?.type, "task_failed");
});
