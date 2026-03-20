import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import type {
  MemoryRecord,
  RunGraph,
  RunInspection,
  RunRecord,
} from "../domain/models.js";
import { ConfiguredCliAdapter } from "../adapters/configured-cli-adapter.js";
import { MemoryConsolidator } from "./memory-consolidator.js";
import {
  FileProjectMemoryStore,
  readMemoryIndex,
} from "../storage/project-memory-store.js";
import { buildTask, setupPhase10App } from "./phase10.test-helpers.js";

test("ConfiguredCliAdapter treats codex-worker ids as codex stdin invocations", async () => {
  const workspaceDir = process.cwd();
  const adapter = new ConfiguredCliAdapter({
    id: "codex-worker-planning",
    command: "codex",
    priority: 1,
    profiles: [
      {
        id: "worker",
        label: "Worker",
        capabilities: ["planning"],
        defaultArgs: ["exec", "--skip-git-repo-check", "-"],
        defaultCwd: workspaceDir,
        costTier: "low",
      },
    ],
  });
  const task = buildTask(workspaceDir, {
    id: "task-codex-worker-stdin",
    title: "Delegated worker task",
    goal: "Implement the delegated user goal end-to-end.",
  });
  const invocation = await adapter.planInvocation(
    task,
    {
      taskBrief: "",
      relevantFacts: [],
      relevantDecisions: [],
      artifactSummaries: [],
      workspaceSummary: "",
      transcriptRefs: [],
      agentHints: [],
    },
    {
      agentId: "codex-worker-planning",
      profileId: "worker",
      reason: "test",
    },
  );

  assert.deepEqual(invocation.args, ["exec", "--skip-git-repo-check", "-"]);
  assert.match(invocation.stdin ?? "", /Task: Delegated worker task/);
  assert.match(invocation.stdin ?? "", /Goal: Implement the delegated user goal end-to-end\./);
  assert.match(invocation.stdin ?? "", /Instructions:/);
  assert.match(invocation.stdin ?? "", /Workspace Summary:\n\(none\)/);
  assert.ok(!invocation.args.some((arg) => arg.includes("Task:")));
  assert.deepEqual(invocation.actionPlans[0]?.args, ["exec", "--skip-git-repo-check", "-"]);
});

test("ConfiguredCliAdapter injects codex stdin sentinel and prioritizes task cwd", async () => {
  const workspaceDir = process.cwd();
  const profileCwd = path.join(workspaceDir, "profile-default");
  const taskCwd = path.join(workspaceDir, "task-target");
  const adapter = new ConfiguredCliAdapter({
    id: "codex-worker-planning",
    command: "codex",
    priority: 1,
    profiles: [
      {
        id: "worker",
        label: "Worker",
        capabilities: ["planning"],
        defaultArgs: ["exec", "--skip-git-repo-check"],
        defaultCwd: profileCwd,
        costTier: "low",
      },
    ],
  });
  const task = buildTask(taskCwd, {
    id: "task-codex-worker-cwd",
    title: "Delegated cwd task",
    goal: "Write output in the delegated task directory.",
  });
  const invocation = await adapter.planInvocation(
    task,
    {
      taskBrief: "",
      relevantFacts: [],
      relevantDecisions: [],
      artifactSummaries: [],
      workspaceSummary: "",
      transcriptRefs: [],
      agentHints: [],
    },
    {
      agentId: "codex-worker-planning",
      profileId: "worker",
      reason: "test",
    },
  );

  assert.deepEqual(invocation.args, ["exec", "--skip-git-repo-check", "-"]);
  assert.equal(invocation.cwd, taskCwd);
  assert.equal(invocation.actionPlans[0]?.cwd, taskCwd);
  assert.match(invocation.stdin ?? "", /Task: Delegated cwd task/);
});

test("Phase 10 project memory recall filters by scope, tags, and text", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase10-memory-"));
  const memoryStore = new FileProjectMemoryStore(rootDir);
  const records: MemoryRecord[] = [
    {
      schemaVersion: 1,
      id: "memory-phase10-inspect",
      kind: "decision",
      scope: "project",
      subject: "Inspect read model",
      content: "Inspect now returns aggregated timeline and summaries.",
      tags: ["phase10", "inspect"],
      sourceRunId: "manual-phase10",
      confidence: 0.98,
      validFrom: "2026-03-12T13:00:00.000Z",
      status: "active",
    },
    {
      schemaVersion: 1,
      id: "memory-phase10-risk",
      kind: "risk",
      scope: "project",
      subject: "Resume drift",
      content: "Workspace drift still pauses runs before resume.",
      tags: ["phase10", "resume"],
      sourceRunId: "manual-phase10",
      confidence: 0.9,
      validFrom: "2026-03-12T13:01:00.000Z",
      status: "active",
    },
    {
      schemaVersion: 1,
      id: "memory-other-scope",
      kind: "decision",
      scope: "session",
      subject: "Other scope",
      content: "Should not be returned for project queries.",
      tags: ["phase10"],
      sourceRunId: "manual-phase10",
      confidence: 0.7,
      validFrom: "2026-03-12T13:02:00.000Z",
      status: "active",
    },
  ];

  await memoryStore.persist(records);

  const recalled = await memoryStore.recall({
    text: "timeline",
    scope: "project",
    tags: ["inspect"],
  });
  const index = await readMemoryIndex(rootDir);

  assert.equal(recalled.length, 1);
  assert.equal(recalled[0]?.id, "memory-phase10-inspect");
  assert.deepEqual(index?.byScope.project, ["memory-phase10-inspect", "memory-phase10-risk"]);
  assert.deepEqual(index?.byTag.inspect, ["memory-phase10-inspect"]);
});

