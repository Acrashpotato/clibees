import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { getTaskBoardProjection } from "../../api";
import { usePreferences } from "../../composables/usePreferences";
import { useRunScopedResource } from "../../composables/useRunScopedResource";
import {
  createEmptyTaskBoardProjection,
  type TaskBoardDependencyEdge,
  type TaskBoardDependencyState,
  type TaskBoardProjectionView,
  type TaskBoardRetrySourceMode,
  type TaskBoardSessionSourceMode,
  type TaskBoardTaskNode,
} from "../../task-board-projection";
import { getTaskConsolePath } from "../../workspace";
import {
  isLinkRelated as isGraphLinkRelated,
  linkDirection as resolveGraphLinkDirection,
  showLinkLabel as shouldShowGraphLinkLabel,
  useTaskGraph,
} from "./useTaskGraph";

export function useWorkspaceLanesPage() {
  const route = useRoute();
  const { riskLabel, statusLabel, t } = usePreferences();

  const runScopeId = computed(() => (typeof route.params.runId === "string" ? route.params.runId : undefined));
  const resource = useRunScopedResource<TaskBoardProjectionView, boolean>({
    getRunScopeId: () => runScopeId.value,
    createEmpty: (runId) => createEmptyTaskBoardProjection(runId),
    fetchData: (runId) => getTaskBoardProjection(runId),
    getStatus: () => false,
    isTerminalStatus: (status) => status,
    getPollIntervalMs: () => 2000,
  });
  const projection = resource.data;
  const resolvedRunId = resource.resolvedRunId;
  const loading = resource.loading;
  const error = resource.error;
  const mutating = resource.mutating;
  const graphViewportRef = ref<HTMLElement | null>(null);
  const graphFullscreen = ref(false);

  async function loadProjection(showLoading = true): Promise<void> {
    await resource.load(showLoading);
  }

  async function handleResume(): Promise<void> {
    await resource.resumeScopedRun();
  }

  function handleFullscreenChange(): void {
    graphFullscreen.value = document.fullscreenElement === graphViewportRef.value;
  }

  async function toggleGraphFullscreen(): Promise<void> {
    const viewport = graphViewportRef.value;
    if (!viewport || !viewport.requestFullscreen) {
      return;
    }

    try {
      if (document.fullscreenElement === viewport) {
        await document.exitFullscreen();
        return;
      }

      await viewport.requestFullscreen();
    } catch {
      graphFullscreen.value = false;
    }
  }

  watch(
    () => route.fullPath,
    () => {
      void loadProjection();
    },
    { immediate: true },
  );

  onMounted(() => {
    document.addEventListener("fullscreenchange", handleFullscreenChange);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
  });

  const runId = computed(() => resolvedRunId.value ?? projection.value.runId);
  const currentTaskId = computed(() => projection.value.currentTaskId);
  const currentTask = computed(() =>
    currentTaskId.value
      ? projection.value.tasks.find((task) => task.taskId === currentTaskId.value)
      : undefined,
  );

  const {
    orderedTasks,
    orderedEdges,
    taskGraphNodes,
    taskGraphLinks,
    taskGraphCanvasStyle,
    taskGraphViewBox,
    orderedTaskPosition,
  } = useTaskGraph(projection);

  const selectedTaskId = ref<string | undefined>(undefined);
  const selectedTask = computed(() =>
    orderedTasks.value.find((task) => task.taskId === selectedTaskId.value),
  );
  const selectedTaskIndex = computed(() => {
    if (!selectedTask.value) {
      return -1;
    }

    return orderedTasks.value.findIndex((task) => task.taskId === selectedTask.value?.taskId);
  });
  const selectedTaskOrdinal = computed(() => (selectedTaskIndex.value >= 0 ? selectedTaskIndex.value + 1 : 0));
  const hasPreviousTask = computed(() => selectedTaskIndex.value > 0);
  const hasNextTask = computed(
    () => selectedTaskIndex.value >= 0 && selectedTaskIndex.value < orderedTasks.value.length - 1,
  );

  function linkDirection(link: (typeof taskGraphLinks.value)[number], taskId: string | undefined) {
    return resolveGraphLinkDirection(link, taskId);
  }

  function isLinkRelated(link: (typeof taskGraphLinks.value)[number], taskId: string | undefined): boolean {
    return isGraphLinkRelated(link, taskId);
  }

  function showLinkLabel(link: (typeof taskGraphLinks.value)[number]): boolean {
    return shouldShowGraphLinkLabel(link, selectedTask.value?.taskId);
  }

  watch(
    [orderedTasks, currentTaskId],
    ([tasks, highlightedTaskId]) => {
      const highlightedSelection =
        highlightedTaskId && tasks.some((task) => task.taskId === highlightedTaskId)
          ? highlightedTaskId
          : undefined;
      const preservedSelection =
        selectedTaskId.value && tasks.some((task) => task.taskId === selectedTaskId.value)
          ? selectedTaskId.value
          : undefined;

      selectedTaskId.value = highlightedSelection ?? preservedSelection ?? tasks[0]?.taskId;
    },
    { immediate: true },
  );

  function selectTask(taskId: string): void {
    selectedTaskId.value = taskId;
  }

  function showPreviousTask(): void {
    if (!hasPreviousTask.value) {
      return;
    }

    const previousTask = orderedTasks.value[selectedTaskIndex.value - 1];
    if (previousTask) {
      selectedTaskId.value = previousTask.taskId;
    }
  }

  function showNextTask(): void {
    if (!hasNextTask.value) {
      return;
    }

    const nextTask = orderedTasks.value[selectedTaskIndex.value + 1];
    if (nextTask) {
      selectedTaskId.value = nextTask.taskId;
    }
  }

  function sessionTitle(task: TaskBoardTaskNode): string {
    if (!task.activeSession) {
      return "无活跃会话";
    }

    return task.activeSession.sessionId
      ? `会话 ${task.activeSession.sessionId}`
      : "状态回填会话";
  }

  function sessionRelation(task: TaskBoardTaskNode): string {
    if (!task.activeSession) {
      return "当前任务没有活跃会话记录，仅展示任务状态与依赖关系。";
    }

    return `当前任务由 ${task.activeSession.agentId} 负责，会话 ${task.activeSession.sessionId ?? "（状态回填）"}。`;
  }

  function edgeStateLabel(state: TaskBoardDependencyState): string {
    switch (state) {
      case "satisfied":
        return "已满足";
      case "active":
        return "上游执行中";
      case "blocked":
        return "上游阻塞";
      default:
        return "等待中";
    }
  }

  function sourceModeLabel(sourceMode: TaskBoardSessionSourceMode | TaskBoardRetrySourceMode): string {
    switch (sourceMode) {
      case "task_session":
        return "真实任务会话";
      case "task_record":
        return "任务记录";
      case "task_status_backfill":
        return "状态回填";
      default:
        return "事件回填";
    }
  }

  function retrySummary(task: TaskBoardTaskNode): string {
    const attempts = task.retry.attempts ?? 0;
    const maxAttempts = task.retry.maxAttempts;

    if (task.retry.retryable) {
      return `已尝试 ${attempts}/${maxAttempts} 次，可继续重试。`;
    }

    if (task.retry.requeueRecommended) {
      return `已尝试 ${attempts}/${maxAttempts} 次，建议重排队。`;
    }

    return `已尝试 ${attempts}/${maxAttempts} 次。`;
  }

  function dependencySummary(edge: TaskBoardDependencyEdge): string {
    switch (edge.state) {
      case "satisfied":
        return `${edge.fromTaskId} 已满足 ${edge.toTaskId} 的依赖。`;
      case "active":
        return `${edge.toTaskId} 正在等待 ${edge.fromTaskId} 完成。`;
      case "blocked":
        return `${edge.toTaskId} 被 ${edge.fromTaskId} 阻塞。`;
      default:
        return `${edge.toTaskId} 仍依赖 ${edge.fromTaskId}。`;
    }
  }

  function taskPath(taskId: string): string | undefined {
    return runId.value ? getTaskConsolePath(runId.value, taskId) : undefined;
  }

  return {
    riskLabel,
    statusLabel,
    t,
    projection,
    runId,
    currentTaskId,
    currentTask,
    loading,
    error,
    mutating,
    graphViewportRef,
    graphFullscreen,
    orderedTasks,
    orderedEdges,
    taskGraphNodes,
    taskGraphLinks,
    taskGraphCanvasStyle,
    taskGraphViewBox,
    selectedTask,
    selectedTaskOrdinal,
    hasPreviousTask,
    hasNextTask,
    loadProjection,
    handleResume,
    toggleGraphFullscreen,
    linkDirection,
    isLinkRelated,
    showLinkLabel,
    orderedTaskPosition,
    selectTask,
    showPreviousTask,
    showNextTask,
    sessionTitle,
    sessionRelation,
    edgeStateLabel,
    sourceModeLabel,
    retrySummary,
    dependencySummary,
    taskPath,
  };
}
