import { stat } from "node:fs/promises";
import type { RunGraph, RunRecord, TaskSpec } from "../../../domain/models.js";
import { createDefaultConfig } from "../../../config/default-config.js";
import {
  createStateLayout,
  getTaskTranscriptPath,
} from "../../../storage/state-layout.js";
import { createId, isoNow, pathExists, resolvePath } from "../../../shared/runtime.js";
import type {
  ExecutionServices,
  PostThreadMessageInput,
  PostThreadMessageResult,
} from "../core.js";
import { MAX_MANAGER_COORDINATION_TASKS } from "../core.js";
import {
  classifyManagerUserMessageIntent,
  countActiveManagerCoordinationTasks,
  isAutoResumableRunStatus,
  isManagerCoordinationTask,
  isTerminalRunStatus,
  type ManagerUserMessageIntent,
  readNonEmptyString,
  shouldUseDelegatedBootstrap,
} from "../helpers/index.js";
import type { ExecutionRuntime } from "../../../execution/execution-runtime.js";

export async function postThreadMessage(
  this: any,
  runId: string,
  threadId: string,
  input: PostThreadMessageInput,
): Promise<PostThreadMessageResult> {
  const run = await this.dependencies.runStore.getRun(runId);
  const graph = await this.dependencies.runStore.getGraph(runId);
  if (!run || !graph) {
    throw new Error(`Run "${runId}" was not found.`);
  }
  if (isTerminalRunStatus(run.status)) {
    throw new Error(`Run "${runId}" is ${run.status} and cannot accept new messages.`);
  }

  const thread = await this.dependencies.sessionStore.getThread(runId, threadId);
  if (!thread) {
    throw new Error(`Thread "${threadId}" was not found in run "${runId}".`);
  }

  const session =
    typeof thread.sessionId === "string" && thread.sessionId.length > 0
      ? await this.dependencies.sessionStore.getSession(runId, thread.sessionId)
      : null;
  const runConfig = this.resolveRunExecutionConfig(run, createDefaultConfig(run.workspacePath));
  const services = this.resolveExecutionServices(run, runConfig);
  let latestRun = await this.autoPauseStalledRunIfNeeded(
    run,
    graph,
    services,
    "postThreadMessage",
  );
  let latestGraph = (await this.dependencies.runStore.getGraph(runId)) ?? graph;
  const message = await this.appendThreadMessageWithAudit(
    latestRun,
    services,
    {
      runId,
      threadId,
      role: this.resolveIncomingMessageRole(latestRun, session, input.actorId),
      body: input.body.trim(),
      actorId: input.actorId.trim() || "console-user",
      ...(session ? { sessionId: session.sessionId } : {}),
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
      ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      metadata: {
        source: "thread_api",
        ...(input.note ? { note: input.note } : {}),
      },
    },
    session?.taskId,
  );

  latestRun = (await this.dependencies.runStore.getRun(runId)) ?? latestRun;
  latestGraph = (await this.dependencies.runStore.getGraph(runId)) ?? latestGraph;
  let resumed = false;

  if (thread.scope === "manager_primary" && shouldUseDelegatedBootstrap(run.metadata)) {
    const isRunningUserMessagePath =
      latestRun.status === "running" &&
      message.role === "user";

    if (isRunningUserMessagePath) {
      const userIntent = classifyManagerUserMessageIntent(message.body);
      if (userIntent === "replan_request") {
        latestGraph = await this.enqueueManagerCoordinationTask(
          latestRun,
          latestGraph,
          message,
          services,
          {
            activeManagerStrategy: "append_followup",
            triggerIntent: userIntent,
          },
        );
        latestGraph = (await this.dependencies.runStore.getGraph(runId)) ?? latestGraph;
        latestRun = (await this.dependencies.runStore.getRun(runId)) ?? latestRun;
        const coordinationTaskForMessage = (Object.values(latestGraph.tasks) as TaskSpec[]).find((task) => {
          if (!isManagerCoordinationTask(task)) {
            return false;
          }
          return task.metadata?.triggerMessageId === message.messageId;
        });
        const activeCoordinationCount = countActiveManagerCoordinationTasks(latestGraph);
        const isCoordinationQueueSaturated =
          !coordinationTaskForMessage &&
          activeCoordinationCount >= MAX_MANAGER_COORDINATION_TASKS;
        const managerActorId =
          readNonEmptyString(latestRun.metadata.plannerAgentId) ??
          session?.agentId ??
          "manager";
        const managerAckBody = isCoordinationQueueSaturated
          ? "Acknowledged. The manager coordination queue is currently saturated; I will continue after pending coordination tasks complete."
          : "Acknowledged. I will continue coordination after the current execution step completes.";
        await this.appendThreadMessageWithAudit(
          latestRun,
          services,
          {
            runId,
            threadId,
            role: "manager",
            body: managerAckBody,
            actorId: managerActorId,
            sessionId: session?.sessionId,
            clientRequestId: `manager-ack:${message.messageId}`,
            metadata: {
              source: "manager_ack",
              triggerMessageId: message.messageId,
              coordinationQueued: Boolean(coordinationTaskForMessage),
              coordinationQueueSaturated: isCoordinationQueueSaturated,
              intent: userIntent,
            },
          },
          session?.taskId,
        );
        latestRun = (await this.dependencies.runStore.getRun(runId)) ?? latestRun;
      } else {
        const managerActorId =
          readNonEmptyString(latestRun.metadata.plannerAgentId) ??
          session?.agentId ??
          "manager";
        const progressReply = this.buildManagerRunningStatusReply(
          latestRun,
          latestGraph,
          userIntent,
        );
        await this.appendThreadMessageWithAudit(
          latestRun,
          services,
          {
            runId,
            threadId,
            role: "manager",
            body: progressReply,
            actorId: managerActorId,
            sessionId: session?.sessionId,
            clientRequestId: `manager-progress:${message.messageId}`,
            metadata: {
              source: "manager_progress",
              triggerMessageId: message.messageId,
              intent: userIntent,
              coordinationQueued: false,
            },
          },
          session?.taskId,
        );
        latestRun = (await this.dependencies.runStore.getRun(runId)) ?? latestRun;
      }
    } else {
      const triggerIntent =
        message.role === "user"
          ? classifyManagerUserMessageIntent(message.body)
          : undefined;
      latestGraph = await this.enqueueManagerCoordinationTask(
        latestRun,
        latestGraph,
        message,
        services,
        {
          activeManagerStrategy: "skip_if_active",
          ...(triggerIntent ? { triggerIntent } : {}),
        },
      );
      latestGraph = (await this.dependencies.runStore.getGraph(runId)) ?? latestGraph;
      latestRun = (await this.dependencies.runStore.getRun(runId)) ?? latestRun;
    }

    if (!isRunningUserMessagePath && isAutoResumableRunStatus(latestRun.status)) {
      try {
        latestRun = await this.resumeRun(runId, { config: runConfig });
        resumed = true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.appendThreadMessageWithAudit(
          latestRun,
          services,
          {
            runId,
            threadId,
            role: "system",
            body: `Auto resume attempted but failed: ${errorMessage}`,
            actorId: "system",
            sessionId: session?.sessionId,
            clientRequestId: `resume-failed:${createId("request")}`,
            metadata: {
              source: "auto_resume",
              error: errorMessage,
            },
          },
          session?.taskId,
        );
        latestRun = (await this.dependencies.runStore.getRun(runId)) ?? latestRun;
      }
    }
  }

  return {
    run: latestRun,
    thread,
    message,
    resumed,
  };
}

