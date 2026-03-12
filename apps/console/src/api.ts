import type { ApprovalItem, InspectView, RunSummaryView, WorkspaceView } from "./types";

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
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(payload.error ?? `Request failed with status ${response.status}.`, response.status);
  }

  return (await response.json()) as T;
}

export function listRuns() {
  return request<RunSummaryView[]>("/api/runs");
}

export function getWorkspace(runId: string) {
  return request<WorkspaceView>(`/api/runs/${encodeURIComponent(runId)}/workspace`);
}

export function listApprovals(runId?: string) {
  return request<ApprovalItem[]>(runId ? `/api/runs/${encodeURIComponent(runId)}/approvals` : "/api/approvals");
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
