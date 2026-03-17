import { computed, watch } from "vue";
import { useRoute } from "vue-router";

import { getWorkspace } from "../api";
import type { ActionQueueItem, WorkspaceView } from "../view-models";
import { createEmptyWorkspace, getActionQueue, getFocusTask } from "../workspace";
import { usePreferences } from "./usePreferences";
import { useRunScopedResource } from "./useRunScopedResource";

function isTerminalRunStatus(status: WorkspaceView["runStatus"]): boolean {
  return status === "completed" || status === "failed";
}

export function useWorkspaceView() {
  const route = useRoute();
  const { locale } = usePreferences();

  const runScopeId = computed(() =>
    typeof route.params.runId === "string" ? route.params.runId : undefined,
  );

  const resource = useRunScopedResource<WorkspaceView, WorkspaceView["runStatus"]>({
    getRunScopeId: () => runScopeId.value,
    createEmpty: (runId) => createEmptyWorkspace(runId),
    fetchData: (runId) => getWorkspace(runId),
    getStatus: (data) => data.runStatus,
    isTerminalStatus: isTerminalRunStatus,
    getPollIntervalMs: () => 2000,
  });

  watch(
    () => route.fullPath,
    () => {
      void resource.load();
    },
    { immediate: true },
  );

  const focusTask = computed(() => getFocusTask(resource.data.value));
  const actionQueue = computed<ActionQueueItem[]>(() =>
    getActionQueue(resource.data.value, locale.value),
  );

  return {
    workspace: resource.data,
    focusTask,
    actionQueue,
    runScopeId,
    resolvedRunId: resource.resolvedRunId,
    loading: resource.loading,
    error: resource.error,
    mutating: resource.mutating,
    refresh: () => resource.load(false),
    resumeRun: resource.resumeScopedRun,
  };
}
