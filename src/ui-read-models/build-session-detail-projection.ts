import type {
  InspectionApprovalItem,
  InspectionArtifactItem,
  InspectionValidationItem,
  RunEvent,
  RunInspection,
  TaskSpec,
  TaskStatus,
} from "../domain/models.js";
import type {
  SessionDetailArtifactSummaryView,
  SessionDetailProjectionView,
  SessionDetailToolCallItemView,
  SessionDetailValidationSummaryView,
  WorkspaceLaneStatus,
} from "./models.js";

export function buildSessionDetailProjection(
  inspection: RunInspection,
  sessionId: string,
): SessionDetailProjectionView {
  for (const task of Object.values(inspection.graph.tasks)) {
    const taskEvents = inspection.events
      .filter((event) => resolveTaskId(event) === task.id)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const windows = buildWindows(task, taskEvents);
    const match = windows.find((window) => window.sessionId === sessionId);
    if (!match) {
      continue;
    }
    const approvals = filterApprovals(
      inspection.approvals.filter((approval) => approval.taskId === task.id),
      taskEvents,
      match,
    );
    const artifacts = filterArtifacts(
      (inspection.artifacts.find((group) => group.taskId === task.id)?.artifacts ?? []),
      match,
    );
    const validation = inspection.validation.find((item) => item.taskId === task.id);
    const latestEvent = match.events.at(-1);
    const transcriptPath = resolveTranscriptPath(match.events);
    const status = resolveStatus(match, task.status, latestEvent);
    return {
      projection: "session_detail",
      generatedAt: new Date().toISOString(),
      runId: inspection.run.runId,
      graphRevision: inspection.graph.revision,
      sessionId,
      overview: {
        sessionId,
        taskId: task.id,
        taskTitle: task.title,
        taskKind: task.kind,
        status,
        statusReason: approvals[0]?.summary ?? summaryOf(latestEvent) ?? `Task is currently ${task.status}.`,
        agentId: resolveAgentId(match.events[0], task),
        ownerLabel: ownerOf(task),
        ...(match.startedAt ? { startedAt: match.startedAt } : {}),
        lastActivityAt: latestEvent?.timestamp ?? validation?.updatedAt ?? match.startedAt ?? inspection.run.updatedAt,
        latestActivitySummary: summaryOf(latestEvent) ?? validation?.summary ?? `Task is currently ${task.status}.`,
        pendingApprovalCount: approvals.filter((approval) => approval.state === "pending").length,
        ...(transcriptPath ? { transcriptPath } : {}),
        sourceMode: match.sourceMode,
      },
      messages: match.events
        .filter((event) => event.type === "agent_message")
        .map((event) => {
          const payload = event.payload as { agentId?: unknown; message?: unknown; stream?: unknown };
          return {
            messageId: event.id,
            timestamp: event.timestamp,
            stream: payload.stream === "stderr" ? "stderr" : "stdout",
            senderLabel: typeof payload.agentId === "string" ? payload.agentId : resolveAgentId(event, task),
            text: typeof payload.message === "string" ? payload.message : "Agent emitted a message without textual content.",
            sourceMode: "run_event_agent_message",
          };
        }),
      toolCalls: buildToolCalls(match.events, artifacts),
      approvals: approvals.map((approval) => ({
        requestId: approval.requestId,
        state: approval.state,
        summary: approval.summary,
        riskLevel: approval.riskLevel ?? "none",
        ...(requestedAt(taskEvents, approval.requestId) ? { requestedAt: requestedAt(taskEvents, approval.requestId) } : {}),
        ...(approval.decidedAt ? { decidedAt: approval.decidedAt } : {}),
        ...(approval.actor ? { actor: approval.actor } : {}),
        sourceMode: approval.state === "pending" ? "approval_request" : "inspection_approval",
      })),
      validation: buildValidation(validation, match, task.status, status),
      artifacts: buildArtifactSummary(artifacts),
      terminalPreview: {
        ...(transcriptPath ? { transcriptPath } : {}),
        lines: previewLines(match.events, task, validation),
        sourceMode: transcriptPath ? "transcript_stream" : match.events.some((event) => event.type === "agent_message") ? "agent_message_backfill" : "task_status_backfill",
      },
    };
  }
  throw new Error(`Session "${sessionId}" was not found in run "${inspection.run.runId}".`);
}

