import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { getTaskDetailProjection } from "../../api";
import { useArtifactPreview } from "../../composables/useArtifactPreview";
import { useChunkedRender } from "../../composables/useChunkedRender";
import { useEntityProjection } from "../../composables/useEntityProjection";
import { usePreferences } from "../../composables/usePreferences";
import {
  createEmptyTaskDetailProjection,
  type TaskDetailDependencyItemView,
  type TaskDetailProjectionView,
  type TaskDetailSessionSourceMode,
} from "../../detail-projection";
import {
  getRunTaskBoardPath,
  getRunWorkspacePath,
  getSessionDetailPath,
  getTaskDetailPath,
  type TaskDetailSection,
} from "../../workspace";

export function useTaskDetailPage() {
  const route = useRoute();
  const router = useRouter();
  const { riskLabel, statusLabel, validationLabel, t } = usePreferences();

  const runId = computed(() => (typeof route.params.runId === "string" ? route.params.runId : ""));
  const taskId = computed(() => (typeof route.params.taskId === "string" ? route.params.taskId : ""));

  const detailTabs = [
    { name: "summary" as const, label: "概览" },
    { name: "dependencies" as const, label: "依赖" },
    { name: "sessions" as const, label: "会话" },
    { name: "artifacts" as const, label: "产物" },
  ] satisfies ReadonlyArray<{ name: TaskDetailSection; label: string }>;

  const routeNameToSection: Partial<Record<string, TaskDetailSection>> = {
    "task-detail-summary": "summary",
    "task-detail-dependencies": "dependencies",
    "task-detail-sessions": "sessions",
    "task-detail-artifacts": "artifacts",
  };

  const activeSection = computed<TaskDetailSection>(() => {
    const routeName = typeof route.name === "string" ? route.name : "";
    return routeNameToSection[routeName] ?? "summary";
  });

  const {
    artifactPreviewById,
    artifactPreviewErrorById,
    artifactPreviewLoadingId,
    isArtifactExpanded,
    toggleArtifactPreview,
    resetArtifactPreview,
  } = useArtifactPreview(() => runId.value);

  const { projection, loading, error, loadProjection } = useEntityProjection<
    TaskDetailProjectionView,
    TaskDetailProjectionView["overview"]["status"]
  >({
    getRunId: () => runId.value,
    getEntityId: () => taskId.value,
    createEmptyProjection: createEmptyTaskDetailProjection,
    fetchProjection: (nextRunId, nextTaskId) => getTaskDetailProjection(nextRunId, nextTaskId),
    getProjectionStatus: (data) => data.overview.status,
    isTerminalStatus: (status) => status === "completed" || status === "failed",
    getMissingParamMessage: () => "缺少 runId 或 taskId，无法打开任务详情。",
    emptyRunId: "workspace",
    emptyEntityId: "task",
  });

  watch(
    () => `${runId.value}::${taskId.value}`,
    () => {
      resetArtifactPreview();
      void loadProjection();
    },
    { immediate: true },
  );

  const overview = computed(() => projection.value.overview);
  const requirementGroups = computed(() => [
    {
      id: "inputs",
      title: "输入上下文",
      items: overview.value.inputs,
      empty: "当前没有额外输入约束。",
    },
    {
      id: "acceptance",
      title: "验收标准",
      items: overview.value.acceptanceCriteria,
      empty: "当前没有单独的验收标准。",
    },
    {
      id: "artifacts",
      title: "预期产物",
      items: overview.value.expectedArtifacts,
      empty: "当前没有显式的预期产物。",
    },
  ]);

  const summaryCards = computed(() => [
    { id: "owner", label: t("fields.owner"), value: overview.value.ownerLabel },
    { id: "sessions", label: "会话数", value: String(overview.value.sessionCount) },
    { id: "active-sessions", label: t("fields.activeSessions"), value: String(overview.value.activeSessionCount) },
    { id: "approvals", label: t("fields.approvals"), value: String(overview.value.pendingApprovalCount) },
    { id: "artifacts", label: "产物数", value: String(overview.value.artifactCount) },
    { id: "activity", label: t("fields.lastActivity"), value: overview.value.latestActivityAt || "-" },
  ]);

  const {
    visibleItems: visibleUpstream,
    hasMore: hasMoreUpstream,
    loadMore: loadMoreUpstream,
  } = useChunkedRender(computed(() => projection.value.upstream), { initialSize: 20, step: 20 });

  const {
    visibleItems: visibleDownstream,
    hasMore: hasMoreDownstream,
    loadMore: loadMoreDownstream,
  } = useChunkedRender(computed(() => projection.value.downstream), { initialSize: 20, step: 20 });

  const {
    visibleItems: visibleSessions,
    hasMore: hasMoreSessions,
    loadMore: loadMoreSessions,
  } = useChunkedRender(computed(() => projection.value.sessions), { initialSize: 20, step: 20 });

  const {
    visibleItems: visibleArtifacts,
    hasMore: hasMoreArtifacts,
    loadMore: loadMoreArtifacts,
  } = useChunkedRender(computed(() => projection.value.artifacts.highlights), { initialSize: 20, step: 20 });

  const primarySession = computed(() =>
    projection.value.sessions.find((session) => session.status === "running" || session.status === "awaiting_approval")
    ?? projection.value.sessions[0],
  );

  function switchSection(nextTab: string): void {
    if (!runId.value || !taskId.value) {
      return;
    }

    const section = detailTabs.find((tab) => tab.name === nextTab)?.name;
    if (!section || section === activeSection.value) {
      return;
    }

    void router.push(getTaskDetailPath(runId.value, taskId.value, section));
  }

  function sessionSourceLabel(sourceMode: TaskDetailSessionSourceMode): string {
    switch (sourceMode) {
      case "task_session":
        return "真实 taskSession";
      case "run_event_backfill":
        return "事件回填";
      default:
        return "状态回填";
    }
  }

  function approvalStateLabel(state: "pending" | "approved" | "rejected"): string {
    switch (state) {
      case "pending":
        return "待决";
      case "approved":
        return "已批准";
      default:
        return "已拒绝";
    }
  }

  function sourceModeLabel(sourceMode: string): string {
    switch (sourceMode) {
      case "approval_request":
        return "审批请求";
      case "inspection_approval":
        return "审批快照";
      case "validation_record":
        return "验证记录";
      default:
        return "状态回填";
    }
  }

  function statusTagType(status: string): "default" | "info" | "success" | "warning" | "error" {
    switch (status) {
      case "running":
        return "info";
      case "completed":
        return "success";
      case "awaiting_approval":
      case "blocked":
        return "warning";
      case "failed":
        return "error";
      default:
        return "default";
    }
  }

  function riskTagType(risk: string): "default" | "warning" | "error" {
    switch (risk) {
      case "high":
        return "error";
      case "medium":
        return "warning";
      default:
        return "default";
    }
  }

  function validationTagType(state: string): "warning" | "success" | "error" {
    if (state === "pass") {
      return "success";
    }
    if (state === "fail") {
      return "error";
    }
    return "warning";
  }

  function taskLink(item: TaskDetailDependencyItemView): string {
    return getTaskDetailPath(projection.value.runId, item.taskId, "summary");
  }

  function sessionLink(sessionId?: string): string | undefined {
    return sessionId ? getSessionDetailPath(projection.value.runId, sessionId, "live") : undefined;
  }

  function boardLink(): string {
    return getRunTaskBoardPath(projection.value.runId);
  }

  function workspaceLink(): string {
    return getRunWorkspacePath(projection.value.runId);
  }

  return {
    riskLabel,
    statusLabel,
    validationLabel,
    detailTabs,
    projection,
    loading,
    error,
    loadProjection,
    overview,
    requirementGroups,
    summaryCards,
    activeSection,
    switchSection,
    visibleUpstream,
    hasMoreUpstream,
    loadMoreUpstream,
    visibleDownstream,
    hasMoreDownstream,
    loadMoreDownstream,
    visibleSessions,
    hasMoreSessions,
    loadMoreSessions,
    visibleArtifacts,
    hasMoreArtifacts,
    loadMoreArtifacts,
    primarySession,
    sessionSourceLabel,
    approvalStateLabel,
    sourceModeLabel,
    statusTagType,
    riskTagType,
    validationTagType,
    taskLink,
    sessionLink,
    boardLink,
    workspaceLink,
    artifactPreviewById,
    artifactPreviewErrorById,
    artifactPreviewLoadingId,
    isArtifactExpanded,
    toggleArtifactPreview,
  };
}
