import test from "node:test";
import assert from "node:assert/strict";
import type { RunEvent, RunGraph, RunInspection, RunRecord, TaskSpec } from "../domain/models.js";
import { SCHEMA_VERSION } from "../domain/models.js";
import { buildApprovalQueueProjection } from "./build-approval-queue-projection.js";

function buildTask(taskId: string): TaskSpec {
  return {
    id: taskId,
    title: "Release package",
    kind: "execute",
    goal: "Ship the release",
    instructions: [],
    inputs: [],
    dependsOn: [],
    requiredCapabilities: ["release"],
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
    status: "awaiting_approval",
  };
}

function buildEvent(
  runId: string,
  eventId: string,
  type: RunEvent["type"],
  timestamp: string,
  taskId: string,
  payload: Record<string, unknown>,
): RunEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: eventId,
    type,
    runId,
    taskId,
    timestamp,
    payload,
  };
}

test("buildApprovalQueueProjection includes action plan snapshots, session binding, and decision metadata", () => {
  const runId = "run-approval-projection";
  const task = buildTask("task-a");
  const run: RunRecord = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    goal: "Ship the release",
    status: "waiting_approval",
    workspacePath: process.cwd().replace(/\\/g, "/"),
    currentTaskId: task.id,
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:40:00.000Z",
    metadata: {},
  };
  const graph: RunGraph = {
    runId,
    schemaVersion: SCHEMA_VERSION,
    revision: 3,
    tasks: {
      [task.id]: task,
    },
    edges: [],
    readyQueue: [],
    completedTaskIds: [],
    failedTaskIds: [],
    cancelledTaskIds: [],
    metadata: {},
  };
  const inspection: RunInspection = {
    run,
    graph,
    events: [
      buildEvent(runId, "event-start", "task_started", "2026-03-12T10:00:00.000Z", task.id, { agentId: "release-agent" }),
      buildEvent(runId, "event-request-a", "approval_requested", "2026-03-12T10:05:00.000Z", task.id, { requestId: "approval-a" }),
      buildEvent(runId, "event-decision-a", "approval_decided", "2026-03-12T10:20:00.000Z", task.id, { requestId: "approval-a", decision: "approved", actor: "reviewer" }),
      buildEvent(runId, "event-request-b", "approval_requested", "2026-03-12T10:30:00.000Z", task.id, { requestId: "approval-b" }),
    ],
    timeline: [],
    artifacts: [{
      taskId: task.id,
      taskTitle: task.title,
      artifacts: [
        {
          id: "artifact-request-a",
          taskId: task.id,
          kind: "approval_record",
          uri: "artifact://approval-a/request",
          summary: "Approval requested for publish.",
          createdAt: "2026-03-12T10:05:00.000Z",
          metadata: {
            requestId: "approval-a",
            reason: "Publish the release package.",
            actionPlans: [{
              id: "action-a",
              kind: "deploy",
              command: "npm",
              args: ["publish"],
              cwd: "/workspace",
              targets: ["registry"],
              riskLevel: "high",
              requiresApproval: true,
              reason: "Publishes the package to the registry.",
            }],
          },
        },
        {
          id: "artifact-decision-a",
          taskId: task.id,
          kind: "approval_record",
          uri: "artifact://approval-a/decision",
          summary: "Approval approved for request approval-a.",
          createdAt: "2026-03-12T10:20:00.000Z",
          metadata: {
            requestId: "approval-a",
            decision: "approved",
            actor: "reviewer",
            note: "Looks safe.",
            decisionRecord: {
              decidedAt: "2026-03-12T10:20:00.000Z",
              actor: "reviewer",
              note: "Looks safe.",
            },
          },
        },
        {
          id: "artifact-request-b",
          taskId: task.id,
          kind: "approval_record",
          uri: "artifact://approval-b/request",
          summary: "Approval requested for force push.",
          createdAt: "2026-03-12T10:30:00.000Z",
          metadata: {
            requestId: "approval-b",
            reason: "Force-push the release branch.",
            actionPlans: [{
              id: "action-b",
              kind: "git_push",
              command: "git",
              args: ["push", "--force"],
              cwd: "/workspace",
              targets: ["origin/release"],
              riskLevel: "medium",
              requiresApproval: true,
              reason: "Rewrites remote branch history.",
            }],
          },
        },
      ],
    }],
    blackboard: [],
    validation: [],
    approvals: [
      {
        requestId: "approval-a",
        taskId: task.id,
        summary: "Publish the release package.",
        state: "approved",
        actor: "reviewer",
        decidedAt: "2026-03-12T10:20:00.000Z",
        riskLevel: "high",
      },
      {
        requestId: "approval-b",
        taskId: task.id,
        summary: "Force-push the release branch.",
        state: "pending",
        riskLevel: "medium",
      },
    ],
    summary: {
      runStatus: run.status,
      completedTasks: 0,
      failedTasks: 0,
      blockedTasks: 0,
      pendingApprovals: 1,
    },
  };

  const projection = buildApprovalQueueProjection([inspection]);

  assert.equal(projection.summary.totalCount, 2);
  assert.equal(projection.summary.pendingCount, 1);
  assert.equal(projection.summary.approvedCount, 1);
  assert.deepEqual(projection.items.map((item) => item.requestId), ["approval-b", "approval-a"]);

  const pending = projection.items[0]!;
  assert.equal(pending.summary, "Force-push the release branch.");
  assert.equal(pending.session?.sessionId, "backfill:task-a:attempt:1");
  assert.equal(pending.session?.label, "Attempt 1");
  assert.equal(pending.actionPlans[0]?.command, "git");
  assert.equal(pending.riskLevel, "medium");

  const approved = projection.items[1]!;
  assert.equal(approved.actor, "reviewer");
  assert.equal(approved.note, "Looks safe.");
  assert.equal(approved.decidedAt, "2026-03-12T10:20:00.000Z");
  assert.equal(approved.actionPlanCount, 1);
  assert.equal(approved.actionPlans[0]?.kind, "deploy");
});
