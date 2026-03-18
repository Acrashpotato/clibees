import test from "node:test";
import assert from "node:assert/strict";
import type { RunEvent, RunGraph, RunInspection, RunRecord, TaskSpec } from "../domain/models.js";
import { SCHEMA_VERSION } from "../domain/models.js";
import { buildApprovalQueueProjection } from "./build-approval-queue-projection.js";
import { buildAuditTimelineProjection } from "./build-audit-timeline-projection.js";
import { buildRunListProjection } from "./build-run-list-projection.js";
import { buildSessionDetailProjection } from "./build-session-detail-projection.js";
import { buildTaskBoardProjection } from "./build-task-board-projection.js";
import { buildTaskDetailProjection } from "./build-task-detail-projection.js";
import { buildWorkspaceProjection } from "./build-workspace-projection.js";

import { buildEvent, buildInspectionFixture, buildTask } from "./projection-consistency-regression.test-helpers.js";

test("projection builders keep task, session, approval, artifact, validation, timeline, and message facts aligned", () => {
  const fixture = buildInspectionFixture();
  const {
    inspection,
    buildTaskId,
    reviewTaskId,
    buildSessionId,
    reviewAttemptOneSessionId,
    reviewAttemptTwoSessionId,
    approvalRequestId,
    reviewMessageEventId,
    reviewApprovalEventId,
    reviewArtifactEventId,
    reviewArtifactId,
  } = fixture;

  const runList = buildRunListProjection([inspection]);
  const workspace = buildWorkspaceProjection(inspection);
  const taskBoard = buildTaskBoardProjection(inspection);
  const reviewTaskDetail = buildTaskDetailProjection(inspection, reviewTaskId);
  const buildTaskDetail = buildTaskDetailProjection(inspection, buildTaskId);
  const reviewSessionDetail = buildSessionDetailProjection(inspection, reviewAttemptTwoSessionId);
  const buildSessionDetail = buildSessionDetailProjection(inspection, buildSessionId);
  const approvalQueue = buildApprovalQueueProjection([inspection]);
  const auditTimeline = buildAuditTimelineProjection(inspection);

  const reviewTaskNode = taskBoard.tasks.find((task) => task.taskId === reviewTaskId);
  const buildTaskNode = taskBoard.tasks.find((task) => task.taskId === buildTaskId);
  const approvalItem = approvalQueue.items.find((item) => item.requestId === approvalRequestId);
  const auditApprovalEntry = auditTimeline.entries.find((entry) => entry.eventId === reviewApprovalEventId);
  const auditArtifactEntry = auditTimeline.entries.find((entry) => entry.eventId === reviewArtifactEventId);
  const auditMessageEntry = auditTimeline.entries.find((entry) => entry.eventId === reviewMessageEventId);
  const auditApproval = auditTimeline.approvals.find((item) => item.requestId === approvalRequestId);
  const auditValidation = auditTimeline.validations.find((item) => item.taskId === buildTaskId);
  const auditReviewArtifacts = auditTimeline.artifacts.find((group) => group.taskId === reviewTaskId);
  const reviewArtifact = reviewTaskDetail.artifacts.highlights.find((item) => item.artifactId === reviewArtifactId);
  const reviewSessionArtifact = reviewSessionDetail.artifacts.items.find((item) => item.artifactId === reviewArtifactId);
  const auditReviewArtifact = auditReviewArtifacts?.highlights.find((item) => item.artifactId === reviewArtifactId);
  const workspaceMessage = workspace.pendingMessages.items.find((item) => item.id === reviewMessageEventId);

  assert.equal(runList.runs[0]?.pendingApprovalCount, 1);
  assert.equal(workspace.run.pendingApprovalCount, 1);
  assert.equal(taskBoard.summary.pendingApprovalCount, 1);
  assert.equal(approvalQueue.summary.pendingCount, 1);
  assert.equal(runList.runs[0]?.activeSessionCount, 1);
  assert.equal(workspace.run.activeSessionCount, 1);
  assert.equal(taskBoard.summary.activeSessionCount, 1);

  assert.equal(workspace.focusTask?.taskId, reviewTaskId);
  assert.equal(workspace.focusTask?.status, "awaiting_approval");
  assert.equal(workspace.focusTask?.statusReason, "Publish release to npm.");
  assert.equal(reviewTaskNode?.status, "awaiting_approval");
  assert.equal(reviewTaskNode?.statusReason, "Publish release to npm.");
  assert.equal(reviewTaskDetail.overview.status, "awaiting_approval");
  assert.equal(reviewTaskDetail.overview.statusReason, "Publish release to npm.");

  assert.equal(workspace.activeSession?.sessionId, reviewAttemptTwoSessionId);
  assert.equal(workspace.activeSession?.taskId, reviewTaskId);
  assert.equal(taskBoard.tasks.find((task) => task.taskId === reviewTaskId)?.activeSession?.sessionId, reviewAttemptTwoSessionId);
  assert.equal(reviewTaskDetail.sessions[0]?.sessionId, reviewAttemptTwoSessionId);
  assert.equal(reviewTaskDetail.sessions[1]?.sessionId, reviewAttemptOneSessionId);
  assert.equal(reviewSessionDetail.overview.sessionId, reviewAttemptTwoSessionId);
  assert.equal(reviewSessionDetail.overview.taskId, reviewTaskId);
  assert.equal(auditApprovalEntry?.sessionId, reviewAttemptTwoSessionId);
  assert.equal(auditMessageEntry?.sessionId, reviewAttemptTwoSessionId);
  assert.equal(auditArtifactEntry?.sessionId, reviewAttemptTwoSessionId);

  assert.equal(workspace.actionQueue[0]?.id, approvalRequestId);
  assert.equal(workspace.actionQueue[0]?.summary, "Publish release to npm.");
  assert.equal(reviewTaskDetail.latestApproval?.requestId, approvalRequestId);
  assert.equal(reviewTaskDetail.latestApproval?.state, "pending");
  assert.equal(reviewTaskDetail.latestApproval?.riskLevel, "high");
  assert.equal(reviewSessionDetail.approvals[0]?.requestId, approvalRequestId);
  assert.equal(reviewSessionDetail.approvals[0]?.state, "pending");
  assert.equal(reviewSessionDetail.approvals[0]?.riskLevel, "high");
  assert.equal(approvalItem?.session?.sessionId, reviewAttemptTwoSessionId);
  assert.equal(approvalItem?.state, "pending");
  assert.equal(approvalItem?.riskLevel, "high");
  assert.equal(approvalItem?.actionPlans[0]?.actionPlanId, "action-publish");
  assert.equal(auditApproval?.sessionId, reviewAttemptTwoSessionId);
  assert.equal(auditApproval?.state, "pending");
  assert.equal(auditApproval?.riskLevel, "high");

  assert.equal(buildTaskNode?.status, "completed");
  assert.equal(buildTaskDetail.overview.status, "completed");
  assert.equal(buildTaskDetail.validation.state, "pass");
  assert.equal(buildTaskDetail.validation.summary, "Release build verified.");
  assert.equal(buildSessionDetail.validation.state, "pass");
  assert.equal(buildSessionDetail.validation.summary, "Release build verified.");
  assert.equal(auditValidation?.summary, "Release build verified.");
  assert.equal(auditValidation?.sessionId, buildSessionId);

  assert.ok(reviewArtifact);
  assert.equal(reviewArtifact?.kind, "command_result");
  assert.equal(reviewArtifact?.uri, "artifact://review/command");
  assert.equal(reviewSessionArtifact?.artifactId, reviewArtifactId);
  assert.equal(reviewSessionArtifact?.uri, reviewArtifact?.uri);
  assert.equal(auditReviewArtifact?.artifactId, reviewArtifactId);
  assert.equal(auditReviewArtifact?.uri, reviewArtifact?.uri);
  assert.equal(auditReviewArtifact?.sessionId, reviewAttemptTwoSessionId);

  assert.equal(reviewSessionDetail.toolCalls[0]?.toolCallId, reviewArtifactId);
  assert.equal(reviewSessionDetail.toolCalls[0]?.status, "completed");
  assert.equal(reviewSessionDetail.toolCalls[1]?.toolCallId, "event-review-command-2");

  assert.equal(workspaceMessage?.taskId, reviewTaskId);
  assert.equal(workspaceMessage?.summary, "Need approval before publishing.");
  assert.equal(reviewSessionDetail.messages.at(-1)?.messageId, "event-review-message-3");
  assert.ok(reviewSessionDetail.messages.some((message) => message.messageId === reviewMessageEventId));
  assert.equal(auditMessageEntry?.taskId, reviewTaskId);
  assert.equal(auditMessageEntry?.eventId, reviewMessageEventId);

  assert.equal(auditApprovalEntry?.approvalRequestId, approvalRequestId);
  assert.equal(auditArtifactEntry?.artifactId, reviewArtifactId);
  assert.equal(auditApprovalEntry?.taskId, reviewTaskId);
  assert.equal(auditArtifactEntry?.taskId, reviewTaskId);
});