type Window = {
  sessionId: string;
  startedAt?: string;
  endExclusive?: string;
  sourceMode: "run_event_backfill" | "task_status_backfill";
  events: RunEvent[];
};

function buildWindows(task: TaskSpec, events: RunEvent[]): Window[] {
  const starts = events.filter((event) => event.type === "task_started");
  if (starts.length === 0) {
    if (events.length === 0 && !isPastPlanning(task.status)) {
      return [];
    }
    return [{ sessionId: `backfill:${encodeURIComponent(task.id)}:status`, ...(events[0] ? { startedAt: events[0].timestamp } : {}), sourceMode: events.length > 0 ? "run_event_backfill" : "task_status_backfill", events }];
  }
  return starts.map((start, index) => {
    const next = starts[index + 1];
    return {
      sessionId: `backfill:${encodeURIComponent(task.id)}:attempt:${index + 1}`,
      startedAt: start.timestamp,
      ...(next ? { endExclusive: next.timestamp } : {}),
      sourceMode: "run_event_backfill",
      events: events.filter((event) => event.timestamp >= start.timestamp && (!next || event.timestamp < next.timestamp)),
    };
  });
}

function filterApprovals(items: InspectionApprovalItem[], events: RunEvent[], window: Window): InspectionApprovalItem[] {
  if (!window.startedAt) return items;
  const filtered = items.filter((item) => inWindow(item.decidedAt ?? requestedAt(events, item.requestId), window));
  return filtered.length > 0 || window.sourceMode !== "task_status_backfill" ? filtered : items;
}

function filterArtifacts(items: InspectionArtifactItem[], window: Window): InspectionArtifactItem[] {
  if (!window.startedAt) return items;
  return items.filter((item) => inWindow(item.createdAt, window));
}

function buildToolCalls(events: RunEvent[], artifacts: InspectionArtifactItem[]): SessionDetailToolCallItemView[] {
  const results = artifacts.filter((item) => item.kind === "command_result").map((item) => {
    const meta = item.metadata as { invocation?: { command?: unknown; args?: unknown; cwd?: unknown }; payload?: { exitCode?: unknown } };
    return {
      toolCallId: item.id,
      label: "Command result",
      command: typeof meta.invocation?.command === "string" ? meta.invocation.command : "unknown",
      args: Array.isArray(meta.invocation?.args) ? meta.invocation.args.filter((v): v is string => typeof v === "string") : [],
      ...(typeof meta.invocation?.cwd === "string" ? { cwd: meta.invocation.cwd } : {}),
      status: meta.payload?.exitCode === 0 ? "completed" : "failed",
      finishedAt: item.createdAt,
      summary: item.summary,
      sourceMode: "artifact_record",
    } satisfies SessionDetailToolCallItemView;
  });
  const planned = events.filter((event) => event.type === "invocation_planned").map((event) => {
    const payload = event.payload as { command?: unknown; args?: unknown; cwd?: unknown };
    return {
      toolCallId: event.id,
      label: "Invocation planned",
      command: typeof payload.command === "string" ? payload.command : "unknown",
      args: Array.isArray(payload.args) ? payload.args.filter((v): v is string => typeof v === "string") : [],
      ...(typeof payload.cwd === "string" ? { cwd: payload.cwd } : {}),
      status: "planned",
      startedAt: event.timestamp,
      finishedAt: event.timestamp,
      summary: `Planned invocation ${String(payload.command ?? "unknown")}.`,
      sourceMode: "invocation_event_backfill",
    } satisfies SessionDetailToolCallItemView;
  });
  return [...results, ...planned].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
}

function buildValidation(validation: InspectionValidationItem | undefined, window: Window, taskStatus: TaskStatus, status: WorkspaceLaneStatus): SessionDetailValidationSummaryView {
  if (validation && (!validation.updatedAt ? !window.endExclusive : inWindow(validation.updatedAt, window))) {
    return { state: mapValidation(validation.outcome, taskStatus), summary: validation.summary, details: [...validation.details], ...(validation.updatedAt ? { updatedAt: validation.updatedAt } : {}), sourceMode: "validation_record" };
  }
  return { state: status === "completed" ? "pass" : status === "blocked" || status === "failed" ? "fail" : "warn", summary: summaryOf(window.events.at(-1)) ?? `Validation has not produced a dedicated record for this session yet.`, details: [], sourceMode: "task_status_backfill" };
}

