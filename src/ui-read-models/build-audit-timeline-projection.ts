import type {
  InspectionArtifactGroup,
  InspectionArtifactItem,
  InspectionTimelineEntry,
  InspectionValidationItem,
  RunEvent,
  RunInspection,
  TaskSpec,
} from "../domain/models.js";
import type {
  AuditTimelineArtifactGroupView,
  AuditTimelineArtifactHighlightView,
  AuditTimelineEntryKind,
  AuditTimelineEntryView,
  AuditTimelineProjectionView,
  AuditTimelineReplanRecordView,
  AuditTimelineSessionEventView,
  AuditTimelineSessionSourceMode,
  AuditTimelineValidationRecordView,
} from "./audit-timeline-models.js";
import { buildApprovalQueueProjection } from "./build-approval-queue-projection.js";
import {
  buildBackfilledSessionWindows,
  type BackfilledSessionWindow,
} from "./session-backfill.js";

interface SessionBinding {
  sessionId: string;
  sourceMode: AuditTimelineSessionSourceMode;
}

interface SessionContext {
  windowsByTaskId: Map<string, BackfilledSessionWindow[]>;
  eventBindings: Map<string, SessionBinding>;
}

const KEY_SESSION_EVENT_TYPES: RunEvent["type"][] = [
  "task_started",
  "agent_selected",
  "context_built",
  "invocation_planned",
  "task_completed",
  "task_failed",
  "task_blocked",
];

export function buildAuditTimelineProjection(
  inspection: RunInspection,
): AuditTimelineProjectionView {
  const sessionContext = buildSessionContext(inspection);
  const timelineByEventId = new Map(
    inspection.timeline.map((entry) => [entry.eventId, entry] as const),
  );
  const entries = inspection.events
    .map((event) =>
      buildTimelineEntry(inspection, event, timelineByEventId.get(event.id), sessionContext)
    )
    .sort((left, right) =>
      right.timestamp.localeCompare(left.timestamp) ||
      left.eventId.localeCompare(right.eventId)
    );

  return {
    projection: "audit_timeline",
    generatedAt: new Date().toISOString(),
    runId: inspection.run.runId,
    graphRevision: inspection.graph.revision,
    summary: {
      runStatus: inspection.run.status,
      totalEventCount: entries.length,
      approvalEventCount: countEntries(entries, "approval"),
      validationEventCount: countEntries(entries, "validation"),
      artifactEventCount: countEntries(entries, "artifact"),
      replanCount: countEntries(entries, "replan"),
      sessionEventCount: countEntries(entries, "session"),
      ...(entries[0] ? { latestEventAt: entries[0].timestamp } : {}),
      ...(inspection.summary.latestFailure
        ? { latestFailure: inspection.summary.latestFailure }
        : {}),
      ...(inspection.summary.latestBlocker
        ? { latestBlocker: inspection.summary.latestBlocker }
        : {}),
      ...(inspection.summary.latestReplan
        ? { latestReplan: inspection.summary.latestReplan }
        : {}),
      ...(inspection.summary.latestValidation
        ? { latestValidation: inspection.summary.latestValidation }
        : {}),
    },
    entries,
    approvals: buildApprovalHistory(inspection),
    validations: buildValidationRecords(inspection, sessionContext),
    artifacts: buildArtifactGroups(inspection.artifacts, sessionContext),
    replans: buildReplanRecords(inspection, timelineByEventId),
    sessionEvents: buildSessionEvents(entries, sessionContext),
  };
}

function buildSessionContext(inspection: RunInspection): SessionContext {
  const windowsByTaskId = new Map<string, BackfilledSessionWindow[]>();
  const eventBindings = new Map<string, SessionBinding>();
  const taskEventsByTaskId = groupEventsByTaskId(inspection.events);

  for (const task of Object.values(inspection.graph.tasks)) {
    const windows = buildBackfilledSessionWindows(
      task,
      taskEventsByTaskId.get(task.id) ?? [],
    );
    windowsByTaskId.set(task.id, windows);

    for (const window of windows) {
      for (const event of window.events) {
        eventBindings.set(event.id, {
          sessionId: window.sessionId,
          sourceMode: window.sourceMode,
        });
      }
    }
  }

  return { windowsByTaskId, eventBindings };
}

