import test from "node:test";
import assert from "node:assert/strict";
import type { RunInspection, RunRecord } from "../domain/models.js";
import { setupPhase7App } from "./phase7.test-helpers.js";

test("Phase 7 blocks configured high-risk actions before execution", async () => {
  const { app, executionCounter } = await setupPhase7App({
    safety: {
      approvalThreshold: "high",
      blockedActions: ["git_push"],
    },
    actionPlans: [
      {
        id: "action-phase7-blocked",
        kind: "git_push",
        command: "git",
        args: ["push", "origin", "main"],
        cwd: process.cwd(),
        riskLevel: "high",
        requiresApproval: true,
        reason: "Push the current branch.",
      },
    ],
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "7", "blocked"])) as RunRecord;
  assert.equal(started.status, "ready");

  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "failed");
  assert.equal(executionCounter.count, 0);

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.deepEqual(
    inspected.events.map((event) => event.type),
    [
      "run_started",
      "memory_recalled",
      "task_planned",
      "agent_selected",
      "context_built",
      "invocation_planned",
      "task_blocked",
      "run_finished",
    ],
  );
  assert.equal(inspected.graph.tasks["task-phase7"]?.status, "blocked");
});

test("Phase 7 approval command lists pending requests and resumes execution after approval", async () => {
  const { app, executionCounter } = await setupPhase7App({
    safety: {
      approvalThreshold: "medium",
      blockedActions: [],
    },
    actionPlans: [
      {
        id: "action-phase7-approve",
        kind: "git_push",
        command: "git",
        args: ["push", "origin", "feature/phase7"],
        cwd: process.cwd(),
        riskLevel: "high",
        requiresApproval: true,
        reason: "Push the Phase 7 branch.",
      },
    ],
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "7", "approval"])) as RunRecord;
  const paused = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(paused.status, "waiting_approval");
  assert.equal(executionCounter.count, 0);

  const pending = (await app.entrypoint.handle(["approvals", started.runId])) as Array<{ id: string }>;
  assert.equal(pending.length, 1);

  const approved = (await app.entrypoint.handle([
    "approve",
    started.runId,
    pending[0]!.id,
    "--actor",
    "tester",
    "--note",
    "approved-for-phase7",
  ])) as RunRecord;
  assert.equal(approved.status, "completed");
  assert.equal(executionCounter.count, 1);

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.deepEqual(
    inspected.events.map((event) => event.type),
    [
      "run_started",
      "memory_recalled",
      "task_planned",
      "agent_selected",
      "context_built",
      "invocation_planned",
      "approval_requested",
      "artifact_created",
      "approval_decided",
      "artifact_created",
      "agent_selected",
      "context_built",
      "invocation_planned",
      "task_queued",
      "task_started",
      "task_completed",
      "artifact_created",
      "validation_started",
      "artifact_created",
      "validation_passed",
      "run_finished",
    ],
  );
  assert.equal(inspected.graph.tasks["task-phase7"]?.status, "completed");
});

test("Phase 7 reject command blocks the task and terminates the run", async () => {
  const { app, executionCounter } = await setupPhase7App({
    safety: {
      approvalThreshold: "medium",
      blockedActions: [],
    },
    actionPlans: [
      {
        id: "action-phase7-reject",
        kind: "delete_file",
        command: "rm",
        args: ["-rf", "dist"],
        cwd: process.cwd(),
        riskLevel: "high",
        requiresApproval: true,
        reason: "Delete the build directory.",
      },
    ],
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "7", "reject"])) as RunRecord;
  const paused = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(paused.status, "waiting_approval");

  const pending = (await app.entrypoint.handle(["approvals", started.runId])) as Array<{ id: string }>;
  assert.equal(pending.length, 1);

  const rejected = (await app.entrypoint.handle([
    "reject",
    started.runId,
    pending[0]!.id,
    "--actor",
    "reviewer",
    "--note",
    "unsafe",
  ])) as RunRecord;
  assert.equal(rejected.status, "failed");
  assert.equal(executionCounter.count, 0);

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.deepEqual(
    inspected.events.map((event) => event.type),
    [
      "run_started",
      "memory_recalled",
      "task_planned",
      "agent_selected",
      "context_built",
      "invocation_planned",
      "approval_requested",
      "artifact_created",
      "approval_decided",
      "artifact_created",
      "task_blocked",
      "run_finished",
    ],
  );
  assert.equal(inspected.graph.tasks["task-phase7"]?.status, "blocked");
});

test("Phase 7 approval policy can force approval for medium-risk command actions", async () => {
  const { app, executionCounter } = await setupPhase7App({
    safety: {
      approvalThreshold: "high",
      blockedActions: [],
      approvalPolicyByAction: {
        command: "medium",
      },
    },
    actionPlans: [
      {
        id: "action-phase7-policy-force",
        kind: "command",
        command: "node",
        args: ["-e", "process.stdout.write('policy-force');"],
        cwd: process.cwd(),
        riskLevel: "medium",
        requiresApproval: false,
        reason: "Run medium-risk shell work.",
      },
    ],
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "7", "policy-force"])) as RunRecord;
  const paused = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(paused.status, "waiting_approval");
  assert.equal(executionCounter.count, 0);

  const pending = (await app.entrypoint.handle(["approvals", started.runId])) as Array<{ id: string }>;
  assert.equal(pending.length, 1);

  const approved = (await app.entrypoint.handle([
    "approve",
    started.runId,
    pending[0]!.id,
    "--actor",
    "reviewer",
  ])) as RunRecord;
  assert.equal(approved.status, "completed");
  assert.equal(executionCounter.count, 1);
});

test("Phase 7 approval policy can bypass adapter-level approval hints", async () => {
  const { app, executionCounter } = await setupPhase7App({
    safety: {
      approvalThreshold: "high",
      blockedActions: [],
      approvalPolicyByAction: {
        command: "never",
      },
    },
    actionPlans: [
      {
        id: "action-phase7-policy-never",
        kind: "command",
        command: "node",
        args: ["-e", "process.stdout.write('policy-never');"],
        cwd: process.cwd(),
        riskLevel: "high",
        requiresApproval: true,
        reason: "Simulate adapter requesting approval for command action.",
      },
    ],
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "7", "policy-never"])) as RunRecord;
  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "completed");
  assert.equal(executionCounter.count, 1);

  const pending = (await app.entrypoint.handle(["approvals", started.runId])) as Array<{ id: string }>;
  assert.equal(pending.length, 0);

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.events.some((event) => event.type === "approval_requested"), false);
});

