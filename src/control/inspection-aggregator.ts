import type {
  ArtifactRecord,
  BlackboardEntry,
  InspectionApprovalItem,
  InspectionArtifactGroup,
  InspectionArtifactItem,
  InspectionBlackboardEntry,
  InspectionBlackboardScope,
  InspectionSummary,
  InspectionTimelineEntry,
  InspectionValidationItem,
  RunEvent,
  RunGraph,
  RunInspection,
  RunRecord,
} from "../domain/models.js";
import type { ApprovalManager } from "../execution/approval-manager.js";
import type { ApprovalRequest } from "../domain/models.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import type { BlackboardStore } from "../storage/blackboard-store.js";

export interface InspectionAggregatorDependencies {
  artifactStore: ArtifactStore;
  blackboardStore: BlackboardStore;
  approvalManager: ApprovalManager;
}

export class InspectionAggregator {
  constructor(private readonly dependencies: InspectionAggregatorDependencies) {}

  async build(
    run: RunRecord,
    graph: RunGraph,
    events: RunEvent[],
  ): Promise<RunInspection> {
    const [artifacts, blackboardEntries, pendingApprovals] = await Promise.all([
      this.dependencies.artifactStore.list(run.runId),
      this.dependencies.blackboardStore.list(run.runId),
      this.dependencies.approvalManager.listPending(run.runId),
    ]);

    const timelineEvents = [...events].sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp),
    );
    const timeline = buildTimeline(timelineEvents, graph);
    const artifactGroups = buildArtifactGroups(artifacts, graph);
    const blackboard = buildBlackboardScopes(blackboardEntries);
    const validation = buildValidationView(graph, artifacts, blackboardEntries);
    const approvals = buildApprovalView(pendingApprovals, artifacts, graph);
    const summary = buildSummary(run, graph, timelineEvents, validation, approvals);

    return {
      run,
      graph,
      events,
      timeline,
      artifacts: artifactGroups,
      blackboard,
      validation,
      approvals,
      summary,
    };
  }
}

function buildTimeline(events: RunEvent[], graph: RunGraph): InspectionTimelineEntry[] {
  return events.map((event) => {
    const payload = event.payload as Record<string, unknown>;
    const taskTitle = event.taskId ? graph.tasks[event.taskId]?.title ?? event.taskId : undefined;
    return {
      eventId: event.id,
      type: event.type,
      timestamp: event.timestamp,
      ...(event.taskId ? { taskId: event.taskId } : {}),
      title: buildTimelineTitle(event.type, taskTitle, payload),
      details: buildTimelineDetails(payload),
    };
  });
}

function buildArtifactGroups(
  artifacts: ArtifactRecord[],
  graph: RunGraph,
): InspectionArtifactGroup[] {
  const groups = new Map<string, InspectionArtifactGroup>();
  const sortedArtifacts = [...artifacts].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );

  for (const artifact of sortedArtifacts) {
    const key = artifact.taskId ?? "__run__";
    const existing = groups.get(key) ?? {
      ...(artifact.taskId ? { taskId: artifact.taskId } : {}),
      taskTitle: artifact.taskId ? graph.tasks[artifact.taskId]?.title ?? artifact.taskId : "Run",
      artifacts: [],
    };
    existing.artifacts.push(toArtifactItem(artifact));
    groups.set(key, existing);
  }

  return [...groups.values()].sort((left, right) => left.taskTitle.localeCompare(right.taskTitle));
}

function toArtifactItem(artifact: ArtifactRecord): InspectionArtifactItem {
  return {
    id: artifact.id,
    ...(artifact.taskId ? { taskId: artifact.taskId } : {}),
    kind: artifact.kind,
    uri: artifact.uri,
    summary: artifact.summary,
    createdAt: artifact.createdAt,
    metadata: artifact.metadata,
  };
}

