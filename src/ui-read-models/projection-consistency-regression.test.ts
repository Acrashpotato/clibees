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

function buildTask(options: {
  taskId: string;
  title: string;
  status: TaskSpec["status"];
  dependsOn?: string[];
  requiredCapabilities?: string[];
  assignedAgent?: string;
  riskLevel?: TaskSpec["riskLevel"];
  maxAttempts?: number;
  validator?: TaskSpec["validator"];
}): TaskSpec {
  return {
    id: options.taskId,
    title: options.title,
    kind: "execute",
    goal: options.title,
    instructions: [],
    inputs: [],
    dependsOn: options.dependsOn ?? [],
    requiredCapabilities: options.requiredCapabilities ?? ["general"],
    ...(options.assignedAgent ? { assignedAgent: options.assignedAgent } : {}),
    workingDirectory: ".",
    expectedArtifacts: [],
    acceptanceCriteria: [],
    validator: options.validator ?? { mode: "none" },
    riskLevel: options.riskLevel ?? "medium",
    allowedActions: [],
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: options.maxAttempts ?? 1,
      backoffMs: 0,
      retryOn: [],
    },
    status: options.status,
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

function buildInspectionFixture(): {
  inspection: RunInspection;
  buildTaskId: string;
  reviewTaskId: string;
  buildSessionId: string;
  reviewAttemptOneSessionId: string;
  reviewAttemptTwoSessionId: string;
  approvalRequestId: string;
  reviewMessageEventId: string;
  reviewApprovalEventId: string;
  reviewArtifactEventId: string;
  reviewArtifactId: string;
} {
  const runId = "run-projection-consistency";
  const buildTaskId = "task-build";
  const reviewTaskId = "task-review";
  const approvalRequestId = "approval-review";
  const buildSessionId = `backfill:${encodeURIComponent(buildTaskId)}:attempt:1`;
  const reviewAttemptOneSessionId = `backfill:${encodeURIComponent(reviewTaskId)}:attempt:1`;
  const reviewAttemptTwoSessionId = `backfill:${encodeURIComponent(reviewTaskId)}:attempt:2`;
  const reviewMessageEventId = "event-review-message-2";
  const reviewApprovalEventId = "event-review-approval-request";
  const reviewArtifactEventId = "event-review-artifact";
  const reviewArtifactId = "artifact-review-command";

  const buildTaskSpec = buildTask({
    taskId: buildTaskId,
    title: "Build release candidate",
    status: "completed",
    assignedAgent: "builder-agent",
    requiredCapabilities: ["build"],
    riskLevel: "low",
    validator: { mode: "command", commands: ["npm run build"] },
  });
  const reviewTaskSpec = buildTask({
    taskId: reviewTaskId,
    title: "Review and publish release",
    status: "awaiting_approval",
    dependsOn: [buildTaskId],
    assignedAgent: "release-agent",
    requiredCapabilities: ["release"],
    riskLevel: "medium",
    maxAttempts: 2,
    validator: { mode: "command", commands: ["npm publish --dry-run"] },
  });

  const run: RunRecord = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    goal: "Ship the release safely.",
    status: "waiting_approval",
    workspacePath: process.cwd().replace(/\\/g, "/"),
    currentTaskId: reviewTaskId,
    createdAt: "2026-03-13T09:55:00.000Z",
    updatedAt: "2026-03-13T10:21:00.000Z",
    metadata: {},
  };
  const graph: RunGraph = {
    runId,
    schemaVersion: SCHEMA_VERSION,
    revision: 7,
    tasks: {
      [buildTaskId]: buildTaskSpec,
      [reviewTaskId]: reviewTaskSpec,
    },
    edges: [{ from: buildTaskId, to: reviewTaskId }],
    readyQueue: [],
    completedTaskIds: [buildTaskId],
    failedTaskIds: [],
    cancelledTaskIds: [],
    metadata: {},
  };

  const events: RunEvent[] = [
    buildEvent(runId, "event-build-start", "task_started", "2026-03-13T10:00:00.000Z", buildTaskId, { agentId: "builder-agent" }),
    buildEvent(runId, "event-build-message", "agent_message", "2026-03-13T10:02:00.000Z", buildTaskId, { agentId: "builder-agent", message: "Build finished successfully." }),
    buildEvent(runId, "event-build-command", "invocation_planned", "2026-03-13T10:03:00.000Z", buildTaskId, { command: "npm", args: ["run", "build"], cwd: "/workspace" }),
    buildEvent(runId, "event-build-artifact", "artifact_created", "2026-03-13T10:03:30.000Z", buildTaskId, { artifactId: "artifact-build-command", summary: "Persisted build command result." }),
    buildEvent(runId, "event-build-validation", "validation_passed", "2026-03-13T10:06:00.000Z", buildTaskId, { summary: "Release build verified." }),
    buildEvent(runId, "event-build-complete", "task_completed", "2026-03-13T10:07:00.000Z", buildTaskId, { summary: "Release build completed." }),
    buildEvent(runId, "event-review-start-1", "task_started", "2026-03-13T10:10:00.000Z", reviewTaskId, { agentId: "release-agent" }),
    buildEvent(runId, "event-review-message-1", "agent_message", "2026-03-13T10:11:00.000Z", reviewTaskId, { agentId: "release-agent", message: "First publish attempt failed." }),
    buildEvent(runId, "event-review-command-1", "invocation_planned", "2026-03-13T10:12:00.000Z", reviewTaskId, { command: "npm", args: ["publish", "--tag", "next"], cwd: "/workspace" }),
    buildEvent(runId, "event-review-failed-1", "task_failed", "2026-03-13T10:13:00.000Z", reviewTaskId, { summary: "Registry token expired." }),
    buildEvent(runId, "event-review-start-2", "task_started", "2026-03-13T10:15:00.000Z", reviewTaskId, { agentId: "release-agent" }),
    buildEvent(runId, "event-review-selected-2", "agent_selected", "2026-03-13T10:15:30.000Z", reviewTaskId, { summary: "Release agent resumed." }),
    buildEvent(runId, "event-review-context-2", "context_built", "2026-03-13T10:16:00.000Z", reviewTaskId, { summary: "Reloaded publish context." }),
    buildEvent(runId, reviewMessageEventId, "agent_message", "2026-03-13T10:17:00.000Z", reviewTaskId, { agentId: "release-agent", message: "Need approval before publishing.\nWaiting for reviewer.", transcriptPath: "transcripts/review-attempt-2.log" }),
    buildEvent(runId, "event-review-command-2", "invocation_planned", "2026-03-13T10:18:00.000Z", reviewTaskId, { command: "npm", args: ["publish", "--dry-run"], cwd: "/workspace" }),
    buildEvent(runId, reviewArtifactEventId, "artifact_created", "2026-03-13T10:19:00.000Z", reviewTaskId, { artifactId: reviewArtifactId, summary: "Persisted dry-run result." }),
    buildEvent(runId, reviewApprovalEventId, "approval_requested", "2026-03-13T10:20:00.000Z", reviewTaskId, { requestId: approvalRequestId, summary: "Publish release to npm." }),
    buildEvent(runId, "event-review-message-3", "agent_message", "2026-03-13T10:21:00.000Z", reviewTaskId, { agentId: "release-agent", message: "Approval queued for reviewer." }),
  ];

  const inspection: RunInspection = {
    run,
    graph,
    events,
    timeline: [],
    artifacts: [
      {
        taskId: buildTaskId,
        taskTitle: buildTaskSpec.title,
        artifacts: [
          {
            id: "artifact-build-command",
            taskId: buildTaskId,
            kind: "command_result",
            uri: "artifact://build/command",
            summary: "npm run build exited successfully.",
            createdAt: "2026-03-13T10:03:30.000Z",
            metadata: {
              invocation: {
                command: "npm",
                args: ["run", "build"],
                cwd: "/workspace",
              },
              payload: {
                exitCode: 0,
              },
            },
          },
          {
            id: "artifact-build-validation",
            taskId: buildTaskId,
            kind: "validation_result",
            uri: "artifact://build/validation",
            summary: "Release build verified.",
            createdAt: "2026-03-13T10:06:00.000Z",
            metadata: {
              outcome: "pass",
              details: ["Build artifacts verified."],
            },
          },
        ],
      },
      {
        taskId: reviewTaskId,
        taskTitle: reviewTaskSpec.title,
        artifacts: [
          {
            id: reviewArtifactId,
            taskId: reviewTaskId,
            kind: "command_result",
            uri: "artifact://review/command",
            summary: "npm publish --dry-run exited successfully.",
            createdAt: "2026-03-13T10:19:00.000Z",
            metadata: {
              invocation: {
                command: "npm",
                args: ["publish", "--dry-run"],
                cwd: "/workspace",
              },
              payload: {
                exitCode: 0,
              },
            },
          },
          {
            id: "artifact-review-approval-request",
            taskId: reviewTaskId,
            kind: "approval_record",
            uri: "artifact://approval-review/request",
            summary: "Approval requested for npm publish.",
            createdAt: "2026-03-13T10:20:00.000Z",
            metadata: {
              requestId: approvalRequestId,
              reason: "Publish release to npm.",
              actionPlans: [
                {
                  id: "action-publish",
                  kind: "deploy",
                  command: "npm",
                  args: ["publish"],
                  cwd: "/workspace",
                  targets: ["npm"],
                  riskLevel: "high",
                  requiresApproval: true,
                  reason: "Publishes the release package to npm.",
                },
              ],
            },
          },
        ],
      },
    ],
    blackboard: [],
    validation: [
      {
        taskId: buildTaskId,
        taskTitle: buildTaskSpec.title,
        taskStatus: buildTaskSpec.status,
        outcome: "pass",
        summary: "Release build verified.",
        details: ["Build artifacts verified."],
        updatedAt: "2026-03-13T10:06:00.000Z",
      },
    ],
    approvals: [
      {
        requestId: approvalRequestId,
        taskId: reviewTaskId,
        summary: "Publish release to npm.",
        state: "pending",
        riskLevel: "high",
      },
    ],
    summary: {
      runStatus: run.status,
      completedTasks: 1,
      failedTasks: 0,
      blockedTasks: 0,
      pendingApprovals: 1,
      latestFailure: "Registry token expired.",
      latestValidation: "Release build verified.",
    },
  };

  return {
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
  };
}

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
