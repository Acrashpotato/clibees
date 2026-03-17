import { computed } from "vue";

import {
  getRunInspectPath,
  getRunWorkspacePath,
  getSessionDetailPath,
  getTaskDetailPath,
} from "../workspace";
import {
  selectWorkspaceOverviewViewModel,
  type WorkspaceOverviewBlockerItem,
  type WorkspaceOverviewNextAction,
  type WorkspaceOverviewRunSnapshot,
} from "../workspace-overview-selectors";
import type {
  WorkspaceProjectionRiskLevel,
  WorkspaceProjectionStatus,
} from "../workspace-projection";
import { useWorkspaceProjection } from "./useWorkspaceProjection";

export interface WorkspaceOverviewActionViewModel {
  kind: WorkspaceOverviewNextAction["kind"];
  title: string;
  summary: string;
  to?: string;
}

export interface WorkspaceOverviewFocusViewModel {
  taskId: string;
  title: string;
  status: WorkspaceProjectionStatus;
  riskLevel: WorkspaceProjectionRiskLevel;
  statusReason: string;
  ownerLabel: string;
  lastActivityAt: string;
  dependsOnCount: number;
  downstreamCount: number;
  to: string;
}

export interface WorkspaceOverviewBlockerViewModel {
  id: string;
  title: string;
  summary: string;
  status: "blocked" | "failed";
  to: string;
}

function inspectPath(runId: string): string {
  return getRunInspectPath(runId);
}

function resolveTarget(
  runId: string,
  target: Pick<WorkspaceOverviewBlockerItem, "targetType" | "targetId">,
): string {
  if (target.targetType === "task" && target.targetId) {
    return getTaskDetailPath(runId, target.targetId);
  }

  if (target.targetType === "task_session" && target.targetId) {
    return getSessionDetailPath(runId, target.targetId);
  }

  return inspectPath(runId);
}

export function useWorkspaceOverview() {
  const {
    projection,
    resolvedRunId,
    loading,
    error,
    mutating,
    refresh,
    resumeRun,
  } = useWorkspaceProjection();

  const viewModel = computed(() => selectWorkspaceOverviewViewModel(projection.value));

  const runId = computed(() => resolvedRunId.value ?? viewModel.value.run.runId);
  const inspectTo = computed(() => inspectPath(runId.value));

  const focusTask = computed<WorkspaceOverviewFocusViewModel | undefined>(() => {
    if (!viewModel.value.focusTask) {
      return undefined;
    }

    return {
      ...viewModel.value.focusTask,
      to: getTaskDetailPath(runId.value, viewModel.value.focusTask.taskId),
    };
  });

  const blockers = computed<WorkspaceOverviewBlockerViewModel[]>(() =>
    viewModel.value.blockers.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      status: item.status,
      to: resolveTarget(runId.value, item),
    })),
  );

  const nextAction = computed<WorkspaceOverviewActionViewModel | undefined>(() => {
    const action = viewModel.value.nextAction;
    if (!action) {
      return undefined;
    }

    if (action.kind === "resume") {
      return {
        kind: "resume",
        title: action.title,
        summary: action.summary,
      };
    }

    return {
      kind: "navigate",
      title: action.title,
      summary: action.summary,
      to: resolveTarget(runId.value, {
        targetType: action.targetType ?? "inspect",
        targetId: action.targetId,
      }),
    };
  });

  const blockerTop = computed(() => blockers.value.slice(0, 3));

  return {
    loading,
    error,
    mutating,
    refresh,
    resumeRun,
    inspectTo,
    runId,
    run: computed<WorkspaceOverviewRunSnapshot>(() => viewModel.value.run),
    focusTask,
    nextAction,
    blockerTop,
    blockerTotalCount: computed(() => blockers.value.length),
    workspaceOverviewTo: computed(() => getRunWorkspacePath(runId.value)),
  };
}