function buildBlackboardScopes(entries: BlackboardEntry[]): InspectionBlackboardScope[] {
  const scopeOrder: BlackboardEntry["scope"][] = ["planner", "agent", "approval", "validation"];

  return scopeOrder.map((scope) => {
    const scopedEntries = entries
      .filter((entry) => entry.scope === scope)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return {
      scope,
      latestSummary: scopedEntries[0]?.summary,
      entries: scopedEntries.map(toBlackboardEntry),
    };
  });
}

function toBlackboardEntry(entry: BlackboardEntry): InspectionBlackboardEntry {
  return {
    id: entry.id,
    ...(entry.taskId ? { taskId: entry.taskId } : {}),
    summary: entry.summary,
    references: entry.references,
    updatedAt: entry.updatedAt,
  };
}

function buildValidationView(
  graph: RunGraph,
  artifacts: ArtifactRecord[],
  blackboardEntries: BlackboardEntry[],
): InspectionValidationItem[] {
  const validationArtifacts = new Map<string, ArtifactRecord>();
  for (const artifact of artifacts) {
    if (artifact.kind !== "validation_result" || !artifact.taskId) {
      continue;
    }
    const current = validationArtifacts.get(artifact.taskId);
    if (!current || artifact.createdAt.localeCompare(current.createdAt) > 0) {
      validationArtifacts.set(artifact.taskId, artifact);
    }
  }

  return Object.values(graph.tasks)
    .map((task) => {
      const artifact = validationArtifacts.get(task.id);
      const metadata = artifact?.metadata ?? {};
      const blackboardSummary = blackboardEntries
        .filter((entry) => entry.scope === "validation" && entry.taskId === task.id)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      const details = Array.isArray(metadata.details)
        ? metadata.details.filter((value): value is string => typeof value === "string")
        : [];

      return {
        taskId: task.id,
        taskTitle: task.title,
        taskStatus: task.status,
        ...(typeof metadata.outcome === "string" ? { outcome: metadata.outcome } : {}),
        summary:
          artifact?.summary ??
          blackboardSummary?.summary ??
          `Task is currently ${task.status}.`,
        details,
        updatedAt: artifact?.createdAt ?? blackboardSummary?.updatedAt,
      };
    })
    .sort((left, right) => left.taskTitle.localeCompare(right.taskTitle));
}

function buildApprovalView(
  pendingApprovals: ApprovalRequest[],
  artifacts: ArtifactRecord[],
  graph: RunGraph,
): InspectionApprovalItem[] {
  const approvals = new Map<string, InspectionApprovalItem>();

  for (const request of pendingApprovals) {
    approvals.set(request.id, {
      requestId: request.id,
      taskId: request.taskId,
      summary: request.reason,
      state: "pending",
      riskLevel: highestRiskLevel(request.actionPlans.map((action) => action.riskLevel)),
    });
  }

  const approvalArtifacts = [...artifacts]
    .filter((artifact) => artifact.kind === "approval_record")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  for (const artifact of approvalArtifacts) {
    const requestId =
      typeof artifact.metadata.requestId === "string"
        ? artifact.metadata.requestId
        : undefined;
    if (!requestId) {
      continue;
    }

    const decision =
      typeof artifact.metadata.decision === "string"
        ? artifact.metadata.decision
        : undefined;
    const existing = approvals.get(requestId);
    if (existing && existing.state !== "pending" && decision !== "approved" && decision !== "rejected") {
      continue;
    }

    const actionPlans = Array.isArray(artifact.metadata.actionPlans)
      ? artifact.metadata.actionPlans
      : [];
    const summary = artifact.summary || `Approval update for ${resolveTaskTitle(graph, artifact.taskId)}.`;
    approvals.set(requestId, {
      requestId,
      ...(artifact.taskId ? { taskId: artifact.taskId } : {}),
      summary,
      state: decision === "approved" || decision === "rejected" ? decision : "pending",
      ...(typeof artifact.metadata.actor === "string" ? { actor: artifact.metadata.actor } : {}),
      ...(typeof artifact.metadata.requestedAt === "string" ? { decidedAt: artifact.metadata.requestedAt } : {}),
      ...(artifact.metadata.decisionRecord &&
      typeof artifact.metadata.decisionRecord === "object" &&
      artifact.metadata.decisionRecord !== null &&
      typeof (artifact.metadata.decisionRecord as { decidedAt?: unknown }).decidedAt === "string"
        ? { decidedAt: (artifact.metadata.decisionRecord as { decidedAt: string }).decidedAt }
        : {}),
      riskLevel: highestRiskLevel(
        actionPlans
          .map((action) =>
            typeof action === "object" && action !== null && typeof (action as { riskLevel?: unknown }).riskLevel === "string"
              ? ((action as { riskLevel: string }).riskLevel as "low" | "medium" | "high")
              : undefined,
          )
          .filter((value): value is "low" | "medium" | "high" => Boolean(value)),
      ),
    });
  }

  return [...approvals.values()].sort((left, right) => left.requestId.localeCompare(right.requestId));
}

