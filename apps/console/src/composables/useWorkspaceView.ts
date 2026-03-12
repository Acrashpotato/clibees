import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { getWorkspace, listRuns, resumeRun } from "../api";
import type { ActionQueueItem, WorkspaceView } from "../types";
import { createEmptyWorkspace, getActionQueue, getFocusLane } from "../workspace";
import { usePreferences } from "./usePreferences";

export function useWorkspaceView() {
  const route = useRoute();
  const { locale } = usePreferences();

  const runScopeId = computed(() => (typeof route.params.runId === "string" ? route.params.runId : undefined));
  const resolvedRunId = ref<string | undefined>(runScopeId.value);
  const workspace = ref<WorkspaceView>(createEmptyWorkspace(runScopeId.value));
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

    if (workspace.value.runStatus === "completed" || workspace.value.runStatus === "failed") {
      return;
    }

    pollHandle = setInterval(() => {
      void loadWorkspace(false);
    }, 2000);
  }

  async function resolveRunId(): Promise<string | undefined> {
    if (runScopeId.value) {
      return runScopeId.value;
    }

    const runs = await listRuns();
    return runs[0]?.runId;
  }

  async function loadWorkspace(showLoading = true): Promise<void> {
    if (showLoading) {
      loading.value = true;
    }

    try {
      error.value = "";
      resolvedRunId.value = await resolveRunId();

      if (!resolvedRunId.value) {
        workspace.value = createEmptyWorkspace();
        stopPolling();
        return;
      }

      workspace.value = await getWorkspace(resolvedRunId.value);
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
      await loadWorkspace(false);
    } finally {
      mutating.value = false;
    }
  }

  watch(
    () => route.fullPath,
    () => {
      void loadWorkspace();
    },
    { immediate: true },
  );

  watch(
    () => workspace.value.runStatus,
    () => {
      startPolling();
    },
  );

  onBeforeUnmount(() => {
    stopPolling();
  });

  const focusLane = computed(() => getFocusLane(workspace.value));
  const actionQueue = computed<ActionQueueItem[]>(() => getActionQueue(workspace.value, locale.value));

  return {
    workspace,
    focusLane,
    actionQueue,
    runScopeId,
    resolvedRunId,
    loading,
    error,
    mutating,
    refresh: () => loadWorkspace(false),
    resumeRun: handleResume,
  };
}
