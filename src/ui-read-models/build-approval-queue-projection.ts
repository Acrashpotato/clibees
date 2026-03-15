import type {
  InspectionApprovalItem,
  InspectionArtifactItem,
  RunEvent,
  RunInspection,
  RiskLevel,
  TaskSpec,
} from "../domain/models.js";
import type {
  ApprovalQueueActionPlanSnapshotView,
  ApprovalQueueItemDetailView,
  ApprovalQueueProjectionView,
  ApprovalQueueSessionBindingView,
} from "./models.js";
import { buildBackfilledSessionWindows } from "./session-backfill.js";

interface ApprovalArtifacts {
  requestArtifact?: InspectionArtifactItem;
  decisionArtifact?: InspectionArtifactItem;
  taskId?: string;
}

export function buildApprovalQueueProjection(
  inspections: RunInspection[],
): ApprovalQueueProjectionView {
  const items = inspections
    .flatMap((inspection) => buildApprovalItems(inspection))
    .sort(compareApprovalItems);

  return {
    projection: "approval_queue",
    generatedAt: new Date().toISOString(),
    summary: {
      totalCount: items.length,
      pendingCount: items.filter((item) => item.state === "pending").length,
      approvedCount: items.filter((item) => item.state === "approved").length,
      rejectedCount: items.filter((item) => item.state === "rejected").length,
      highRiskCount: items.filter((item) => item.riskLevel === "high").length,
      mediumRiskCount: items.filter((item) => item.riskLevel === "medium").length,
      lowRiskCount: items.filter((item) => item.riskLevel === "low").length,
    },
    items,
  };
}

function buildApprovalItems(
  inspection: RunInspection,
): ApprovalQueueItemDetailView[] {
  const approvalByRequestId = new Map(
    inspection.approvals.map((approval) => [approval.requestId, approval] as const),
  );
  const taskEventsByTaskId = groupTaskEvents(inspection.events);
  const artifactsByRequestId = groupApprovalArtifacts(
    inspection.artifacts.flatMap((group) => group.artifacts),
  );
  const requestIds = new Set<string>([
    ...approvalByRequestId.keys(),
    ...artifactsByRequestId.keys(),
  ]);

  return [...requestIds]
    .map((requestId) =>
      buildApprovalItem(
        inspection,
        requestId,
        approvalByRequestId.get(requestId),
        artifactsByRequestId.get(requestId),
        taskEventsByTaskId,
      )
    )
    .filter((item): item is ApprovalQueueItemDetailView => Boolean(item));
}

function buildApprovalItem(
  inspection: RunInspection,
  requestId: string,
  approval: InspectionApprovalItem | undefined,
  artifacts: ApprovalArtifacts | undefined,
  taskEventsByTaskId: Map<string, RunEvent[]>,
): ApprovalQueueItemDetailView | undefined {
  if (!approval && !artifacts) {
    return undefined;
  }

  const taskId = approval?.taskId ?? artifacts?.taskId;
  const task = taskId ? inspection.graph.tasks[taskId] : undefined;
  const requestArtifact = artifacts?.requestArtifact;
  const decisionArtifact = artifacts?.decisionArtifact;
  const actionPlans = buildActionPlanSnapshots(
    (requestArtifact?.metadata as { actionPlans?: unknown } | undefined)?.actionPlans,
  );
  const requestedAt =
    resolveRequestedAt(inspection.events, requestId) ??
    requestArtifact?.createdAt ??
    decisionArtifact?.createdAt ??
    inspection.run.updatedAt;
  const decision = resolveDecision(decisionArtifact, approval);
  const session = task
    ? resolveSessionBinding(task, taskEventsByTaskId.get(task.id) ?? [], requestedAt)
    : undefined;

  return {
    requestId,
    runId: inspection.run.runId,
    ...(taskId ? { taskId } : {}),
    taskTitle: task?.title ?? taskId ?? "Run approval",
    summary: resolveSummary(requestArtifact, approval, decisionArtifact, requestId),
    state: decision.state,
    riskLevel: highestRiskLevel(actionPlans.map((action) => action.riskLevel)) ?? approval?.riskLevel ?? "none",
    requestedAt,
    ...(decision.decidedAt ? { decidedAt: decision.decidedAt } : {}),
    ...(decision.actor ? { actor: decision.actor } : {}),
    ...(decision.note ? { note: decision.note } : {}),
    ...(session ? { session } : {}),
    actionPlanCount: actionPlans.length,
    actionPlans,
    sourceMode: requestArtifact ? "approval_artifact" : "inspection_approval",
  } satisfies ApprovalQueueItemDetailView;
}