test("bridge session lifecycle stays aligned across task detail, session detail, and audit timeline", () => {
  const runId = "run-bridge-session-regression";
  const taskId = "task-bridge-session";
  const sessionId = `backfill:${encodeURIComponent(taskId)}:attempt:1`;
  const task = buildTask({
    taskId,
    title: "Verify bridge session chain",
    status: "completed",
    assignedAgent: "bridge-agent",
    requiredCapabilities: ["cli"],
    riskLevel: "medium",
    validator: { mode: "command", commands: ["npm test"] },
  });

  const run: RunRecord = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    goal: "Validate bridge session end-to-end regression coverage.",
    status: "completed",
    workspacePath: process.cwd().replace(/\\/g, "/"),
    currentTaskId: taskId,
    createdAt: "2026-03-15T08:00:00.000Z",
    updatedAt: "2026-03-15T08:07:00.000Z",
    metadata: {},
  };
  const graph: RunGraph = {
    runId,
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    tasks: {
      [taskId]: task,
    },
    edges: [],
    readyQueue: [],
    completedTaskIds: [taskId],
    failedTaskIds: [],
    cancelledTaskIds: [],
    metadata: {},
  };

  const events: RunEvent[] = [
    buildEvent(runId, "event-session-start", "task_started", "2026-03-15T08:01:00.000Z", taskId, {
      agentId: "bridge-agent",
    }),
    buildEvent(runId, "event-message-1", "agent_message", "2026-03-15T08:01:30.000Z", taskId, {
      agentId: "bridge-agent",
      message: "Booting bridge session.\nLoading context.",
      transcriptPath: "transcripts/bridge-session.log",
    }),
    buildEvent(runId, "event-tool-planned", "invocation_planned", "2026-03-15T08:02:00.000Z", taskId, {
      command: "npm",
      args: ["test"],
      cwd: "/workspace",
    }),
    buildEvent(runId, "event-message-2", "agent_message", "2026-03-15T08:02:30.000Z", taskId, {
      agentId: "bridge-agent",
      message: "Tests completed.",
    }),
    buildEvent(runId, "event-artifact", "artifact_created", "2026-03-15T08:03:00.000Z", taskId, {
      artifactId: "artifact-bridge-command",
      summary: "Persisted npm test output.",
    }),
    buildEvent(runId, "event-validation", "validation_passed", "2026-03-15T08:04:00.000Z", taskId, {
      summary: "Bridge session checks passed.",
    }),
    buildEvent(runId, "event-task-complete", "task_completed", "2026-03-15T08:05:00.000Z", taskId, {
      summary: "Bridge session completed successfully.",
    }),
  ];

  const inspection: RunInspection = {
    run,
    graph,
    events,
    timeline: [],
    artifacts: [
      {
        taskId,
        taskTitle: task.title,
        artifacts: [
          {
            id: "artifact-bridge-command",
            taskId,
            kind: "command_result",
            uri: "artifact://bridge/command",
            summary: "npm test exited successfully.",
            createdAt: "2026-03-15T08:03:00.000Z",
            metadata: {
              invocation: {
                command: "npm",
                args: ["test"],
                cwd: "/workspace",
              },
              payload: {
                exitCode: 0,
              },
            },
          },
          {
            id: "artifact-bridge-validation",
            taskId,
            kind: "validation_result",
            uri: "artifact://bridge/validation",
            summary: "Bridge session checks passed.",
            createdAt: "2026-03-15T08:04:00.000Z",
            metadata: {
              outcome: "pass",
              details: ["npm test exited successfully."],
            },
          },
        ],
      },
    ],
    blackboard: [],
    validation: [
      {
        taskId,
        taskTitle: task.title,
        taskStatus: task.status,
        outcome: "pass",
        summary: "Bridge session checks passed.",
        details: ["npm test exited successfully."],
        updatedAt: "2026-03-15T08:04:00.000Z",
      },
    ],
    approvals: [],
    summary: {
      runStatus: run.status,
      completedTasks: 1,
      failedTasks: 0,
      blockedTasks: 0,
      pendingApprovals: 0,
      latestValidation: "Bridge session checks passed.",
    },
  };

  const taskDetail = buildTaskDetailProjection(inspection, taskId);
  const sessionDetail = buildSessionDetailProjection(inspection, sessionId);
  const auditTimeline = buildAuditTimelineProjection(inspection);

  assert.equal(taskDetail.sessions[0]?.sessionId, sessionId);
  assert.equal(taskDetail.sessions[0]?.status, "completed");
  assert.equal(taskDetail.validation.state, "pass");
  assert.equal(taskDetail.validation.summary, "Bridge session checks passed.");

  assert.equal(sessionDetail.overview.sessionId, sessionId);
  assert.equal(sessionDetail.overview.taskId, taskId);
  assert.equal(sessionDetail.overview.status, "completed");
  assert.equal(sessionDetail.overview.transcriptPath, "transcripts/bridge-session.log");
  assert.deepEqual(
    sessionDetail.messages.map((message) => message.messageId),
    ["event-message-1", "event-message-2"],
  );
  assert.equal(sessionDetail.messages[0]?.text, "Booting bridge session.\nLoading context.");
  assert.ok(
    sessionDetail.toolCalls.some(
      (toolCall) =>
        toolCall.toolCallId === "artifact-bridge-command" &&
        toolCall.status === "completed" &&
        toolCall.command === "npm",
    ),
  );
  assert.ok(
    sessionDetail.toolCalls.some(
      (toolCall) =>
        toolCall.toolCallId === "event-tool-planned" &&
        toolCall.status === "planned" &&
        toolCall.command === "npm",
    ),
  );
  assert.equal(sessionDetail.validation.state, "pass");
  assert.equal(sessionDetail.validation.summary, "Bridge session checks passed.");
  assert.deepEqual(sessionDetail.terminalPreview.lines, [
    "Booting bridge session.",
    "Loading context.",
    "Tests completed.",
  ]);

  const startedEntry = auditTimeline.sessionEvents.find((entry) => entry.eventId === "event-session-start");
  const toolEntry = auditTimeline.entries.find((entry) => entry.eventId === "event-tool-planned");
  const validationEntry = auditTimeline.entries.find((entry) => entry.eventId === "event-validation");
  const commandArtifact = auditTimeline.artifacts
    .flatMap((group) => group.highlights)
    .find((artifact) => artifact.artifactId === "artifact-bridge-command");

  assert.equal(startedEntry?.sessionId, sessionId);
  assert.equal(startedEntry?.type, "task_started");
  assert.equal(toolEntry?.kind, "session");
  assert.equal(toolEntry?.sessionId, sessionId);
  assert.equal(validationEntry?.kind, "validation");
  assert.equal(validationEntry?.taskId, taskId);
  assert.equal(auditTimeline.validations[0]?.sessionId, sessionId);
  assert.equal(auditTimeline.validations[0]?.summary, "Bridge session checks passed.");
  assert.equal(commandArtifact?.sessionId, sessionId);
});
