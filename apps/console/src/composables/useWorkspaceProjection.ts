import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { getWorkspaceProjection, listRuns, resumeRun } from "../api";
import { createEmptyWorkspaceProjection, type WorkspaceProjectionView } from "../workspace-projection";

export function useWorkspaceProjection() {
  const route = useRoute();

  const runScopeId = computed(() => (typeof route.params.runId === "string" ? route.params.runId : undefined));
  const resolvedRunId = ref<string | undefined>(runScopeId.value);
  const projection = ref<WorkspaceProjectionView>(createEmptyWorkspaceProjection(runScopeId.value));
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

    if (projection.value.run.status === "completed" || projection.value.run.status === "failed") {
      return;
    }

    pollHandle = setInterval(() => {
      void loadProjection(false);
    }, 2000);
  }

  async function resolveRunId(): Promise<string | undefined> {
    if (runScopeId.value) {
      return runScopeId.value;
    }

    const runs = await listRuns();
    return runs[0]?.runId;
  }

  async function loadProjection(showLoading = true): Promise<void> {
    if (showLoading) {
      loading.value = true;
    }

    try {
      error.value = "";
      resolvedRunId.value = await resolveRunId();

      if (!resolvedRunId.value) {
        projection.value = createEmptyWorkspaceProjection();
        stopPolling();
        return;
      }

      projection.value = await getWorkspaceProjection(resolvedRunId.value);
      startPolling();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
      stopPolling();
    } finally {
      loading.value = false;
    }
  }

  async function handleResume(): Promise<void> {
    if (!resolvedRunId.value) {
      return;
    }

    mutating.value = true;
    try {
      await resumeRun(resolvedRunId.value);
      await loadProjection(false);
    } finally {
      mutating.value = false;
    }
  }

  watch(
    () => route.fullPath,
    () => {
      void loadProjection();
    },
    { immediate: true },
  );

  watch(
    () => projection.value.run.status,
    () => {
      startPolling();
    },
  );

  onBeforeUnmount(() => {
    stopPolling();
  });

  return {
    projection,
    resolvedRunId,
    loading,
    error,
    mutating,
    refresh: () => loadProjection(false),
    resumeRun: handleResume,
  };
}