function groupTaskEvents(events: RunEvent[]): Map<string, RunEvent[]> {
  const grouped = new Map<string, RunEvent[]>();

  for (const event of [...events].sort((left, right) => left.timestamp.localeCompare(right.timestamp))) {
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

function groupApprovalArtifacts(
  artifacts: InspectionArtifactItem[],
): Map<string, ApprovalArtifacts> {
  const grouped = new Map<string, ApprovalArtifacts>();

  for (const artifact of artifacts) {
    if (artifact.kind !== "approval_record") {
      continue;
    }

    const metadata = artifact.metadata as { requestId?: unknown };
    if (typeof metadata.requestId !== "string") {
      continue;
    }

    const existing = grouped.get(metadata.requestId) ?? {};
    const next: ApprovalArtifacts = {
      ...existing,
      ...(artifact.taskId ? { taskId: artifact.taskId } : {}),
    };

    if (isDecisionArtifact(artifact)) {
      if (!existing.decisionArtifact || artifact.createdAt.localeCompare(existing.decisionArtifact.createdAt) > 0) {
        next.decisionArtifact = artifact;
      }
    } else if (!existing.requestArtifact || artifact.createdAt.localeCompare(existing.requestArtifact.createdAt) < 0) {
      next.requestArtifact = artifact;
    }

    grouped.set(metadata.requestId, next);
  }

  return grouped;
}

function isDecisionArtifact(artifact: InspectionArtifactItem): boolean {
  const metadata = artifact.metadata as { decision?: unknown; decisionRecord?: unknown };
  return typeof metadata.decision === "string" || typeof metadata.decisionRecord === "object";
}

function buildActionPlanSnapshots(raw: unknown): ApprovalQueueActionPlanSnapshotView[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return [];
    }

    const action = candidate as {
      id?: unknown;
      kind?: unknown;
      riskLevel?: unknown;
      requiresApproval?: unknown;
      reason?: unknown;
      command?: unknown;
      args?: unknown;
      cwd?: unknown;
      targets?: unknown;
    };

    if (
      typeof action.id !== "string" ||
      typeof action.kind !== "string" ||
      typeof action.riskLevel !== "string" ||
      typeof action.reason !== "string" ||
      typeof action.requiresApproval !== "boolean"
    ) {
      return [];
    }

    if (action.riskLevel !== "low" && action.riskLevel !== "medium" && action.riskLevel !== "high") {
      return [];
    }

    return [{
      actionPlanId: action.id,
      kind: action.kind,
      riskLevel: action.riskLevel,
      requiresApproval: action.requiresApproval,
      reason: action.reason,
      ...(typeof action.command === "string" ? { command: action.command } : {}),
      args: Array.isArray(action.args)
        ? action.args.filter((value): value is string => typeof value === "string")
        : [],
      ...(typeof action.cwd === "string" ? { cwd: action.cwd } : {}),
      targets: Array.isArray(action.targets)
        ? action.targets.filter((value): value is string => typeof value === "string")
        : [],
    } satisfies ApprovalQueueActionPlanSnapshotView];
  });
}

function resolveRequestedAt(events: RunEvent[], requestId: string): string | undefined {
  return events.find((event) => {
    if (event.type !== "approval_requested") {
      return false;
    }
    const payload = event.payload as { requestId?: unknown };
    return payload.requestId === requestId;
  })?.timestamp;
}

