import { onBeforeUnmount, ref } from "vue";

export interface EntityProjectionOptions<TProjection, TStatus> {
  getRunId: () => string;
  getEntityId: () => string;
  createEmptyProjection: (runId: string, entityId: string) => TProjection;
  fetchProjection: (runId: string, entityId: string) => Promise<TProjection>;
  getProjectionStatus: (projection: TProjection) => TStatus;
  isTerminalStatus: (status: TStatus) => boolean;
  getMissingParamMessage: () => string;
  pollIntervalMs?: number;
  emptyRunId?: string;
  emptyEntityId?: string;
}

export function useEntityProjection<TProjection, TStatus>(
  options: EntityProjectionOptions<TProjection, TStatus>,
) {
  const projection = ref<TProjection>(
    options.createEmptyProjection(options.getRunId(), options.getEntityId()),
  );
  const loading = ref(false);
  const error = ref("");
  let pollHandle: ReturnType<typeof setInterval> | undefined;

  function stopPolling() {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = undefined;
    }
  }

  function startPolling() {
    stopPolling();

    const intervalMs = options.pollIntervalMs ?? 2000;
    if (intervalMs <= 0) {
      return;
    }

    const runId = options.getRunId();
    const entityId = options.getEntityId();
    if (!runId || !entityId) {
      return;
    }

    if (options.isTerminalStatus(options.getProjectionStatus(projection.value))) {
      return;
    }

    pollHandle = setInterval(() => {
      void loadProjection(false);
    }, intervalMs);
  }

  async function loadProjection(showLoading = true): Promise<void> {
    const runId = options.getRunId();
    const entityId = options.getEntityId();

    if (!runId || !entityId) {
      error.value = options.getMissingParamMessage();
      projection.value = options.createEmptyProjection(
        runId || options.emptyRunId || "workspace",
        entityId || options.emptyEntityId || "item",
      );
      stopPolling();
      return;
    }

    if (showLoading) {
      loading.value = true;
    }

    try {
      error.value = "";
      projection.value = await options.fetchProjection(runId, entityId);
      startPolling();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
      stopPolling();
    } finally {
      loading.value = false;
    }
  }

  onBeforeUnmount(() => {
    stopPolling();
  });

  return {
    projection,
    loading,
    error,
    loadProjection,
    startPolling,
    stopPolling,
  };
}
