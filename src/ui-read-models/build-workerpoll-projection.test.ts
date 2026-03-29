import test from "node:test";
import assert from "node:assert/strict";
import type { AgentConfig } from "../domain/config.js";
import type { RunGraph, RunInspection, RunRecord, TaskSpec } from "../domain/models.js";
import { SCHEMA_VERSION } from "../domain/models.js";
import { buildWorkerpollProjection } from "./build-workerpoll-projection.js";

function buildTask(options: {
  taskId: string;
  title: string;
  kind?: TaskSpec["kind"];
  status?: TaskSpec["status"];
  requiredCapabilities: string[];
  assignedAgent?: string;
  preferredAgent?: string;
}): TaskSpec {
  return {
    id: options.taskId,
    title: options.title,
    kind: options.kind ?? "execute",
    goal: options.title,
    instructions: [],
    inputs: [],
    dependsOn: [],
    requiredCapabilities: options.requiredCapabilities,
    ...(options.assignedAgent ? { assignedAgent: options.assignedAgent } : {}),
    ...(options.preferredAgent ? { preferredAgent: options.preferredAgent } : {}),
    workingDirectory: ".",
    expectedArtifacts: [],
    acceptanceCriteria: [],
    validator: { mode: "none" },
    riskLevel: "medium",
    allowedActions: [],
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: [],
    },
    status: options.status ?? "pending",
  };
}

function buildInspection(tasks: TaskSpec[]): RunInspection {
  const run: RunRecord = {
    schemaVersion: SCHEMA_VERSION,
    runId: "run-workerpoll-projection",
    name: "Worker match audit",
    goal: "Verify workerpoll matching semantics.",
    status: "running",
    workspacePath: process.cwd().replace(/\\/g, "/"),
    currentTaskId: tasks[0]?.id,
    createdAt: "2026-03-21T08:00:00.000Z",
    updatedAt: "2026-03-21T08:05:00.000Z",
    metadata: {
      plannerMode: "delegated",
      plannerAgentId: "codex",
      agentIds: ["codex", "codex-worker"],
    },
  };

  const graphTasks: RunGraph["tasks"] = {};
  for (const task of tasks) {
    graphTasks[task.id] = task;
  }

  const graph: RunGraph = {
    runId: run.runId,
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    tasks: graphTasks,
    edges: [],
    readyQueue: [],
    completedTaskIds: [],
    failedTaskIds: [],
    cancelledTaskIds: [],
    metadata: {},
  };

  return {
    run,
    graph,
    events: [],
    timeline: [],
    artifacts: [],
    blackboard: [],
    validation: [],
    approvals: [],
    summary: {
      runStatus: run.status,
      completedTasks: 0,
      failedTasks: 0,
      blockedTasks: 0,
      pendingApprovals: 0,
    },
  };
}

function buildConfiguredAgents(): AgentConfig[] {
  return [
    {
      id: "codex",
      command: "codex",
      profiles: [
        {
          id: "manager",
          label: "Manager",
          capabilities: ["planning", "delegation"],
          costTier: "low",
        },
      ],
    },
    {
      id: "codex-worker",
      command: "codex",
      profiles: [
        {
          id: "worker",
          label: "Worker",
          capabilities: ["planning", "coding"],
          costTier: "low",
        },
      ],
    },
  ];
}

test("buildWorkerpollProjection excludes manager delegation tasks from uncovered count while keeping them auditable", () => {
  const managerTask = buildTask({
    taskId: "task-manager",
    title: "Manager dispatch: Release orchestration",
    kind: "plan",
    status: "awaiting_approval",
    requiredCapabilities: ["planning", "delegation"],
    assignedAgent: "codex",
  });
  const capabilityGapTask = buildTask({
    taskId: "task-gap",
    title: "Frontend implementation",
    requiredCapabilities: ["frontend"],
  });
  const unassignedTask = buildTask({
    taskId: "task-unassigned",
    title: "Planning-only worker task",
    requiredCapabilities: ["planning"],
  });
  const mismatchedTask = buildTask({
    taskId: "task-mismatched",
    title: "Worker coding task assigned to planner",
    requiredCapabilities: ["coding"],
    assignedAgent: "codex",
  });

  const projection = buildWorkerpollProjection(
    buildInspection([managerTask, capabilityGapTask, unassignedTask, mismatchedTask]),
    { configuredAgents: buildConfiguredAgents() },
  );

  const managerView = projection.tasks.find((task) => task.taskId === managerTask.id);
  const gapView = projection.tasks.find((task) => task.taskId === capabilityGapTask.id);
  const unassignedView = projection.tasks.find((task) => task.taskId === unassignedTask.id);
  const mismatchedView = projection.tasks.find((task) => task.taskId === mismatchedTask.id);

  assert.ok(managerView);
  assert.equal(managerView.matchStatus, "capability_gap");
  assert.equal(managerView.isManagerTask, true);

  assert.ok(gapView);
  assert.equal(gapView.matchStatus, "capability_gap");
  assert.equal(gapView.isManagerTask, false);

  assert.ok(unassignedView);
  assert.equal(unassignedView.matchStatus, "unassigned");
  assert.equal(unassignedView.isManagerTask, false);

  assert.ok(mismatchedView);
  assert.equal(mismatchedView.matchStatus, "mismatched");
  assert.equal(mismatchedView.isManagerTask, false);

  assert.equal(projection.summary.taskCount, 4);
  assert.equal(projection.summary.workerCount, 1);
  assert.equal(projection.summary.uncoveredTaskCount, 1);
  assert.equal(projection.summary.excludedManagerTaskCount, 1);
  assert.equal(projection.run.name, "Worker match audit");
});
