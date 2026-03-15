import type {
  InspectionValidationItem,
  RunEvent,
  RunGraph,
  RunInspection,
  TaskSpec,
  TaskStatus,
} from "../domain/models.js";
import type {
  ApprovalQueueItemView,
  HandoffView,
  LaneView,
  RunListItemView,
  WorkspaceLaneStatus,
  WorkspaceMetricView,
  WorkspaceView,
} from "./models.js";

export function buildWorkspaceView(inspection: RunInspection): WorkspaceView {
  const approvals = buildApprovalQueue(inspection);
  const lanes = buildLanes(inspection, approvals);
  const focusLaneId = resolveFocusLaneId(inspection, lanes);
  const handoffs = buildHandoffs(inspection.graph, lanes);
  const metrics = buildWorkspaceMetrics(inspection, lanes);
  const issues = buildIssues(inspection, approvals);

  return {
    runId: inspection.run.runId,
    goal: inspection.run.goal,
    runStatus: mapRunStatus(inspection.run.status),
    stage: buildStageLabel(inspection),
    metrics,
    lanes,
    approvals,
    handoffs,
    focusLaneId,
    issues,
    createdAt: inspection.run.createdAt,
    updatedAt: inspection.run.updatedAt,
    canResume:
      inspection.run.status === "ready" ||
      inspection.run.status === "paused" ||
      inspection.run.status === "waiting_approval",
  };
}

export function buildRunListItemView(inspection: RunInspection): RunListItemView {
  const tasks = Object.values(inspection.graph.tasks);
  const activeTaskCount = tasks.filter((task) => isActiveTaskStatus(task.status)).length;
  const activeSessionCount = tasks.filter((task) => isActiveSessionBackfillTaskStatus(task.status)).length;
  const blockedTaskCount = tasks.filter((task) => task.status === "blocked").length;

  return {
    runId: inspection.run.runId,
    goal: inspection.run.goal,
    status: mapRunStatus(inspection.run.status),
    stage: buildStageLabel(inspection),
    startedAt: inspection.run.createdAt,
    updatedAt: inspection.run.updatedAt,
    activeTaskCount,
    activeSessionCount,
    blockedTaskCount,
    pendingApprovalCount: inspection.summary.pendingApprovals,
    sessionCountMode: "task_status_backfill",
    summary:
      inspection.summary.latestFailure ??
      inspection.summary.latestBlocker ??
      inspection.summary.latestValidation ??
      inspection.timeline.at(-1)?.title ??
      "Run ready for execution.",
  };
}

export function buildApprovalQueue(inspection: RunInspection): ApprovalQueueItemView[] {
  return inspection.approvals
    .filter((approval) => approval.state === "pending")
    .map((approval) => {
      const task = approval.taskId ? inspection.graph.tasks[approval.taskId] : undefined;
      return {
        id: approval.requestId,
        runId: inspection.run.runId,
        ...(approval.taskId ? { taskId: approval.taskId } : {}),
        laneId: approval.taskId ?? approval.requestId,
        title: task?.title ?? "Approval required",
        summary: approval.summary,
        riskLevel: approval.riskLevel ?? "medium",
        requestedAt: resolveApprovalRequestedAt(inspection.events, approval.requestId),
        actions: [approval.summary],
      };
    })
    .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
}

function buildWorkspaceMetrics(
  inspection: RunInspection,
  lanes: LaneView[],
): WorkspaceMetricView[] {
  const completedTasks = inspection.summary.completedTasks;
  const totalTasks = Object.keys(inspection.graph.tasks).length;

  return [
    {
      label: "Active lanes",
      value: String(lanes.filter((lane) => lane.status === "running").length).padStart(2, "0"),
      tone: "neutral",
    },
    {
      label: "Awaiting approval",
      value: String(inspection.summary.pendingApprovals).padStart(2, "0"),
      tone: inspection.summary.pendingApprovals > 0 ? "warning" : "neutral",
    },
    {
      label: "Blocked",
      value: String(inspection.summary.blockedTasks).padStart(2, "0"),
      tone: inspection.summary.blockedTasks > 0 ? "danger" : "neutral",
    },
    {
      label: "Completed",
      value: `${completedTasks}/${totalTasks}`,
      tone: completedTasks === totalTasks && totalTasks > 0 ? "success" : "neutral",
    },
  ];
}