function buildSummary(
  run: RunRecord,
  graph: RunGraph,
  events: RunEvent[],
  validation: InspectionValidationItem[],
  approvals: InspectionApprovalItem[],
): InspectionSummary {
  const taskStatuses = Object.values(graph.tasks).map((task) => task.status);
  const reverseEvents = [...events].reverse();

  return {
    runStatus: run.status,
    completedTasks: taskStatuses.filter((status) => status === "completed").length,
    failedTasks: taskStatuses.filter(
      (status) => status === "failed_retryable" || status === "failed_terminal",
    ).length,
    blockedTasks: taskStatuses.filter((status) => status === "blocked").length,
    pendingApprovals: approvals.filter((approval) => approval.state === "pending").length,
    ...(findEventSummary(reverseEvents, ["validation_failed", "task_failed"]) ? {
      latestFailure: findEventSummary(reverseEvents, ["validation_failed", "task_failed"]),
    } : {}),
    ...(findEventSummary(reverseEvents, ["task_blocked", "workspace_drift_detected"]) ? {
      latestBlocker: findEventSummary(reverseEvents, ["task_blocked", "workspace_drift_detected"]),
    } : {}),
    ...(findEventSummary(reverseEvents, ["replan_applied", "replan_requested"]) ? {
      latestReplan: findEventSummary(reverseEvents, ["replan_applied", "replan_requested"]),
    } : {}),
    ...(validation
      .filter((item) => item.taskStatus === "completed" || item.taskStatus === "blocked")
      .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))[0] ? {
      latestValidation: validation
        .filter((item) => item.taskStatus === "completed" || item.taskStatus === "blocked")
        .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))[0].summary,
    } : {}),
  };
}

function findEventSummary(events: RunEvent[], types: RunEvent["type"][]): string | undefined {
  const event = events.find((candidate) => types.includes(candidate.type));
  if (!event) {
    return undefined;
  }
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.summary === "string") {
    return payload.summary;
  }
  if (Array.isArray(payload.reasons)) {
    const reasons = payload.reasons.filter((value): value is string => typeof value === "string");
    if (reasons.length > 0) {
      return reasons.join(" ");
    }
  }
  if (typeof payload.status === "string") {
    return `Run finished with status ${payload.status}.`;
  }
  return undefined;
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
      return type;
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

function resolveTaskTitle(graph: RunGraph, taskId?: string): string {
  if (!taskId) {
    return "Run";
  }
  return graph.tasks[taskId]?.title ?? taskId;
}

function highestRiskLevel(
  riskLevels: Array<"low" | "medium" | "high">,
): "low" | "medium" | "high" | undefined {
  if (riskLevels.includes("high")) {
    return "high";
  }
  if (riskLevels.includes("medium")) {
    return "medium";
  }
  if (riskLevels.includes("low")) {
    return "low";
  }
  return undefined;
}


