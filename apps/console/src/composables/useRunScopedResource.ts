import { onBeforeUnmount, ref } from "vue";

import { listRuns, resumeRun } from "../api";

export interface RunScopedResourceOptions<TData, TStatus> {
  getRunScopeId: () => string | undefined;
  createEmpty: (runId?: string) => TData;
  fetchData: (runId: string) => Promise<TData>;
  getStatus: (data: TData) => TStatus;
  isTerminalStatus: (status: TStatus) => boolean;
  getPollIntervalMs: () => number;
}

export function useRunScopedResource<TData, TStatus>(
  options: RunScopedResourceOptions<TData, TStatus>,
) {
  const resolvedRunId = ref<string | undefined>(options.getRunScopeId());
  const data = ref<TData>(options.createEmpty(resolvedRunId.value));
  const loading = ref(false);
  const error = ref("");
  const mutating = ref(false);
  let pollHandle: ReturnType<typeof setInterval> | undefined;

  function stopPolling() {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = undefined;
    }
  }

  function startPolling() {
    stopPolling();

    if (!resolvedRunId.value) {
      return;
    }

    if (options.isTerminalStatus(options.getStatus(data.value))) {
      return;
    }

    const intervalMs = options.getPollIntervalMs();
    if (intervalMs <= 0) {
      return;
    }

    pollHandle = setInterval(() => {
      void load(false);
    }, intervalMs);
  }

  async function resolveRunId(): Promise<string | undefined> {
    const runScopeId = options.getRunScopeId();
    if (runScopeId) {
      return runScopeId;
    }

    const runs = await listRuns();
    return runs[0]?.runId;
  }

  async function load(showLoading = true): Promise<void> {
    if (showLoading) {
      loading.value = true;
    }

    try {
      error.value = "";
      resolvedRunId.value = await resolveRunId();

      if (!resolvedRunId.value) {
        data.value = options.createEmpty();
        stopPolling();
        return;
      }

      data.value = await options.fetchData(resolvedRunId.value);
      startPolling();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
      stopPolling();
    } finally {
      loading.value = false;
    }
  }

  async function resumeScopedRun(): Promise<void> {
    if (!resolvedRunId.value || mutating.value) {
      return;
    }

    mutating.value = true;
    try {
      await resumeRun(resolvedRunId.value);
      await load(false);
    } finally {
      mutating.value = false;
    }
  }

  onBeforeUnmount(() => {
    stopPolling();
  });

  return {
    data,
    resolvedRunId,
    loading,
    error,
    mutating,
    load,
    resumeScopedRun,
    startPolling,
    stopPolling,
  };
}