function buildLanes(
  inspection: RunInspection,
  approvals: ApprovalQueueItemView[],
): LaneView[] {
  const validationByTaskId = new Map(
    inspection.validation.map((item) => [item.taskId, item] as const),
  );
  const approvalsByTaskId = new Map<string, ApprovalQueueItemView[]>();

  for (const approval of approvals) {
    if (!approval.taskId) {
      continue;
    }

    const scoped = approvalsByTaskId.get(approval.taskId) ?? [];
    scoped.push(approval);
    approvalsByTaskId.set(approval.taskId, scoped);
  }

  return Object.values(inspection.graph.tasks)
    .map((task) => {
      const mappedStatus = mapTaskStatus(task.status);
      const validation = validationByTaskId.get(task.id);
      const taskEvents = inspection.events.filter((event) => resolveTaskId(event) === task.id);
      const taskApprovals = approvalsByTaskId.get(task.id) ?? [];
      const artifactGroup = inspection.artifacts.find((group) => group.taskId === task.id);
      const lastActivityAt = taskEvents.at(-1)?.timestamp ?? inspection.run.updatedAt;

      return {
        laneId: task.id,
        agentId: task.assignedAgent ?? task.preferredAgent ?? task.requiredCapabilities[0] ?? "unassigned",
        role: buildLaneRole(task),
        status: mappedStatus,
        statusReason: buildStatusReason(task, validation, taskApprovals, inspection),
        currentTaskTitle: task.title,
        lastActivityAt,
        approvalState: buildApprovalState(mappedStatus, taskApprovals),
        riskLevel: taskApprovals[0]?.riskLevel ?? task.riskLevel,
        terminalPreview: buildTerminalPreview(task, taskEvents, validation),
        handoffHint: buildHandoffHint(task, mappedStatus, inspection.graph),
        artifacts: [
          { label: "Artifacts", value: String(artifactGroup?.artifacts.length ?? 0).padStart(2, "0") },
          { label: "Checks", value: String(validation ? 1 : 0).padStart(2, "0") },
          { label: "Approvals", value: String(taskApprovals.length).padStart(2, "0") },
        ],
        validations: buildValidationSummaries(task, validation),
      };
    })
    .sort(compareLanes);
}

function buildValidationSummaries(
  task: TaskSpec,
  validation?: InspectionValidationItem,
): LaneView["validations"] {
  return [
    {
      title: "Validation",
      state: mapValidationState(validation?.outcome, task.status),
    },
    {
      title: "Task state",
      state: mapTaskStatus(task.status) === "completed"
        ? "pass"
        : mapTaskStatus(task.status) === "failed" || mapTaskStatus(task.status) === "blocked"
          ? "fail"
          : "warn",
    },
  ];
}

function buildHandoffs(graph: RunGraph, lanes: LaneView[]): HandoffView[] {
  const lanesById = new Map(lanes.map((lane) => [lane.laneId, lane] as const));

  return graph.edges.map((edge, index) => {
    const fromLane = lanesById.get(edge.from);
    const toLane = lanesById.get(edge.to);
    const title = `Flow to ${toLane?.currentTaskTitle ?? edge.to}`;
    const status = resolveHandoffStatus(fromLane?.status, toLane?.status);

    return {
      id: `handoff-${index + 1}-${edge.from}-${edge.to}`,
      fromLaneId: edge.from,
      toLaneId: edge.to,
      title,
      summary: `${fromLane?.currentTaskTitle ?? edge.from} unlocks ${toLane?.currentTaskTitle ?? edge.to}.`,
      reason:
        status === "delivered"
          ? "Prerequisite completed."
          : status === "in_progress"
            ? "Dependency is actively moving."
            : "Waiting for upstream completion.",
      ownerLabel:
        status === "delivered"
          ? `${toLane?.role ?? edge.to} can continue next.`
          : status === "in_progress"
            ? `${toLane?.role ?? edge.to} is now in motion.`
            : `${fromLane?.role ?? edge.from} still owns the prerequisite.`,
      status,
    };
  });
}

