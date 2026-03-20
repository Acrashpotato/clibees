import type {
  MessageThreadRecord,
  SessionMessageRecord,
  TaskSessionRecord,
  RunEvent,
  RunInspection,
  TaskSpec,
} from "../domain/models.js";
import type { ManagerChatProjectionView } from "./models.js";
import { mapRunStatus, mapTaskStatus, resolveTaskAgentId, resolveTaskId } from "./task-view-helpers.js";

export interface ManagerChatProjectionInput {
  sessions: TaskSessionRecord[];
  threads: MessageThreadRecord[];
  messages: SessionMessageRecord[];
}

export function buildManagerChatProjection(
  inspection: RunInspection,
  input: ManagerChatProjectionInput,
): ManagerChatProjectionView {
  const managerSession = input.sessions.find((session) => session.scope === "manager_primary");
  const managerThread =
    (managerSession
      ? input.threads.find((thread) => thread.threadId === managerSession.threadId)
      : undefined) ?? input.threads.find((thread) => thread.scope === "manager_primary");
  const managerThreadId = managerSession?.threadId ?? managerThread?.threadId;

  const timeline =
    managerThreadId &&
    input.messages.some((message) => message.threadId === managerThreadId)
      ? input.messages
          .filter((message) => message.threadId === managerThreadId)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .map((message) => ({
            messageId: message.messageId,
            threadId: message.threadId,
            ...(message.sessionId ? { sessionId: message.sessionId } : {}),
            role: message.role,
            actorId: message.actorId,
            body: message.body,
            createdAt: message.createdAt,
            ...(message.replyToMessageId ? { replyToMessageId: message.replyToMessageId } : {}),
            sourceMode: "session_message" as const,
          }))
      : buildTimelineFromEvents(inspection.events, inspection.graph.tasks);

  const workerQueue = Object.values(inspection.graph.tasks)
    .filter((task) => !isDelegationManagerTask(task))
    .map((task) => {
      const scopedEvents = inspection.events.filter((event) => resolveTaskId(event) === task.id);
      const latestEvent = scopedEvents.at(-1);
      const latestSession = input.sessions
        .filter((session) => session.taskId === task.id && session.role === "worker")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      return {
        taskId: task.id,
        title: task.title,
        status: mapTaskStatus(task.status),
        agentId: resolveTaskAgentId(task),
        lastActivityAt: latestEvent?.timestamp ?? inspection.run.updatedAt,
        ...(latestSession ? { sessionId: latestSession.sessionId } : {}),
        ...(readTaskSkillId(task) ? { skillId: readTaskSkillId(task) } : {}),
      };
    })
    .sort(
      (left, right) =>
        statusOrder(left.status) - statusOrder(right.status) ||
        right.lastActivityAt.localeCompare(left.lastActivityAt),
    );

  const pendingApprovals = inspection.approvals
    .filter((approval) => approval.state === "pending")
    .map((approval) => ({
      requestId: approval.requestId,
      ...(approval.taskId ? { taskId: approval.taskId } : {}),
      summary: approval.summary,
      riskLevel:
        (approval.riskLevel ?? "none") as ManagerChatProjectionView["pendingApprovals"][number]["riskLevel"],
      ...(resolveApprovalRequestedAt(inspection.events, approval.requestId)
        ? { requestedAt: resolveApprovalRequestedAt(inspection.events, approval.requestId) }
        : {}),
    }))
    .sort((left, right) => (right.requestedAt ?? "").localeCompare(left.requestedAt ?? ""));

  return {
    projection: "manager_chat",
    generatedAt: new Date().toISOString(),
    run: {
      runId: inspection.run.runId,
      goal: inspection.run.goal,
      status: mapRunStatus(inspection.run.status),
      createdAt: inspection.run.createdAt,
      updatedAt: inspection.run.updatedAt,
    },
    ...(managerSession && managerThreadId
      ? {
          managerSession: {
            sessionId: managerSession.sessionId,
            threadId: managerThreadId,
            sourceMode: "task_session" as const,
          },
        }
      : managerThreadId
        ? {
            managerSession: {
              sessionId: "manager_primary",
              threadId: managerThreadId,
              sourceMode: "run_event_backfill" as const,
            },
          }
        : {}),
    timeline,
    workerQueue,
    pendingApprovals,
  };
}

function buildTimelineFromEvents(
  events: RunEvent[],
  tasks: Record<string, TaskSpec>,
): ManagerChatProjectionView["timeline"] {
  return events
    .filter((event) => event.type === "agent_message")
    .map((event) => {
      const payload = event.payload as {
        agentId?: unknown;
        message?: unknown;
        role?: unknown;
        threadId?: unknown;
        sessionId?: unknown;
        messageId?: unknown;
        replyToMessageId?: unknown;
      };
      const taskId = resolveTaskId(event);
      const task = taskId ? tasks[taskId] : undefined;
      const role = normalizeRole(payload.role, task);
      return {
        messageId:
          typeof payload.messageId === "string" ? payload.messageId : event.id,
        threadId:
          typeof payload.threadId === "string" ? payload.threadId : "manager_primary",
        ...(typeof payload.sessionId === "string" ? { sessionId: payload.sessionId } : {}),
        role,
        actorId:
          typeof payload.agentId === "string" ? payload.agentId : role === "user" ? "user" : "system",
        body:
          typeof payload.message === "string"
            ? payload.message
            : "Message content is unavailable in run-event backfill.",
        createdAt: event.timestamp,
        ...(typeof payload.replyToMessageId === "string"
          ? { replyToMessageId: payload.replyToMessageId }
          : {}),
        sourceMode: "run_event_backfill" as const,
      };
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function normalizeRole(
  value: unknown,
  task: TaskSpec | undefined,
): ManagerChatProjectionView["timeline"][number]["role"] {
  if (value === "user" || value === "manager" || value === "worker" || value === "system") {
    return value;
  }
  if (task && isDelegationManagerTask(task)) {
    return "manager";
  }
  if (task) {
    return "worker";
  }
  return "system";
}

function resolveApprovalRequestedAt(events: RunEvent[], requestId: string): string | undefined {
  return events.find((event) => {
    if (event.type !== "approval_requested") {
      return false;
    }
    const payload = event.payload as { requestId?: unknown };
    return payload.requestId === requestId;
  })?.timestamp;
}

function isDelegationManagerTask(task: TaskSpec): boolean {
  return (
    task.kind === "plan" &&
    task.requiredCapabilities.includes("planning") &&
    task.requiredCapabilities.includes("delegation")
  );
}

function statusOrder(status: ManagerChatProjectionView["workerQueue"][number]["status"]): number {
  switch (status) {
    case "running":
      return 0;
    case "awaiting_approval":
      return 1;
    case "paused":
      return 2;
    case "blocked":
      return 3;
    case "failed":
      return 4;
    case "completed":
      return 5;
    default:
      return 6;
  }
}

function readTaskSkillId(task: TaskSpec): string | undefined {
  const skillId = task.metadata?.skillId;
  return typeof skillId === "string" && skillId.trim().length > 0
    ? skillId.trim()
    : undefined;
}
