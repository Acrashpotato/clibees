import test from "node:test";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { RunInspection, RunRecord } from "../domain/models.js";
import { DefaultValidator } from "../decision/validator.js";
import { FileArtifactStore } from "../storage/artifact-store.js";
import { FileBlackboardStore } from "../storage/blackboard-store.js";
import { buildTask, setupPhase8App } from "./phase8.test-helpers.js";

test("Phase 8 command validator interprets successful command exits", async () => {
  const validator = new DefaultValidator({
    spawnProcess: ((command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      process.nextTick(() => {
        child.stdout.emit("data", `ran ${command} ${args.join(" ")}`.trim());
        child.emit("close", 0, null);
      });
      return child as never;
    }) as never,
  });

  const result = await validator.validate({
    task: buildTask(process.cwd(), {
      validator: {
        mode: "command",
        commands: ["node -e ok"],
      },
    }),
    invocation: {
      taskId: "task-phase8",
      agentId: "local-default",
      command: "node",
      args: [],
      cwd: process.cwd(),
      actionPlans: [],
    },
    artifacts: [],
  });

  assert.equal(result.outcome, "pass");
  assert.match(result.summary, /Validated 1 command check/);
});

test("Phase 8 archives execution artifacts and projects validation summaries", async () => {
  const { app, stateRootDir, task } = await setupPhase8App({
    taskOverrides: {
      validator: {
        mode: "composite",
        children: [
          {
            mode: "files",
            requiredFiles: ["report.txt"],
          },
          {
            mode: "schema",
            outputSchemaId: "json_object",
          },
        ],
      },
    },
    onExecute: async (currentTask) => {
      await writeFile(path.join(currentTask.workingDirectory, "report.txt"), "ok", "utf8");
    },
    finalPayload: {
      structuredOutput: {
        report: "ok",
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "8", "success"])) as RunRecord;
  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "completed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.deepEqual(inspected.events.map((event) => event.type), [
    "run_started",
    "memory_recalled",
    "task_planned",
    "agent_selected",
    "context_built",
    "invocation_planned",
    "task_queued",
    "task_started",
    "task_completed",
    "artifact_created",
    "artifact_created",
    "artifact_created",
    "validation_started",
    "artifact_created",
    "validation_passed",
    "run_finished",
  ]);
  assert.equal(inspected.graph.tasks[task.id]?.status, "completed");

  const artifactStore = new FileArtifactStore(stateRootDir);
  const artifacts = await artifactStore.list(started.runId, { taskId: task.id });
  assert.deepEqual(
    artifacts.map((artifact) => artifact.kind).sort(),
    ["command_result", "file_change", "structured_output", "validation_result"],
  );

  const blackboardStore = new FileBlackboardStore(stateRootDir);
  const entries = await blackboardStore.list(started.runId);
  assert.deepEqual(
    [...new Set(entries.map((entry) => entry.scope))].sort(),
    ["agent", "planner", "validation"],
  );
});

test("Phase 8 maps missing required files to failed_retryable", async () => {
  const { app, stateRootDir, task } = await setupPhase8App({
    taskOverrides: {
      validator: {
        mode: "files",
        requiredFiles: ["missing.txt"],
      },
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 0,
        retryOn: ["validation_fail"],
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "8", "missing-file"])) as RunRecord;
  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "failed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.graph.tasks[task.id]?.status, "failed_retryable");
  assert.ok(inspected.events.some((event) => event.type === "validation_failed"));

  const artifactStore = new FileArtifactStore(stateRootDir);
  const validationArtifact = (await artifactStore.list(started.runId, { kind: "validation_result" }))[0];
  assert.equal(validationArtifact?.metadata.outcome, "fail_retryable");
});

test("Phase 8 maps schema validation failures to failed_terminal", async () => {
  const { app, stateRootDir, task } = await setupPhase8App({
    taskOverrides: {
      validator: {
        mode: "schema",
        outputSchemaId: "json_object",
      },
    },
    finalPayload: {
      structuredOutput: ["bad"],
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "8", "schema-fail"])) as RunRecord;
  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "failed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.graph.tasks[task.id]?.status, "failed_terminal");

  const artifactStore = new FileArtifactStore(stateRootDir);
  const validationArtifact = (await artifactStore.list(started.runId, { kind: "validation_result" }))[0];
  assert.equal(validationArtifact?.metadata.outcome, "fail_replan_needed");
});

test("Phase 8 maps blocked validators to blocked tasks", async () => {
  const { app, task } = await setupPhase8App({
    taskOverrides: {
      validator: {
        mode: "command",
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "8", "blocked"])) as RunRecord;
  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "failed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.graph.tasks[task.id]?.status, "blocked");
  assert.ok(inspected.events.some((event) => event.type === "task_blocked"));
});

test("Phase 8 maps runtime sandbox setup failures to failed_retryable when retryOn includes adapter_error", async () => {
  const { app, task } = await setupPhase8App({
    taskOverrides: {
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 0,
        retryOn: ["adapter_error"],
      },
    },
    terminalEventsByTaskId: {
      "task-phase8": [
        {
          type: "task_failed",
          payload: {
            exitCode: -1,
            error: "windows sandbox: setup refresh failed",
          },
        },
      ],
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "8", "adapter-error"])) as RunRecord;
  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "failed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.graph.tasks[task.id]?.status, "failed_retryable");
  assert.ok(inspected.events.some((event) => event.type === "task_failed"));
});

test("Phase 8 routes runtime policy-blocked failures to approval and resumes after approval", async () => {
  const { app, task } = await setupPhase8App({
    taskOverrides: {
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 0,
        retryOn: ["timeout"],
      },
    },
    terminalEventsByTaskId: {
      "task-phase8": [
        {
          type: "task_failed",
          payload: {
            reason: "timeout",
            output: "sandbox: read-only / blocked by policy while writing artifact",
          },
        },
        {
          type: "task_completed",
          payload: {},
        },
      ],
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "8", "runtime-approval"])) as RunRecord;
  const waiting = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(waiting.status, "waiting_approval");

  const approvals = (await app.entrypoint.handle(["approvals", started.runId])) as Array<{ id: string }>;
  assert.equal(approvals.length, 1);

  const approved = (await app.entrypoint.handle([
    "approve",
    started.runId,
    approvals[0]!.id,
    "--actor",
    "phase8-tester",
  ])) as RunRecord;
  assert.equal(approved.status, "completed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.graph.tasks[task.id]?.status, "completed");
  assert.ok(inspected.events.some((event) => event.type === "approval_requested"));
  assert.ok(inspected.events.some((event) => event.type === "approval_decided"));
});
