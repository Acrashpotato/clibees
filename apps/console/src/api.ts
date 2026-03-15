import type { ApprovalItem, InspectView, RunSummaryView, WorkspaceView } from "./view-models";
import type { ApprovalQueueProjectionView } from "./approval-projection";
import type { AuditTimelineProjectionView } from "./audit-timeline-projection";
import type {
  SessionDetailProjectionView,
  TaskDetailProjectionView,
} from "./detail-projection";
import type { UiProjectionEnvelope, WorkspaceProjectionView } from "./workspace-projection";

interface LegacyApprovalItem {
  id: string;
  runId: string;
  taskId?: string;
  laneId: string;
  title: string;
  summary: string;
  riskLevel: ApprovalItem["riskLevel"];
  requestedAt: string;
  actions: string[];
}

interface LegacyWorkspaceTaskCardView {
  laneId: string;
  agentId: string;
  role: string;
  status: WorkspaceView["runStatus"];
  statusReason: string;
  currentTaskTitle: string;
  lastActivityAt: string;
  approvalState: string;
  riskLevel: ApprovalItem["riskLevel"];
  terminalPreview: string[];
  handoffHint: string;
  artifacts: WorkspaceView["tasks"][number]["artifacts"];
  validations: WorkspaceView["tasks"][number]["validations"];
}

interface LegacyTaskHandoffView {
  id: string;
  fromLaneId: string;
  toLaneId: string;
  title: string;
  summary: string;
  reason: string;
  ownerLabel: string;
  status: WorkspaceView["handoffs"][number]["status"];
}

interface LegacyWorkspaceView {
  runId: string;
  goal: string;
  runStatus: WorkspaceView["runStatus"];
  stage: string;
  metrics: WorkspaceView["metrics"];
  lanes: LegacyWorkspaceTaskCardView[];
  approvals: LegacyApprovalItem[];
  handoffs: LegacyTaskHandoffView[];
  focusLaneId: string;
  issues: string[];
  createdAt: string;
  updatedAt: string;
  canResume: boolean;
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string | { message?: string };
    };
    const message =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message ?? `Request failed with status ${response.status}.`;
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

function mapApprovalItem(raw: LegacyApprovalItem): ApprovalItem {
  return {
    id: raw.id,
    runId: raw.runId,
    ...(raw.taskId ? { taskId: raw.taskId } : {}),
    title: raw.title,
    summary: raw.summary,
    riskLevel: raw.riskLevel,
    requestedAt: raw.requestedAt,
    actions: raw.actions,
  };
}

function mapWorkspaceView(raw: LegacyWorkspaceView): WorkspaceView {
  return {
    runId: raw.runId,
    goal: raw.goal,
    runStatus: raw.runStatus,
    stage: raw.stage,
    metrics: raw.metrics,
    tasks: raw.lanes.map((lane) => ({
      taskId: lane.laneId,
      agentId: lane.agentId,
      role: lane.role,
      status: lane.status,
      statusReason: lane.statusReason,
      currentTaskTitle: lane.currentTaskTitle,
      lastActivityAt: lane.lastActivityAt,
      approvalState: lane.approvalState,
      riskLevel: lane.riskLevel,
      terminalPreview: lane.terminalPreview,
      handoffHint: lane.handoffHint,
      artifacts: lane.artifacts,
      validations: lane.validations,
    })),
    approvals: raw.approvals.map(mapApprovalItem),
    handoffs: raw.handoffs.map((handoff) => ({
      id: handoff.id,
      fromTaskId: handoff.fromLaneId,
      toTaskId: handoff.toLaneId,
      title: handoff.title,
      summary: handoff.summary,
      reason: handoff.reason,
      ownerLabel: handoff.ownerLabel,
      status: handoff.status,
    })),
    focusTaskId: raw.focusLaneId,
    issues: raw.issues,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    canResume: raw.canResume,
  };
}

export function listRuns() {
  return request<RunSummaryView[]>("/api/runs");
}

export async function getWorkspace(runId: string) {
  const raw = await request<LegacyWorkspaceView>(`/api/runs/${encodeURIComponent(runId)}/workspace`);
  return mapWorkspaceView(raw);
}

export async function getWorkspaceProjection(runId: string) {
  const response = await request<UiProjectionEnvelope<WorkspaceProjectionView>>(
    `/api/runs/${encodeURIComponent(runId)}/projections/workspace`,
  );
  return response.data;
}

export async function getTaskDetailProjection(runId: string, taskId: string) {
  const response = await request<UiProjectionEnvelope<TaskDetailProjectionView>>(
    `/api/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/projection`,
  );
  return response.data;
}

export async function getSessionDetailProjection(runId: string, sessionId: string) {
  const response = await request<UiProjectionEnvelope<SessionDetailProjectionView>>(
    `/api/runs/${encodeURIComponent(runId)}/sessions/${encodeURIComponent(sessionId)}/projection`,
  );
  return response.data;
}

export async function getApprovalQueueProjection(options: {
  runId?: string;
  state?: "pending" | "approved" | "rejected";
  riskLevel?: ApprovalQueueProjectionView["items"][number]["riskLevel"];
  limit?: number;
} = {}) {
  const params = new URLSearchParams();

  if (options.state) {
    params.set("state", options.state);
  }

  if (options.riskLevel) {
    params.set("riskLevel", options.riskLevel);
  }

  if (options.limit) {
    params.set("limit", String(options.limit));
  }

  const path = options.runId
    ? `/api/runs/${encodeURIComponent(options.runId)}/projections/approval-queue`
    : "/api/projections/approval-queue";
  const query = params.toString();
  const response = await request<UiProjectionEnvelope<ApprovalQueueProjectionView>>(
    `${path}${query ? `?${query}` : ""}`,
  );
  return response.data;
}

export async function getAuditTimelineProjection(runId: string) {
  const response = await request<UiProjectionEnvelope<AuditTimelineProjectionView>>(
    `/api/runs/${encodeURIComponent(runId)}/projections/audit-timeline`,
  );
  return response.data;
}
export async function listApprovals(runId?: string) {
  const raw = await request<LegacyApprovalItem[]>(
    runId ? `/api/runs/${encodeURIComponent(runId)}/approvals` : "/api/approvals",
  );
  return raw.map(mapApprovalItem);
}

export function getInspect(runId: string) {
  return request<InspectView>(`/api/runs/${encodeURIComponent(runId)}/inspect`);
}

export function createRun(goal: string, options: { autoResume?: boolean } = {}) {
  return request<{ runId: string }>("/api/runs", {
    method: "POST",
    body: JSON.stringify({ goal, autoResume: options.autoResume ?? false }),
  });
}

export function resumeRun(runId: string) {
  return request<{ runId: string }>(`/api/runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function approveRequest(runId: string, requestId: string, note?: string) {
  return request<{ runId: string }>(
    `/api/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(requestId)}/approve`,
    {
      method: "POST",
      body: JSON.stringify({ actor: "console-user", ...(note ? { note } : {}) }),
    },
  );
}

export function rejectRequest(runId: string, requestId: string, note?: string) {
  return request<{ runId: string }>(
    `/api/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(requestId)}/reject`,
    {
      method: "POST",
      body: JSON.stringify({ actor: "console-user", ...(note ? { note } : {}) }),
    },
  );
}

export { ApiError };
