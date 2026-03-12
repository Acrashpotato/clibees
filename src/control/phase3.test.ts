import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../app/create-app.js";
import { Scheduler } from "./scheduler.js";
import { GraphManager } from "./graph-manager.js";
import type { MultiAgentConfig } from "../domain/config.js";
import type { RunInspection, RunRecord, TaskSpec } from "../domain/models.js";

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

function createTestConfig(workspaceRootDir: string): MultiAgentConfig {
  return {
    version: 1,
    workspace: {
      rootDir: workspaceRootDir,
      allowOutsideWorkspaceWrites: false,
    },
    agents: [],
    planner: {
      mode: "static",
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
      enabled: true,
      rootDir: path.join(workspaceRootDir, ".multi-agent", "memory"),
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

test("GraphManager validates duplicate ids, missing dependencies, and cycles", () => {
  const graphManager = new GraphManager();

  assert.throws(
    () => graphManager.createGraph("run-dup", [buildTask("task-a"), buildTask("task-a")]),
    /Duplicate task id "task-a"/,
  );

  assert.throws(
    () => graphManager.createGraph("run-missing", [buildTask("task-b", ["task-a"])]),
    /depends on missing task "task-a"/,
  );

  assert.throws(
    () =>
      graphManager.createGraph("run-cycle", [
        buildTask("task-a", ["task-b"]),
        buildTask("task-b", ["task-a"]),
      ]),
    /Cycle detected at task "task-a"|Cycle detected at task "task-b"/,
  );
});

test("Scheduler promotes dependent tasks after completion", () => {
  const graphManager = new GraphManager();
  const scheduler = new Scheduler();
  const graph = graphManager.createGraph("run-scheduler", [
    buildTask("task-a"),
    buildTask("task-b", ["task-a"]),
    buildTask("task-c", ["task-a"]),
  ]);

  graph.tasks["task-a"] = {
    ...graph.tasks["task-a"],
    status: "validating",
  };

  const nextGraph = scheduler.onTaskCompleted(graph, "task-a");

  assert.equal(nextGraph.tasks["task-a"].status, "completed");
  assert.deepEqual(nextGraph.completedTaskIds, ["task-a"]);
  assert.deepEqual(nextGraph.readyQueue, ["task-b", "task-c"]);
  assert.equal(nextGraph.tasks["task-b"].status, "ready");
  assert.equal(nextGraph.tasks["task-c"].status, "ready");
  assert.equal(scheduler.pickNext(nextGraph)?.id, "task-b");
});

test("Entrypoint run plus inspect returns persisted phase 3 state", async () => {
  const stateRootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase3-"));
  const app = createApp({
    stateRootDir,
    configLoader: {
      async load(): Promise<MultiAgentConfig> {
        return createTestConfig(stateRootDir);
      },
    },
  });

  const runResult = await app.entrypoint.handle(["run", "Ship", "phase", "3"]);
  assert.ok("runId" in runResult);

  const runRecord = runResult as RunRecord;
  assert.equal(runRecord.status, "ready");

  const inspectResult = (await app.entrypoint.handle([
    "inspect",
    runRecord.runId,
  ])) as RunInspection;

  assert.equal(inspectResult.run.runId, runRecord.runId);
  assert.equal(inspectResult.run.status, "ready");
  assert.equal(Object.keys(inspectResult.graph.tasks).length, 1);
  assert.deepEqual(
    inspectResult.events.map((event) => event.type),
    ["run_started", "memory_recalled", "task_planned"],
  );

  const [plannedTask] = Object.values(inspectResult.graph.tasks);
  assert.equal(plannedTask.status, "ready");
  assert.deepEqual(inspectResult.graph.readyQueue, [plannedTask.id]);
});