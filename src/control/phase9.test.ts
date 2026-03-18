import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import type {
  RunInspection,
  RunRecord,
  ValidationResult,
} from "../domain/models.js";
import type { ValidationInput, Validator } from "../decision/validator.js";
import { GraphManager } from "./graph-manager.js";
import { FileWorkspaceStateStore } from "../storage/workspace-state-store.js";
import {
  buildTask,
  setupPhase9App,
  workspaceDirPlaceholder,
} from "./phase9.test-helpers.js";

test("Phase 9 GraphManager append and cancel patches preserve graph integrity", () => {
  const graphManager = new GraphManager();
  const graph = graphManager.createGraph("run-phase9-graph", [
    buildTask(process.cwd(), { id: "task-a", title: "A" }),
    buildTask(process.cwd(), { id: "task-b", title: "B", dependsOn: ["task-a"] }),
  ]);

  const appended = graphManager.applyPatch(graph, {
    operation: "append_tasks",
    reason: "Add an extra pending task.",
    tasks: [
      buildTask(process.cwd(), {
        id: "task-c",
        title: "C",
        dependsOn: ["task-a"],
      }),
    ],
  });
  assert.equal(appended.tasks["task-c"]?.status, "pending");

  const cancelled = graphManager.applyPatch(appended, {
    operation: "cancel_pending_tasks",
    reason: "Drop task B.",
    targetTaskIds: ["task-b"],
  });
  assert.equal(cancelled.tasks["task-b"]?.status, "cancelled");
  assert.ok(cancelled.cancelledTaskIds.includes("task-b"));
});

test("Phase 9 GraphManager replaces pending subgraphs and rejects completed targets", () => {
  const graphManager = new GraphManager();
  const original = graphManager.createGraph("run-phase9-replace", [
    buildTask(process.cwd(), { id: "task-a", title: "A" }),
    buildTask(process.cwd(), { id: "task-b", title: "B", dependsOn: ["task-a"] }),
    buildTask(process.cwd(), { id: "task-c", title: "C", dependsOn: ["task-b"] }),
  ]);

  original.tasks["task-a"] = { ...original.tasks["task-a"]!, status: "completed" };
  original.completedTaskIds.push("task-a");
  original.readyQueue = ["task-b"];
  original.tasks["task-b"] = { ...original.tasks["task-b"]!, status: "ready" };

  const replaced = graphManager.applyPatch(original, {
    operation: "replace_pending_subgraph",
    reason: "Swap B/C for D.",
    targetTaskIds: ["task-b"],
    tasks: [
      buildTask(process.cwd(), {
        id: "task-d",
        title: "D",
        dependsOn: ["task-a"],
      }),
    ],
  });
  assert.equal(replaced.tasks["task-b"], undefined);
  assert.equal(replaced.tasks["task-c"], undefined);
  assert.equal(replaced.tasks["task-d"]?.status, "ready");

  assert.throws(() =>
    graphManager.applyPatch(original, {
      operation: "replace_pending_subgraph",
      reason: "Illegal replace.",
      targetTaskIds: ["task-a"],
      tasks: [],
    }),
  );
});

test("Phase 9 captures workspace snapshots and pauses resume when drift is detected", async () => {
  const task1 = buildTask("", { id: "task-build", title: "Build output" });
  const task2 = buildTask("", {
    id: "task-approve",
    title: "Approval step",
    dependsOn: ["task-build"],
  });

  const { app, workspaceDir } = await setupPhase9App({
    tasks: [
      { ...task1, workingDirectory: workspaceDirPlaceholder() },
      { ...task2, workingDirectory: workspaceDirPlaceholder() },
    ],
    actionPlansByTaskId: {
      "task-approve": [
        {
          id: "action-phase9-approve",
          kind: "git_push",
          command: "git",
          args: ["push", "origin", "phase9"],
          cwd: process.cwd(),
          riskLevel: "high",
          requiresApproval: true,
          reason: "Push the Phase 9 branch.",
        },
      ],
    },
    onExecute: async (task) => {
      if (task.id === "task-build") {
        await writeFile(path.join(task.workingDirectory, "generated.txt"), "built", "utf8");
      }
    },
    configOverrides: {
      safety: {
        approvalThreshold: "medium",
        blockedActions: [],
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "9", "drift"])) as RunRecord;
  const waiting = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(waiting.status, "waiting_approval");

  const workspaceStore = new FileWorkspaceStateStore({
    stateRootDir: path.join(workspaceDir, ".multi-agent", "state"),
    workspaceRootDir: workspaceDir,
  });
  const beforeSnapshot = await workspaceStore.getLatestSnapshot(started.runId, {
    phases: ["before_task"],
  });
  const afterSnapshot = await workspaceStore.getLatestSnapshot(started.runId, {
    phases: ["after_task"],
  });
  assert.equal(beforeSnapshot?.taskId, "task-build");
  assert.equal(afterSnapshot?.taskId, "task-build");
  assert.ok(afterSnapshot?.diffSummary.added.includes("generated.txt"));

  await writeFile(path.join(workspaceDir, "seed.txt"), "drifted", "utf8");
  const paused = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(paused.status, "paused");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.ok(inspected.events.some((event) => event.type === "workspace_drift_detected"));
});

test("Phase 9 resume keeps pending approvals suspended without re-executing the task", async () => {
  const { app, executionCounter } = await setupPhase9App({
    tasks: [buildTask(workspaceDirPlaceholder(), { id: "task-waiting" })],
    actionPlansByTaskId: {
      "task-waiting": [
        {
          id: "action-phase9-waiting",
          kind: "git_push",
          command: "git",
          args: ["push", "origin", "phase9"],
          cwd: process.cwd(),
          riskLevel: "high",
          requiresApproval: true,
          reason: "Needs manual approval.",
        },
      ],
    },
    configOverrides: {
      safety: {
        approvalThreshold: "medium",
        blockedActions: [],
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "9", "pending-approval"])) as RunRecord;
  const waiting = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(waiting.status, "waiting_approval");
  assert.equal(executionCounter.count, 0);

  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "waiting_approval");
  assert.equal(executionCounter.count, 0);
});

test("Phase 9 replans after validation requests a new task and completes the replacement work", async () => {
  const replanSource = buildTask(workspaceDirPlaceholder(), {
    id: "task-replan-source",
    title: "Source task",
    validator: { mode: "schema", outputSchemaId: "json_object" },
  });
  const replanFollowup = buildTask(workspaceDirPlaceholder(), {
    id: "task-replan-followup",
    title: "Follow-up task",
  });

  const validator: Validator = {
    async validate(input: ValidationInput): Promise<ValidationResult> {
      if (input.task.id === "task-replan-source") {
        return {
          outcome: "fail_replan_needed",
          summary: "Need a follow-up task.",
          details: ["Source task emitted incomplete output."],
          createdArtifacts: [],
        };
      }
      return {
        outcome: "pass",
        summary: "Follow-up task validated.",
        details: [],
        createdArtifacts: [],
      };
    },
  };

  const { app } = await setupPhase9App({
    tasks: [replanSource],
    replanTasks: [replanFollowup],
    validator,
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "9", "replan"])) as RunRecord;
  const completed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(completed.status, "completed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.graph.tasks["task-replan-source"]?.status, "cancelled");
  assert.equal(inspected.graph.tasks["task-replan-followup"]?.status, "completed");
  assert.ok(inspected.events.some((event) => event.type === "replan_requested"));
  assert.ok(inspected.events.some((event) => event.type === "replan_applied"));
});