function buildIssues(
  inspection: RunInspection,
  approvals: ApprovalQueueItemView[],
): string[] {
  const issues: string[] = [];

  if (inspection.summary.pendingApprovals > 0) {
    issues.push(`${inspection.summary.pendingApprovals} approval request(s) are waiting for a decision.`);
  }
  if (inspection.summary.latestBlocker) {
    issues.push(inspection.summary.latestBlocker);
  }
  if (inspection.summary.latestFailure) {
    issues.push(inspection.summary.latestFailure);
  }
  if (inspection.summary.latestReplan) {
    issues.push(inspection.summary.latestReplan);
  }
  if (issues.length === 0 && approvals.length === 0) {
    issues.push("No blocking issue is currently reported for this run.");
  }

  return issues;
}

function resolveFocusLaneId(inspection: RunInspection, lanes: LaneView[]): string {
  if (inspection.run.currentTaskId && lanes.some((lane) => lane.laneId === inspection.run.currentTaskId)) {
    return inspection.run.currentTaskId;
  }

  return (
    lanes.find((lane) => lane.status === "awaiting_approval")?.laneId ??
    lanes.find((lane) => lane.status === "blocked")?.laneId ??
    lanes.find((lane) => lane.status === "running")?.laneId ??
    lanes[0]?.laneId ??
    "run"
  );
}

function buildStageLabel(inspection: RunInspection): string {
  const completed = inspection.summary.completedTasks;
  const total = Object.keys(inspection.graph.tasks).length;
  const status = inspection.run.status.replaceAll("_", " ");
  const activeTask = inspection.run.currentTaskId
    ? inspection.graph.tasks[inspection.run.currentTaskId]?.title
    : undefined;

  return activeTask
    ? `${status} · ${completed}/${total} complete · ${activeTask}`
    : `${status} · ${completed}/${total} complete`;
}

function compareLanes(left: LaneView, right: LaneView): number {
  const leftPriority = getLanePriority(left.status);
  const rightPriority = getLanePriority(right.status);
  return leftPriority - rightPriority || right.lastActivityAt.localeCompare(left.lastActivityAt);
}

function getLanePriority(status: WorkspaceLaneStatus): number {
  switch (status) {
    case "awaiting_approval":
      return 0;
    case "blocked":
      return 1;
    case "running":
      return 2;
    case "failed":
      return 3;
    case "paused":
      return 4;
    case "completed":
      return 5;
    default:
      return 6;
  }
}

function buildLaneRole(task: TaskSpec): string {
  if (task.assignedAgent) {
    return task.assignedAgent;
  }
  if (task.preferredAgent) {
    return task.preferredAgent;
  }
  if (task.requiredCapabilities.length > 0) {
    return task.requiredCapabilities.join(", ");
  }
  return `${task.kind} lane`;
}

function buildStatusReason(
  task: TaskSpec,
  validation: InspectionValidationItem | undefined,
  approvals: ApprovalQueueItemView[],
  inspection: RunInspection,
): string {
  if (approvals.length > 0) {
    return approvals[0]!.summary;
  }

  switch (task.status) {
    case "pending":
      return "Waiting for dependencies before this task can be scheduled.";
    case "ready":
      return "Ready to resume execution.";
    case "routing":
      return "Selecting an agent for this task.";
    case "context_building":
      return "Building task context from memory, blackboard, and artifacts.";
    case "queued":
      return "Queued for execution.";
    case "running":
      return "Task process is currently running.";
    case "validating":
      return "Execution finished and validation is in progress.";
    case "completed":
      return validation?.summary ?? "Task completed successfully.";
    case "failed_retryable":
      return validation?.summary ?? "Task failed and can be retried.";
    case "failed_terminal":
      return validation?.summary ?? inspection.summary.latestFailure ?? "Task failed.";
    case "blocked":
      return validation?.summary ?? inspection.summary.latestBlocker ?? "Task is blocked.";
    case "cancelled":
      return "Task was cancelled.";
    case "awaiting_approval":
      return approvals[0]?.summary ?? "Waiting for approval before execution can continue.";
    default:
      return `Task is currently ${task.status}.`;
  }
}

