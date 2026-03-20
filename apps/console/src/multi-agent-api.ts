interface ApiErrorPayload {
  error?: string | { message?: string };
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
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    const message =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message ?? `Request failed with status ${response.status}.`;
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export interface MultiAgentRunSummaryView {
  runId: string;
  updatedAt: string;
  totalBytes: number;
}

export interface MultiAgentSummaryView {
  stateRootDir: string;
  memoryRootDir: string;
  runs: {
    totalCount: number;
    totalBytes: number;
    items: MultiAgentRunSummaryView[];
  };
  memory: {
    recordsCount: number;
    indexCount: number;
    totalBytes: number;
  };
}

export interface MultiAgentCleanupResponse {
  removedRunIds: string[];
  keptRunIds: string[];
  memory: {
    before: number;
    after: number;
    removed: number;
    cleared: boolean;
    keptForRunId?: string;
  };
}

export async function getMultiAgentSummary() {
  return request<MultiAgentSummaryView>("/api/system/multi-agent/summary");
}

export async function cleanupMultiAgentData(payload: {
  keepRunId?: string;
  clearMemory?: boolean;
}) {
  return request<MultiAgentCleanupResponse>("/api/system/multi-agent/cleanup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export { ApiError };