function resolveDecision(
  decisionArtifact: InspectionArtifactItem | undefined,
  approval: InspectionApprovalItem | undefined,
): {
  state: ApprovalQueueItemDetailView["state"];
  decidedAt?: string;
  actor?: string;
  note?: string;
} {
  const metadata = decisionArtifact?.metadata as {
    decision?: unknown;
    actor?: unknown;
    note?: unknown;
    decisionRecord?: {
      decidedAt?: unknown;
      actor?: unknown;
      note?: unknown;
    };
  } | undefined;

  const decision = metadata?.decision === "approved" || metadata?.decision === "rejected"
    ? metadata.decision
    : undefined;

  return {
    state: decision ?? approval?.state ?? "pending",
    ...(typeof metadata?.decisionRecord?.decidedAt === "string"
      ? { decidedAt: metadata.decisionRecord.decidedAt }
      : approval?.decidedAt
        ? { decidedAt: approval.decidedAt }
        : decisionArtifact?.createdAt
          ? { decidedAt: decisionArtifact.createdAt }
          : {}),
    ...(typeof metadata?.decisionRecord?.actor === "string"
      ? { actor: metadata.decisionRecord.actor }
      : typeof metadata?.actor === "string"
        ? { actor: metadata.actor }
        : approval?.actor
          ? { actor: approval.actor }
          : {}),
    ...(typeof metadata?.decisionRecord?.note === "string"
      ? { note: metadata.decisionRecord.note }
      : typeof metadata?.note === "string"
        ? { note: metadata.note }
        : {}),
  };
}

function resolveSummary(
  requestArtifact: InspectionArtifactItem | undefined,
  approval: InspectionApprovalItem | undefined,
  decisionArtifact: InspectionArtifactItem | undefined,
  requestId: string,
): string {
  const requestMetadata = requestArtifact?.metadata as { reason?: unknown } | undefined;
  if (typeof requestMetadata?.reason === "string") {
    return requestMetadata.reason;
  }
  if (approval?.summary) {
    return approval.summary;
  }
  if (requestArtifact?.summary) {
    return requestArtifact.summary;
  }
  if (decisionArtifact?.summary) {
    return decisionArtifact.summary;
  }
  return `Approval request ${requestId}`;
}

function resolveSessionBinding(
  task: TaskSpec,
  taskEvents: RunEvent[],
  requestedAt: string,
): ApprovalQueueSessionBindingView | undefined {
  const windows = buildBackfilledSessionWindows(task, taskEvents);
  const matched = windows.find((window) =>
    Boolean(
      window.startedAt &&
      requestedAt >= window.startedAt &&
      (!window.windowEndExclusive || requestedAt < window.windowEndExclusive)
    )
  ) ?? windows.find((window) => !window.windowEndExclusive) ?? windows.at(-1);

  if (!matched) {
    return undefined;
  }

  return {
    sessionId: matched.sessionId,
    label: matched.attemptNumber ? `Attempt ${matched.attemptNumber}` : "Execution summary",
    sourceMode: matched.sourceMode,
  };
}

function compareApprovalItems(
  left: ApprovalQueueItemDetailView,
  right: ApprovalQueueItemDetailView,
): number {
  const statePriority = getStatePriority(left.state) - getStatePriority(right.state);
  if (statePriority !== 0) {
    return statePriority;
  }

  const riskPriority = getRiskPriority(left.riskLevel) - getRiskPriority(right.riskLevel);
  if (riskPriority !== 0) {
    return riskPriority;
  }

  const timestampPriority = (right.decidedAt ?? right.requestedAt).localeCompare(left.decidedAt ?? left.requestedAt);
  if (timestampPriority !== 0) {
    return timestampPriority;
  }

  return left.requestId.localeCompare(right.requestId);
}

function getStatePriority(state: ApprovalQueueItemDetailView["state"]): number {
  switch (state) {
    case "pending":
      return 0;
    case "rejected":
      return 1;
    case "approved":
      return 2;
    default:
      return 3;
  }
}

function getRiskPriority(riskLevel: RiskLevel | "none"): number {
  switch (riskLevel) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    default:
      return 3;
  }
}

function highestRiskLevel(
  riskLevels: RiskLevel[],
): RiskLevel | undefined {
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

function resolveTaskId(event: RunEvent): string | undefined {
  if (event.taskId) {
    return event.taskId;
  }

  const payload = event.payload as { taskId?: unknown };
  return typeof payload.taskId === "string" ? payload.taskId : undefined;
}
