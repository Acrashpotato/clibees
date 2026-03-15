import test from "node:test";
import assert from "node:assert/strict";
import type { RunEvent, RunGraph, RunInspection, RunRecord, TaskSpec } from "../domain/models.js";
import { SCHEMA_VERSION } from "../domain/models.js";
import { buildAuditTimelineProjection } from "./build-audit-timeline-projection.js";

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
    validator: { mode: "command", commands: ["npm test"] },
    riskLevel: "medium",
    allowedActions: [],
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: [],
    },
    status: "completed",
  };
}

function buildEvent(
  runId: string,
  eventId: string,
  type: RunEvent["type"],
  timestamp: string,
  taskId: string | undefined,
  payload: Record<string, unknown>,
): RunEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: eventId,
    type,
    runId,
    ...(taskId ? { taskId } : {}),
    timestamp,
    payload,
  };
}

test("buildAuditTimelineProjection groups timeline, approvals, validations, artifacts, replans, and session events", () => {
  const runId = "run-audit-projection";
  const task = buildTask("task-a");
  const run: RunRecord = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    goal: "Ship the release",
    status: "completed",
    workspacePath: process.cwd().replace(/\\/g, "/"),
    currentTaskId: task.id,
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:40:00.000Z",
    metadata: {},
  };
  const graph: RunGraph = {
    runId,
    schemaVersion: SCHEMA_VERSION,
    revision: 4,
    tasks: {
      [task.id]: task,
    },
    edges: [],
    readyQueue: [],
    completedTaskIds: [task.id],
    failedTaskIds: [],
    cancelledTaskIds: [],
    metadata: {},
  };

  const events: RunEvent[] = [
    buildEvent(runId, "event-start", "task_started", "2026-03-12T10:00:00.000Z", task.id, { agentId: "release-agent" }),
    buildEvent(runId, "event-selected", "agent_selected", "2026-03-12T10:01:00.000Z", task.id, { summary: "Picked the release agent." }),
    buildEvent(runId, "event-context", "context_built", "2026-03-12T10:02:00.000Z", task.id, { summary: "Prepared release context." }),
    buildEvent(runId, "event-invocation", "invocation_planned", "2026-03-12T10:03:00.000Z", task.id, { command: "npm", args: ["publish"], cwd: "/workspace" }),
    buildEvent(runId, "event-approval-request", "approval_requested", "2026-03-12T10:05:00.000Z", task.id, { requestId: "approval-a", summary: "Publish the package." }),
    buildEvent(runId, "event-approval-decision", "approval_decided", "2026-03-12T10:07:00.000Z", task.id, { requestId: "approval-a", decision: "approved", actor: "reviewer" }),
    buildEvent(runId, "event-artifact", "artifact_created", "2026-03-12T10:10:00.000Z", task.id, { artifactId: "artifact-command", summary: "Persisted command result." }),
    buildEvent(runId, "event-validation", "validation_passed", "2026-03-12T10:15:00.000Z", task.id, { summary: "Smoke tests passed." }),
    buildEvent(runId, "event-complete", "task_completed", "2026-03-12T10:16:00.000Z", task.id, { summary: "Release package shipped." }),
    buildEvent(runId, "event-replan-request", "replan_requested", "2026-03-12T10:30:00.000Z", undefined, { summary: "Add a cleanup task.", reasons: ["Post-release cleanup was missed."] }),
    buildEvent(runId, "event-replan-applied", "replan_applied", "2026-03-12T10:35:00.000Z", undefined, { summary: "Cleanup task appended." }),
  ];

  const inspection: RunInspection = {
    run,
    graph,
    events,
    timeline: [],
    artifacts: [{
      taskId: task.id,
      taskTitle: task.title,
      artifacts: [
        {
          id: "artifact-approval-request",
          taskId: task.id,
          kind: "approval_record",
          uri: "artifact://approval/request",
          summary: "Approval requested for publish.",
          createdAt: "2026-03-12T10:05:00.000Z",
          metadata: {
            requestId: "approval-a",
            reason: "Publish the package.",
            actionPlans: [{
              id: "action-a",
              kind: "deploy",
              command: "npm",
              args: ["publish"],
              cwd: "/workspace",
              targets: ["registry"],
              riskLevel: "high",
              requiresApproval: true,
              reason: "Publishes to the public registry.",
            }],
          },
        },
        {
          id: "artifact-approval-decision",
          taskId: task.id,
          kind: "approval_record",
          uri: "artifact://approval/decision",
          summary: "Approval approved for publish.",
          createdAt: "2026-03-12T10:07:00.000Z",
          metadata: {
            requestId: "approval-a",
            decision: "approved",
            actor: "reviewer",
            note: "Looks safe.",
            decisionRecord: {
              decidedAt: "2026-03-12T10:07:00.000Z",
              actor: "reviewer",
              note: "Looks safe.",
            },
          },
        },
        {
          id: "artifact-command",
          taskId: task.id,
          kind: "command_result",
          uri: "artifact://command/publish",
          summary: "npm publish exited successfully.",
          createdAt: "2026-03-12T10:10:00.000Z",
          metadata: {
            invocation: {
              command: "npm",
              args: ["publish"],
              cwd: "/workspace",
            },
            payload: {
              exitCode: 0,
            },
          },
        },
        {
          id: "artifact-validation",
          taskId: task.id,
          kind: "validation_result",
          uri: "artifact://validation/smoke",
          summary: "Smoke tests passed.",
          createdAt: "2026-03-12T10:15:00.000Z",
          metadata: {
            outcome: "pass",
            details: ["Registry publish verified."],
          },
        },
      ],
    }],
    blackboard: [],
    validation: [{
      taskId: task.id,
      taskTitle: task.title,
      taskStatus: task.status,
      outcome: "pass",
      summary: "Smoke tests passed.",
      details: ["Registry publish verified."],
      updatedAt: "2026-03-12T10:15:00.000Z",
    }],
    approvals: [{
      requestId: "approval-a",
      taskId: task.id,
      summary: "Publish the package.",
      state: "approved",
      actor: "reviewer",
      decidedAt: "2026-03-12T10:07:00.000Z",
      riskLevel: "high",
    }],
    summary: {
      runStatus: run.status,
      completedTasks: 1,
      failedTasks: 0,
      blockedTasks: 0,
      pendingApprovals: 0,
      latestReplan: "Cleanup task appended.",
      latestValidation: "Smoke tests passed.",
    },
  };

  const projection = buildAuditTimelineProjection(inspection);

  assert.equal(projection.summary.totalEventCount, 11);
  assert.equal(projection.summary.approvalEventCount, 2);
  assert.equal(projection.summary.validationEventCount, 1);
  assert.equal(projection.summary.artifactEventCount, 1);
  assert.equal(projection.summary.replanCount, 2);
  assert.equal(projection.summary.sessionEventCount, 5);
  assert.equal(projection.entries[0]?.type, "replan_applied");

  const approvalEntry = projection.entries.find((entry) => entry.type === "approval_requested");
  assert.equal(approvalEntry?.sessionId, "backfill:task-a:attempt:1");
  assert.equal(approvalEntry?.approvalRequestId, "approval-a");

  assert.equal(projection.approvals[0]?.requestId, "approval-a");
  assert.equal(projection.approvals[0]?.sessionId, "backfill:task-a:attempt:1");
  assert.equal(projection.approvals[0]?.note, "Looks safe.");

  assert.equal(projection.validations[0]?.taskId, task.id);
  assert.equal(projection.validations[0]?.sessionId, "backfill:task-a:attempt:1");

  assert.equal(projection.artifacts[0]?.taskId, task.id);
  assert.equal(projection.artifacts[0]?.highlights[1]?.artifactId, "artifact-command");
  assert.equal(projection.artifacts[0]?.highlights[1]?.sessionId, "backfill:task-a:attempt:1");

  assert.equal(projection.replans[0]?.type, "replan_applied");
  assert.equal(projection.replans[1]?.type, "replan_requested");

  assert.deepEqual(
    projection.sessionEvents.map((event) => event.type),
    ["task_completed", "invocation_planned", "context_built", "agent_selected", "task_started"],
  );
});
