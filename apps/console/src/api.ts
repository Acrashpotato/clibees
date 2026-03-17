import type { ApprovalItem, InspectView, RunSummaryView, WorkspaceView } from "./view-models";
import type { ApprovalQueueProjectionView } from "./approval-projection";
import type { AuditTimelineProjectionView } from "./audit-timeline-projection";
import type {
  SessionDetailProjectionView,
  TaskDetailProjectionView,
} from "./detail-projection";
import type { ManagerChatProjectionView } from "./manager-projection";
import type { WorkerpollProjectionView } from "./workerpoll-projection";
import type { TaskBoardProjectionView } from "./task-board-projection";
import type { UiProjectionEnvelope, WorkspaceProjectionView } from "./workspace-projection";
import type { SelectedCli } from "../../../src/ui-api/selected-cli.js";

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

export type { SelectedCli };

export interface CreateRunPayload {
  goal: string;
  cli: SelectedCli;
  allowOutsideWorkspaceWrites?: boolean;
  autoResume?: boolean;
}

export interface PostThreadMessagePayload {
  actorId?: string;
  body: string;
  clientRequestId?: string;
  note?: string;
  replyToMessageId?: string;
}

export interface StartSessionTerminalPayload {
  cols?: number;
  rows?: number;
  launchCli?: boolean;
  launchCodex?: boolean;
}

export interface SessionTerminalBootstrap {
  terminalSessionId: string;
  wsPath: string;
}

export interface ArtifactContentPreview {
  artifactId: string;
  kind: string;
  uri: string;
  summary: string;
  source: "workspace_file" | "artifact_metadata";
  contentType: "text/plain" | "application/json";
  body: string;
  truncated: boolean;
  filePath?: string;
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

export async function getTaskBoardProjection(runId: string) {
  const response = await request<UiProjectionEnvelope<TaskBoardProjectionView>>(
    `/api/runs/${encodeURIComponent(runId)}/projections/task-board`,
  );
  return response.data;
}

export async function getManagerChatProjection(runId: string) {
  const response = await request<UiProjectionEnvelope<ManagerChatProjectionView>>(
    `/api/runs/${encodeURIComponent(runId)}/projections/manager-chat`,
  );
  return response.data;
}

export async function getWorkerpollProjection(runId: string) {
  const response = await request<UiProjectionEnvelope<WorkerpollProjectionView>>(
    `/api/runs/${encodeURIComponent(runId)}/projections/workerpoll`,
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

export function createRun(requestBody: CreateRunPayload) {
  return request<{ runId: string }>("/api/runs", {
    method: "POST",
    body: JSON.stringify(requestBody),
  });
}

export function resumeRun(runId: string) {
  return request<{ runId: string }>(`/api/runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

function isRouteNotFoundError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    error.message.startsWith("Route not found:")
  );
}

export async function deleteRun(runId: string) {
  const encodedRunId = encodeURIComponent(runId);
  const endpoints: Array<{ path: string; method: "POST" | "DELETE"; withBody: boolean }> = [
    {
      path: `/api/runs/${encodedRunId}/delete`,
      method: "POST",
      withBody: true,
    },
    {
      path: `/api/runs/${encodedRunId}`,
      method: "DELETE",
      withBody: false,
    },
  ];

  let lastError: unknown;
  for (const endpoint of endpoints) {
    try {
      return await request<{ runId: string; deleted: boolean }>(endpoint.path, {
        method: endpoint.method,
        ...(endpoint.withBody ? { body: JSON.stringify({}) } : {}),
      });
    } catch (caught) {
      if (!isRouteNotFoundError(caught)) {
        throw caught;
      }
      lastError = caught;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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

export function startSessionTerminal(
  runId: string,
  sessionId: string,
  payload: StartSessionTerminalPayload = {},
) {
  return request<SessionTerminalBootstrap>(
    `/api/runs/${encodeURIComponent(runId)}/sessions/${encodeURIComponent(sessionId)}/terminal`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function getArtifactContent(runId: string, artifactId: string) {
  return request<ArtifactContentPreview>(
    `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/content`,
  );
}

export async function postThreadMessage(
  runId: string,
  threadId: string,
  payload: PostThreadMessagePayload,
) {
  return request<{
    action: "post_thread_message";
    data: {
      runId: string;
      threadId: string;
      runStatus: string;
      resumed: boolean;
      message: {
        messageId: string;
        body: string;
        role: string;
        actorId: string;
        createdAt: string;
      };
    };
  }>(
    `/api/runs/${encodeURIComponent(runId)}/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        actorId: payload.actorId ?? "console-user",
        body: payload.body,
        clientRequestId: payload.clientRequestId,
        note: payload.note,
        replyToMessageId: payload.replyToMessageId,
      }),
    },
  );
}

export async function interactSession(
  runId: string,
  sessionId: string,
  payload: PostThreadMessagePayload,
) {
  return request<{
    action: "interact_session";
    data: {
      runId: string;
      sessionId: string;
      threadId: string;
      runStatus: string;
      resumed: boolean;
      message: {
        messageId: string;
        body: string;
        role: string;
        actorId: string;
        createdAt: string;
      };
    };
  }>(
    `/api/runs/${encodeURIComponent(runId)}/sessions/${encodeURIComponent(sessionId)}/interact`,
    {
      method: "POST",
      body: JSON.stringify({
        actorId: payload.actorId ?? "console-user",
        body: payload.body,
        clientRequestId: payload.clientRequestId,
        note: payload.note,
        replyToMessageId: payload.replyToMessageId,
      }),
    },
  );
}

export { ApiError };