function buildTimelineEntry(
  inspection: RunInspection,
  event: RunEvent,
  timelineEntry: InspectionTimelineEntry | undefined,
  sessionContext: SessionContext,
): AuditTimelineEntryView {
  const taskId = resolveTaskId(event);
  const taskTitle = taskId
    ? inspection.graph.tasks[taskId]?.title ?? taskId
    : undefined;
  const sessionBinding = sessionContext.eventBindings.get(event.id);
  const approvalRequestId = resolveApprovalRequestId(event);
  const artifactId = resolveArtifactId(event);

  return {
    eventId: event.id,
    timestamp: event.timestamp,
    kind: classifyEventKind(event.type),
    type: event.type,
    title:
      timelineEntry?.title ??
      buildTimelineTitle(event.type, taskTitle, event.payload as Record<string, unknown>),
    details:
      timelineEntry?.details ??
      buildTimelineDetails(event.payload as Record<string, unknown>),
    ...(taskId ? { taskId } : {}),
    ...(taskTitle ? { taskTitle } : {}),
    ...(sessionBinding ? { sessionId: sessionBinding.sessionId } : {}),
    ...(approvalRequestId ? { approvalRequestId } : {}),
    ...(artifactId ? { artifactId } : {}),
    sourceMode: "run_event",
  };
}

function buildApprovalHistory(
  inspection: RunInspection,
): AuditTimelineProjectionView["approvals"] {
  return buildApprovalQueueProjection([inspection]).items
    .map((item) => ({
      requestId: item.requestId,
      ...(item.taskId ? { taskId: item.taskId } : {}),
      taskTitle: item.taskTitle,
      summary: item.summary,
      state: item.state,
      riskLevel: item.riskLevel,
      requestedAt: item.requestedAt,
      ...(item.decidedAt ? { decidedAt: item.decidedAt } : {}),
      ...(item.actor ? { actor: item.actor } : {}),
      ...(item.note ? { note: item.note } : {}),
      ...(item.session ? { sessionId: item.session.sessionId } : {}),
      sourceMode: item.sourceMode,
    }))
    .sort((left, right) =>
      (right.decidedAt ?? right.requestedAt).localeCompare(
        left.decidedAt ?? left.requestedAt,
      ) || left.requestId.localeCompare(right.requestId)
    );
}

function buildValidationRecords(
  inspection: RunInspection,
  sessionContext: SessionContext,
): AuditTimelineValidationRecordView[] {
  return inspection.validation
    .map((item) => {
      const sessionBinding =
        resolveSessionBindingForTimestamp(
          item.taskId,
          item.updatedAt,
          sessionContext,
        ) ?? resolveLatestSessionBinding(item.taskId, sessionContext);

      return {
        taskId: item.taskId,
        taskTitle: item.taskTitle,
        taskStatus: item.taskStatus,
        ...(item.outcome ? { outcome: item.outcome } : {}),
        summary: item.summary,
        details: [...item.details],
        ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
        ...(sessionBinding ? { sessionId: sessionBinding.sessionId } : {}),
        sourceMode: item.updatedAt ? "validation_record" : "task_status_backfill",
      } satisfies AuditTimelineValidationRecordView;
    })
    .sort((left, right) =>
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
      left.taskTitle.localeCompare(right.taskTitle)
    );
}

function buildArtifactGroups(
  artifactGroups: InspectionArtifactGroup[],
  sessionContext: SessionContext,
): AuditTimelineArtifactGroupView[] {
  return artifactGroups
    .map((group) => {
      const sortedArtifacts = [...group.artifacts].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
      );

      return {
        ...(group.taskId ? { taskId: group.taskId } : {}),
        taskTitle: group.taskTitle,
        totalCount: sortedArtifacts.length,
        ...(sortedArtifacts[0]
          ? { latestCreatedAt: sortedArtifacts[0].createdAt }
          : {}),
        artifactKinds: uniqueArtifactKinds(sortedArtifacts),
        highlights: sortedArtifacts
          .slice(0, 3)
          .map((artifact) =>
            buildArtifactHighlight(artifact, group.taskId, sessionContext)
          ),
        sourceMode: "artifact_record",
      } satisfies AuditTimelineArtifactGroupView;
    })
    .sort((left, right) =>
      (right.latestCreatedAt ?? "").localeCompare(left.latestCreatedAt ?? "") ||
      left.taskTitle.localeCompare(right.taskTitle)
    );
}

