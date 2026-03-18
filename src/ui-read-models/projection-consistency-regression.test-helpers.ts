import type { RunEvent, RunGraph, RunInspection, RunRecord, TaskSpec } from "../domain/models.js";
import { SCHEMA_VERSION } from "../domain/models.js";

export function buildTask(options: {
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

export function buildEvent(
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

export function buildInspectionFixture(): {
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