function buildArtifactSummary(artifacts: InspectionArtifactItem[]): SessionDetailArtifactSummaryView {
  const items = [...artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { totalCount: items.length, ...(items[0] ? { latestCreatedAt: items[0].createdAt } : {}), items: items.map((item) => ({ artifactId: item.id, kind: item.kind, uri: item.uri, summary: item.summary, createdAt: item.createdAt })) };
}

function previewLines(events: RunEvent[], task: TaskSpec, validation: InspectionValidationItem | undefined): string[] {
  const lines = events.filter((event) => event.type === "agent_message").flatMap((event) => {
    const payload = event.payload as { message?: unknown };
    return typeof payload.message === "string" ? payload.message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
  });
  return lines.length > 0 ? lines.slice(-20) : [`$ task ${task.id}`, `> ${task.title}`, `> status: ${task.status}`, ...(validation?.summary ? [`> ${validation.summary}`] : [])];
}

function resolveStatus(window: Window, taskStatus: TaskStatus, latestEvent: RunEvent | undefined): WorkspaceLaneStatus {
  if (!window.endExclusive) return mapTask(taskStatus);
  if (!latestEvent) return "paused";
  switch (latestEvent.type) {
    case "approval_requested": return "awaiting_approval";
    case "task_blocked": return "blocked";
    case "task_failed":
    case "validation_failed": return "failed";
    case "task_completed":
    case "validation_passed": return "completed";
    default: return "running";
  }
}

function mapTask(status: TaskStatus): WorkspaceLaneStatus {
  switch (status) {
    case "awaiting_approval": return "awaiting_approval";
    case "blocked": return "blocked";
    case "completed": return "completed";
    case "cancelled":
    case "failed_retryable":
    case "failed_terminal": return "failed";
    case "pending":
    case "ready": return "paused";
    default: return "running";
  }
}

function mapValidation(outcome: InspectionValidationItem["outcome"], taskStatus: TaskStatus): SessionDetailValidationSummaryView["state"] {
  if (outcome === "pass" || taskStatus === "completed") return "pass";
  if (outcome === "fail_retryable" || outcome === "fail_replan_needed" || outcome === "blocked" || taskStatus === "failed_retryable" || taskStatus === "failed_terminal" || taskStatus === "blocked") return "fail";
  return "warn";
}

function resolveTaskId(event: RunEvent): string | undefined {
  if (event.taskId) return event.taskId;
  const payload = event.payload as { taskId?: unknown };
  return typeof payload.taskId === "string" ? payload.taskId : undefined;
}
function requestedAt(events: RunEvent[], requestId: string): string | undefined {
  return events.find((event) => event.type === "approval_requested" && (event.payload as { requestId?: unknown }).requestId === requestId)?.timestamp;
}
function inWindow(timestamp: string | undefined, window: Window): boolean {
  return Boolean(timestamp && window.startedAt && timestamp >= window.startedAt && (!window.endExclusive || timestamp < window.endExclusive));
}
function resolveTranscriptPath(events: RunEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    const value = (event.payload as { transcriptPath?: unknown }).transcriptPath;
    if (typeof value === "string") return value;
  }
  return undefined;
}
function resolveAgentId(event: RunEvent | undefined, task: TaskSpec): string {
  const value = (event?.payload as { agentId?: unknown } | undefined)?.agentId;
  if (typeof value === "string") return value;
  return task.assignedAgent ?? task.preferredAgent ?? task.requiredCapabilities[0] ?? "unassigned";
}
function ownerOf(task: TaskSpec): string {
  return task.assignedAgent ?? task.preferredAgent ?? (task.requiredCapabilities.length > 0 ? task.requiredCapabilities.join(", ") : `${task.kind} task`);
}
function summaryOf(event: RunEvent | undefined): string | undefined {
  if (!event) return undefined;
  const payload = event.payload as { summary?: unknown; reason?: unknown; message?: unknown; agentId?: unknown };
  if (typeof payload.summary === "string") return payload.summary;
  if (typeof payload.reason === "string") return payload.reason;
  if (typeof payload.message === "string") return payload.message.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (event.type === "task_started" && typeof payload.agentId === "string") return `Task started by ${payload.agentId}.`;
  return event.type.replaceAll("_", " ");
}
function isPastPlanning(status: TaskStatus): boolean {
  return status === "running" || status === "validating" || status === "completed" || status === "failed_retryable" || status === "failed_terminal" || status === "blocked" || status === "cancelled" || status === "awaiting_approval";
}