function buildArtifactHighlight(
  artifact: InspectionArtifactItem,
  taskId: string | undefined,
  sessionContext: SessionContext,
): AuditTimelineArtifactHighlightView {
  const sessionBinding = taskId
    ? resolveSessionBindingForTimestamp(taskId, artifact.createdAt, sessionContext)
    : undefined;

  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    uri: artifact.uri,
    summary: artifact.summary,
    createdAt: artifact.createdAt,
    ...(sessionBinding ? { sessionId: sessionBinding.sessionId } : {}),
  };
}

function buildReplanRecords(
  inspection: RunInspection,
  timelineByEventId: Map<string, InspectionTimelineEntry>,
): AuditTimelineReplanRecordView[] {
  return inspection.events
    .filter(
      (event) =>
        event.type === "replan_requested" || event.type === "replan_applied",
    )
    .map((event) => {
      const timelineEntry = timelineByEventId.get(event.id);
      const taskId = resolveTaskId(event);
      const taskTitle = taskId
        ? inspection.graph.tasks[taskId]?.title ?? taskId
        : undefined;
      return {
        eventId: event.id,
        type: event.type as AuditTimelineReplanRecordView["type"],
        timestamp: event.timestamp,
        title:
          timelineEntry?.title ??
          buildTimelineTitle(
            event.type,
            taskTitle,
            event.payload as Record<string, unknown>,
          ),
        details:
          timelineEntry?.details ??
          buildTimelineDetails(event.payload as Record<string, unknown>),
        ...(taskId ? { taskId } : {}),
        ...(taskTitle ? { taskTitle } : {}),
        sourceMode: "run_event",
      } satisfies AuditTimelineReplanRecordView;
    })
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function buildSessionEvents(
  entries: AuditTimelineEntryView[],
  sessionContext: SessionContext,
): AuditTimelineSessionEventView[] {
  return entries
    .filter(
      (entry) =>
        Boolean(
          entry.sessionId &&
            entry.taskId &&
            entry.taskTitle &&
            KEY_SESSION_EVENT_TYPES.includes(entry.type)
        )
    )
    .map((entry) => ({
      eventId: entry.eventId,
      sessionId: entry.sessionId!,
      taskId: entry.taskId!,
      taskTitle: entry.taskTitle!,
      timestamp: entry.timestamp,
      type: entry.type,
      title: entry.title,
      summary: entry.details[0] ?? entry.title,
      sourceMode:
        sessionContext.eventBindings.get(entry.eventId)?.sourceMode ??
        "run_event_backfill",
    }))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function groupEventsByTaskId(events: RunEvent[]): Map<string, RunEvent[]> {
  const grouped = new Map<string, RunEvent[]>();

  for (const event of [...events].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp)
  )) {
    const taskId = resolveTaskId(event);
    if (!taskId) {
      continue;
    }

    const scoped = grouped.get(taskId) ?? [];
    scoped.push(event);
    grouped.set(taskId, scoped);
  }

  return grouped;
}

function resolveTaskId(event: RunEvent): string | undefined {
  if (event.taskId) {
    return event.taskId;
  }
  const payload = event.payload as { taskId?: unknown };
  return typeof payload.taskId === "string" ? payload.taskId : undefined;
}

function resolveApprovalRequestId(event: RunEvent): string | undefined {
  const payload = event.payload as { requestId?: unknown };
  return typeof payload.requestId === "string" ? payload.requestId : undefined;
}

function resolveArtifactId(event: RunEvent): string | undefined {
  const payload = event.payload as { artifactId?: unknown };
  return typeof payload.artifactId === "string" ? payload.artifactId : undefined;
}

function resolveSessionBindingForTimestamp(
  taskId: string,
  timestamp: string | undefined,
  sessionContext: SessionContext,
): SessionBinding | undefined {
  if (!timestamp) {
    return undefined;
  }

  const windows = sessionContext.windowsByTaskId.get(taskId) ?? [];
  const matched =
    windows.find((window) =>
      Boolean(
        window.startedAt &&
          timestamp >= window.startedAt &&
          (!window.windowEndExclusive || timestamp < window.windowEndExclusive)
      )
    ) ??
    windows.find((window) => !window.windowEndExclusive) ??
    windows.at(-1);

  if (!matched) {
    return undefined;
  }

  return {
    sessionId: matched.sessionId,
    sourceMode: matched.sourceMode,
  };
}