function buildApprovalState(
  status: WorkspaceLaneStatus,
  approvals: ApprovalQueueItemView[],
): string {
  if (approvals.length > 0 || status === "awaiting_approval") {
    return "Waiting for decision";
  }
  if (status === "blocked") {
    return "Blocked";
  }
  return "No pending approval";
}

function buildTerminalPreview(
  task: TaskSpec,
  taskEvents: RunEvent[],
  validation: InspectionValidationItem | undefined,
): string[] {
  const lines = taskEvents
    .filter((event) => event.type === "agent_message")
    .flatMap((event) => {
      const payload = event.payload as { message?: unknown };
      return typeof payload.message === "string"
        ? payload.message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        : [];
    });

  if (lines.length > 0) {
    return lines.slice(-6);
  }

  const fallback = [
    `$ task ${task.id}`,
    `> ${task.title}`,
    `> status: ${task.status}`,
    validation?.summary ? `> ${validation.summary}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return fallback.length > 0 ? fallback : ["No terminal output recorded yet."];
}

function buildHandoffHint(
  task: TaskSpec,
  status: WorkspaceLaneStatus,
  graph: RunGraph,
): string {
  const downstreamCount = graph.edges.filter((edge) => edge.from === task.id).length;

  if (status === "awaiting_approval") {
    return "Resolve the pending approval to keep the run moving.";
  }
  if (status === "blocked") {
    return "Clear the blocker before downstream work can continue.";
  }
  if (status === "completed" && downstreamCount > 0) {
    return `${downstreamCount} downstream task(s) can continue from here.`;
  }
  if (status === "running") {
    return "This lane is currently active.";
  }
  if (status === "failed") {
    return "Inspect the latest failure before resuming.";
  }
  return "Monitor this lane for the next transition.";
}

function isActiveTaskStatus(status: TaskStatus): boolean {
  return (
    status === "routing" ||
    status === "context_building" ||
    status === "queued" ||
    status === "running" ||
    status === "awaiting_approval" ||
    status === "validating"
  );
}

function isActiveSessionBackfillTaskStatus(status: TaskStatus): boolean {
  return status === "running" || status === "awaiting_approval";
}

function mapRunStatus(status: string): WorkspaceLaneStatus {
  switch (status) {
    case "waiting_approval":
      return "awaiting_approval";
    case "paused":
    case "planning":
    case "ready":
    case "replanning":
    case "created":
      return "paused";
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      return "running";
  }
}

function mapTaskStatus(status: TaskStatus): WorkspaceLaneStatus {
  switch (status) {
    case "awaiting_approval":
      return "awaiting_approval";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    case "cancelled":
    case "failed_retryable":
    case "failed_terminal":
      return "failed";
    case "pending":
    case "ready":
      return "paused";
    default:
      return "running";
  }
}

function mapValidationState(
  outcome: InspectionValidationItem["outcome"] | undefined,
  taskStatus: TaskStatus,
): "pass" | "warn" | "fail" {
  if (outcome === "pass" || taskStatus === "completed") {
    return "pass";
  }
  if (
    outcome === "fail_retryable" ||
    outcome === "fail_replan_needed" ||
    outcome === "blocked" ||
    taskStatus === "blocked" ||
    taskStatus === "failed_retryable" ||
    taskStatus === "failed_terminal"
  ) {
    return "fail";
  }
  return "warn";
}

function resolveHandoffStatus(
  fromStatus: WorkspaceLaneStatus | undefined,
  toStatus: WorkspaceLaneStatus | undefined,
): HandoffView["status"] {
  if (fromStatus === "completed") {
    return toStatus === "running" ? "in_progress" : "delivered";
  }
  if (toStatus === "running" || toStatus === "awaiting_approval") {
    return "in_progress";
  }
  return "queued";
}

function resolveTaskId(event: RunEvent): string | undefined {
  if (event.taskId) {
    return event.taskId;
  }
  const payload = event.payload as { taskId?: unknown };
  return typeof payload.taskId === "string" ? payload.taskId : undefined;
}

function resolveApprovalRequestedAt(events: RunEvent[], requestId: string): string {
  const event = events.find((candidate) => {
    if (candidate.type !== "approval_requested") {
      return false;
    }
    const payload = candidate.payload as { requestId?: unknown };
    return payload.requestId === requestId;
  });
  return event?.timestamp ?? "";
}



