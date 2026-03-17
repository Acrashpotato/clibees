import { computed, watch } from "vue";
import { useRoute } from "vue-router";

import { getWorkspaceProjection } from "../api";
import {
  createEmptyWorkspaceProjection,
  type WorkspaceProjectionStatus,
  type WorkspaceProjectionView,
} from "../workspace-projection";
import { useConsoleSettings } from "./useConsoleSettings";
import { useRunScopedResource } from "./useRunScopedResource";

function isTerminalRunStatus(status: WorkspaceProjectionStatus): boolean {
  return status === "completed" || status === "failed";
}

export function useWorkspaceProjection() {
  const route = useRoute();
  const { settings } = useConsoleSettings();

  const runScopeId = computed(() =>
    typeof route.params.runId === "string" ? route.params.runId : undefined,
  );

  const resource = useRunScopedResource<WorkspaceProjectionView, WorkspaceProjectionStatus>({
    getRunScopeId: () => runScopeId.value,
    createEmpty: (runId) => createEmptyWorkspaceProjection(runId),
    fetchData: (runId) => getWorkspaceProjection(runId),
    getStatus: (data) => data.run.status,
    isTerminalStatus: isTerminalRunStatus,
    getPollIntervalMs: () => settings.value.workspaceAutoRefreshSec * 1000,
  });

  watch(
    () => route.fullPath,
    () => {
      void resource.load();
    },
    { immediate: true },
  );

  watch(
    () => settings.value.workspaceAutoRefreshSec,
    () => {
      resource.startPolling();
    },
  );

  return {
    projection: resource.data,
    resolvedRunId: resource.resolvedRunId,
    loading: resource.loading,
    error: resource.error,
    mutating: resource.mutating,
    refresh: () => resource.load(false),
    resumeRun: resource.resumeScopedRun,
  };
}