function resolveLatestSessionBinding(
  taskId: string,
  sessionContext: SessionContext,
): SessionBinding | undefined {
  const latestWindow = sessionContext.windowsByTaskId.get(taskId)?.at(-1);
  if (!latestWindow) {
    return undefined;
  }
  return {
    sessionId: latestWindow.sessionId,
    sourceMode: latestWindow.sourceMode,
  };
}

function classifyEventKind(type: RunEvent["type"]): AuditTimelineEntryKind {
  switch (type) {
    case "approval_requested":
    case "approval_decided":
      return "approval";
    case "validation_started":
    case "validation_passed":
    case "validation_failed":
      return "validation";
    case "artifact_created":
      return "artifact";
    case "replan_requested":
    case "replan_applied":
      return "replan";
    case "task_started":
    case "agent_selected":
    case "context_built":
    case "invocation_planned":
    case "agent_message":
    case "task_completed":
    case "task_failed":
    case "task_blocked":
      return "session";
    default:
      return "lifecycle";
  }
}

function countEntries(
  entries: AuditTimelineEntryView[],
  kind: AuditTimelineEntryKind,
): number {
  return entries.filter((entry) => entry.kind === kind).length;
}

function uniqueArtifactKinds(
  artifacts: InspectionArtifactItem[],
): InspectionArtifactItem["kind"][] {
  return [...new Set(artifacts.map((artifact) => artifact.kind))];
}

function buildTimelineTitle(
  type: RunEvent["type"],
  taskTitle: string | undefined,
  payload: Record<string, unknown>,
): string {
  switch (type) {
    case "run_started":
      return "Run started";
    case "memory_recalled":
      return "Project memory recalled";
    case "task_planned":
      return `Task planned: ${String(payload.title ?? taskTitle ?? "unknown")}`;
    case "agent_selected":
      return `Agent selected${taskTitle ? `: ${taskTitle}` : ""}`;
    case "context_built":
      return `Context built${taskTitle ? `: ${taskTitle}` : ""}`;
    case "invocation_planned":
      return `Invocation planned${taskTitle ? `: ${taskTitle}` : ""}`;
    case "approval_requested":
      return `Approval requested${taskTitle ? `: ${taskTitle}` : ""}`;
    case "approval_decided":
      return `Approval ${String(payload.decision ?? "updated")}${taskTitle ? `: ${taskTitle}` : ""}`;
    case "task_started":
      return `Task started${taskTitle ? `: ${taskTitle}` : ""}`;
    case "task_completed":
      return `Task completed${taskTitle ? `: ${taskTitle}` : ""}`;
    case "task_failed":
      return `Task failed${taskTitle ? `: ${taskTitle}` : ""}`;
    case "task_blocked":
      return `Task blocked${taskTitle ? `: ${taskTitle}` : ""}`;
    case "validation_started":
      return `Validation started${taskTitle ? `: ${taskTitle}` : ""}`;
    case "validation_passed":
      return `Validation passed${taskTitle ? `: ${taskTitle}` : ""}`;
    case "validation_failed":
      return `Validation failed${taskTitle ? `: ${taskTitle}` : ""}`;
    case "replan_requested":
      return "Replan requested";
    case "replan_applied":
      return "Replan applied";
    case "workspace_drift_detected":
      return "Workspace drift detected";
    case "run_finished":
      return `Run finished with status ${String(payload.status ?? "unknown")}`;
    default:
      return type.replaceAll("_", " ");
  }
}

function buildTimelineDetails(payload: Record<string, unknown>): string[] {
  const details: string[] = [];

  for (const key of ["summary", "reason", "actor", "command", "validatorMode", "status"]) {
    const value = payload[key];
    if (typeof value === "string") {
      details.push(`${key}: ${value}`);
    }
  }

  if (typeof payload.count === "number") {
    details.push(`count: ${payload.count}`);
  }

  if (Array.isArray(payload.reasons)) {
    details.push(
      ...payload.reasons.filter((value): value is string => typeof value === "string"),
    );
  }

  return details;
}