const RUN_HEALTH_STALL_THRESHOLD_MS = 90_000;

export async function autoPauseStalledRunIfNeeded(
  this: any,
  run: RunRecord,
  graph: RunGraph,
  services: ExecutionServices,
  source: "inspect" | "postThreadMessage" | "resume",
): Promise<RunRecord> {
  if (run.status !== "running") {
    return run;
  }

  const currentTaskId = readNonEmptyString(run.currentTaskId);
  if (!currentTaskId) {
    return run;
  }
  const currentTask = graph.tasks[currentTaskId];
  if (!currentTask) {
    return run;
  }
  const activeTaskStatuses = new Set([
    "routing",
    "context_building",
    "queued",
    "running",
    "validating",
  ]);
  if (!activeTaskStatuses.has(currentTask.status)) {
    return run;
  }

  const lastEvent = await this.dependencies.eventStore.last(run.runId);
  const taskRecord = await this.dependencies.runStore.getTaskRecord(run.runId, currentTaskId);
  const latestProgressTimestampMs = this.maxTimestampMs([
    run.updatedAt,
    taskRecord?.startedAt,
    lastEvent?.timestamp,
  ]);
  if (latestProgressTimestampMs === null) {
    return run;
  }
  const nowMs = Date.now();
  if (nowMs - latestProgressTimestampMs <= RUN_HEALTH_STALL_THRESHOLD_MS) {
    return run;
  }

  const runtime = services.executionRuntime as ExecutionRuntime & {
    isTaskActive?: (runId: string, taskId: string) => boolean;
  };
  const hasActiveExecution =
    typeof runtime.isTaskActive === "function"
      ? runtime.isTaskActive(run.runId, currentTaskId)
      : false;
  if (hasActiveExecution) {
    return run;
  }

  const heartbeatAgeMs = await this.readTaskTranscriptHeartbeatAgeMs(run, currentTaskId);
  if (
    heartbeatAgeMs !== null &&
    heartbeatAgeMs <= RUN_HEALTH_STALL_THRESHOLD_MS
  ) {
    return run;
  }

  const pausedRun = await this.updateRunRecord(run, "paused", currentTaskId);
  if (!shouldUseDelegatedBootstrap(run.metadata)) {
    return pausedRun;
  }

  try {
    const latestGraph = (await this.dependencies.runStore.getGraph(run.runId)) ?? graph;
    const { session } = await this.ensureDelegatedManagerSession(pausedRun, latestGraph);
    const managerActorId =
      readNonEmptyString(pausedRun.metadata.plannerAgentId) ??
      session.agentId ??
      "manager";
    await this.appendThreadMessageWithAudit(
      pausedRun,
      services,
      {
        runId: pausedRun.runId,
        threadId: session.threadId,
        sessionId: session.sessionId,
        role: "system",
        actorId: "system",
        body: `Run health check detected stalled execution for task "${currentTask.title}" and moved the run to paused (possible orchestrator interruption). Source: ${source}.`,
        clientRequestId: `health-check-paused:${pausedRun.runId}:${currentTaskId}:${isoNow()}`,
        metadata: {
          source: "health_check",
          trigger: source,
          taskId: currentTaskId,
          managerActorId,
        },
      },
      currentTaskId,
    );
  } catch {
    // Best effort status note only.
  }

  return pausedRun;
}