test("Phase 10 consolidation supersedes outdated active memories", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase10-consolidate-"));
  const memoryStore = new FileProjectMemoryStore(rootDir);
  const consolidator = new MemoryConsolidator(memoryStore);
  const graph: RunGraph = {
    runId: "run-phase10-a",
    schemaVersion: 1,
    revision: 1,
    tasks: {
      "task-stable": buildTask(process.cwd(), {
        id: "task-stable",
        title: "Stable task",
        status: "completed",
      }),
    },
    edges: [],
    readyQueue: [],
    completedTaskIds: ["task-stable"],
    failedTaskIds: [],
    cancelledTaskIds: [],
    metadata: {},
  };

  await consolidator.consolidate({
    run: {
      schemaVersion: 1,
      runId: "run-phase10-a",
      goal: "First pass",
      status: "completed",
      workspacePath: process.cwd(),
      createdAt: "2026-03-12T13:10:00.000Z",
      updatedAt: "2026-03-12T13:10:10.000Z",
      metadata: {},
    },
    graph,
    events: [],
    artifacts: [
      {
        id: "artifact-validation-a",
        runId: "run-phase10-a",
        taskId: "task-stable",
        kind: "validation_result",
        uri: "artifact://validation/a",
        summary: "Validated release plan A.",
        createdAt: "2026-03-12T13:10:09.000Z",
        metadata: {
          outcome: "pass",
          details: [],
        },
      },
    ],
    blackboardEntries: [],
  });

  await consolidator.consolidate({
    run: {
      schemaVersion: 1,
      runId: "run-phase10-b",
      goal: "Second pass",
      status: "completed",
      workspacePath: process.cwd(),
      createdAt: "2026-03-12T13:20:00.000Z",
      updatedAt: "2026-03-12T13:20:10.000Z",
      metadata: {},
    },
    graph: {
      ...graph,
      runId: "run-phase10-b",
    },
    events: [],
    artifacts: [
      {
        id: "artifact-validation-b",
        runId: "run-phase10-b",
        taskId: "task-stable",
        kind: "validation_result",
        uri: "artifact://validation/b",
        summary: "Validated release plan B.",
        createdAt: "2026-03-12T13:20:09.000Z",
        metadata: {
          outcome: "pass",
          details: [],
        },
      },
    ],
    blackboardEntries: [],
  });

  const active = await memoryStore.recall({ text: "stable", scope: "project" });
  const rawLines = (await readFile(path.join(rootDir, "records.jsonl"), "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as MemoryRecord);
  const superseded = rawLines.filter((record) => record.status === "superseded");

  assert.equal(active.length, 1);
  assert.equal(active[0]?.content, "Validated release plan B.");
  assert.ok(superseded.some((record) => record.subject === "Validated task Stable task"));
});

test("Phase 10 inspect aggregates timeline, artifacts, approvals, validation, and summary", async () => {
  const task = buildTask(process.cwd(), {
    id: "task-approval-pass",
    title: "Approval task",
  });
  const { app, projectMemoryStore } = await setupPhase10App({
    tasks: [task],
    actionPlansByTaskId: {
      "task-approval-pass": [
        {
          id: "action-phase10-approve",
          kind: "git_push",
          command: "git",
          args: ["push", "origin", "phase10"],
          cwd: process.cwd(),
          riskLevel: "high",
          requiresApproval: true,
          reason: "Needs manual approval.",
        },
      ],
    },
    validationByTaskId: {
      "task-approval-pass": {
        outcome: "pass",
        summary: "Validation passed after approval.",
        details: ["Artifact summary available."],
        createdArtifacts: [],
      },
    },
    configOverrides: {
      safety: {
        approvalThreshold: "medium",
        blockedActions: [],
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "10", "approve"])) as RunRecord;
  const waiting = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(waiting.status, "waiting_approval");

  const approvals = (await app.entrypoint.handle(["approvals", started.runId])) as Array<{ id: string }>;
  assert.equal(approvals.length, 1);

  await app.entrypoint.handle([
    "approve",
    started.runId,
    approvals[0]!.id,
    "--actor",
    "phase10-tester",
    "--note",
    "looks-safe",
  ]);
  const completed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(completed.status, "completed");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  const taskArtifacts = inspected.artifacts.find((group) => group.taskId === task.id);
  const validationItem = inspected.validation.find((item) => item.taskId === task.id);
  const approvalItem = inspected.approvals.find((item) => item.requestId === approvals[0]!.id);
  const recalled = await projectMemoryStore.recall({ text: "approval", scope: "project" });

  assert.ok(inspected.timeline.some((entry) => entry.type === "approval_requested"));
  assert.ok(inspected.timeline.some((entry) => entry.type === "approval_decided"));
  assert.ok(inspected.timeline.some((entry) => entry.type === "validation_passed"));
  assert.ok(taskArtifacts?.artifacts.some((artifact) => artifact.kind === "approval_record"));
  assert.ok(taskArtifacts?.artifacts.some((artifact) => artifact.kind === "validation_result"));
  assert.equal(validationItem?.summary, "Validation passed after approval.");
  assert.equal(approvalItem?.state, "approved");
  assert.equal(inspected.summary.runStatus, "completed");
  assert.equal(inspected.summary.pendingApprovals, 0);
  assert.equal(inspected.summary.completedTasks, 1);
  assert.ok(inspected.blackboard.some((scope) => scope.scope === "validation" && scope.entries.length > 0));
  assert.ok(recalled.some((record) => record.subject === "Approval outcome for Approval task"));
});

test("Phase 10 inspect explains blocked runs after approval rejection", async () => {
  const task = buildTask(process.cwd(), {
    id: "task-approval-reject",
    title: "Rejected task",
  });
  const { app } = await setupPhase10App({
    tasks: [task],
    actionPlansByTaskId: {
      "task-approval-reject": [
        {
          id: "action-phase10-reject",
          kind: "file_delete",
          command: "powershell",
          args: ["-NoProfile", "-Command", "Remove-Item dangerous.txt"],
          cwd: process.cwd(),
          riskLevel: "high",
          requiresApproval: true,
          reason: "Deletes an important file.",
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

  const started = (await app.entrypoint.handle(["run", "Phase", "10", "reject"])) as RunRecord;
  const waiting = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(waiting.status, "waiting_approval");

  const approvals = (await app.entrypoint.handle(["approvals", started.runId])) as Array<{ id: string }>;
  await app.entrypoint.handle([
    "reject",
    started.runId,
    approvals[0]!.id,
    "--actor",
    "phase10-tester",
    "--note",
    "unsafe",
  ]);

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  const approvalItem = inspected.approvals.find((item) => item.requestId === approvals[0]!.id);

  assert.equal(inspected.run.status, "failed");
  assert.equal(inspected.graph.tasks[task.id]?.status, "blocked");
  assert.ok(inspected.timeline.some((entry) => entry.type === "task_blocked"));
  assert.equal(approvalItem?.state, "rejected");
  assert.match(inspected.summary.latestBlocker ?? "", /rejected/i);
});

test("Phase 10 resume requeues stale awaiting approval tasks with no pending approval", async () => {
  const task = buildTask(process.cwd(), {
    id: "task-stale-awaiting-approval",
    title: "Stale awaiting approval",
  });
  const { app } = await setupPhase10App({
    tasks: [task],
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "10", "stale"])) as RunRecord;

  await app.dependencies.runStore.updateTaskStatus(started.runId, task.id, "routing");
  await app.dependencies.runStore.updateTaskStatus(
    started.runId,
    task.id,
    "context_building",
  );
  await app.dependencies.runStore.updateTaskStatus(
    started.runId,
    task.id,
    "awaiting_approval",
  );

  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "completed");

  const pendingApprovals = await app.runCoordinator.listPendingApprovals(started.runId);
  assert.equal(pendingApprovals.length, 0);

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.graph.tasks[task.id]?.status, "completed");
  assert.ok(
    inspected.events.some(
      (event) => event.type === "task_started" && event.taskId === task.id,
    ),
  );
});

test("Phase 10 resume pauses when unresolved tasks remain without ready work", async () => {
  const task = buildTask(process.cwd(), {
    id: "task-pending-without-ready-work",
    title: "Pending without ready work",
  });
  const { app } = await setupPhase10App({
    tasks: [task],
  });

  const started = (await app.entrypoint.handle(["run", "Phase", "10", "pause"])) as RunRecord;
  const graph = await app.dependencies.runStore.getGraph(started.runId);
  assert.ok(graph);
  await app.dependencies.runStore.saveGraph(started.runId, {
    ...graph!,
    tasks: {
      ...graph!.tasks,
      [task.id]: {
        ...graph!.tasks[task.id]!,
        status: "pending",
      },
    },
    readyQueue: [],
  });

  const resumed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(resumed.status, "paused");

  const inspected = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  assert.equal(inspected.run.status, "paused");
  assert.equal(inspected.graph.tasks[task.id]?.status, "pending");
});