export function buildManagerRunningStatusReply(
  this: any,
  run: RunRecord,
  graph: RunGraph,
  intent: ManagerUserMessageIntent,
): string {
  const counters: Record<string, number> = {
    running: 0,
    ready: 0,
    pending: 0,
    completed: 0,
    failed: 0,
  };
  for (const task of Object.values(graph.tasks)) {
    if (task.status === "running") {
      counters.running += 1;
    } else if (task.status === "ready") {
      counters.ready += 1;
    } else if (task.status === "pending") {
      counters.pending += 1;
    } else if (task.status === "completed") {
      counters.completed += 1;
    } else if (
      task.status === "failed_retryable" ||
      task.status === "failed_terminal" ||
      task.status === "blocked"
    ) {
      counters.failed += 1;
    }
  }
  const currentTaskId = readNonEmptyString(run.currentTaskId);
  const currentTaskTitle =
    currentTaskId && graph.tasks[currentTaskId]
      ? graph.tasks[currentTaskId].title
      : "n/a";
  const intentPrefix =
    intent === "progress_query"
      ? "Progress update only. I did not queue new delegation."
      : "Plan unchanged by default. I did not queue new delegation.";

  return `${intentPrefix} Run status=${run.status}; tasks: running=${counters.running}, ready=${counters.ready}, pending=${counters.pending}, completed=${counters.completed}, failed=${counters.failed}; current task="${currentTaskTitle}". Send an explicit replan request (e.g. 重做/改需求/换一版) to trigger new delegation.`;
}

export async function readTaskTranscriptHeartbeatAgeMs(
  this: any,
  run: RunRecord,
  taskId: string,
): Promise<number | null> {
  const stateLayout = createStateLayout(resolvePath(".multi-agent/state", run.workspacePath));
  const transcriptPath = getTaskTranscriptPath(stateLayout, run.runId, taskId);
  if (!(await pathExists(transcriptPath))) {
    return null;
  }
  try {
    const transcriptStats = await stat(transcriptPath);
    return Math.max(0, Date.now() - transcriptStats.mtimeMs);
  } catch {
    return null;
  }
}

export function maxTimestampMs(
  this: any,
  values: Array<string | undefined | null>,
): number | null {
  let maxValue: number | null = null;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    if (maxValue === null || parsed > maxValue) {
      maxValue = parsed;
    }
  }
  return maxValue;
}
