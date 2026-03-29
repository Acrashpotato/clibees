<script setup lang="ts">
import { computed, watch } from "vue";
import { NAlert, NButton, NCard, NCollapse, NCollapseItem, NEmpty, NTabPane, NTabs } from "naive-ui";
import { useRoute, useRouter } from "vue-router";

import WorkspaceLanesEdgesPanel from "./workspace-lanes/WorkspaceLanesEdgesPanel.vue";
import WorkspaceLanesSelectedTaskPanel from "./workspace-lanes/WorkspaceLanesSelectedTaskPanel.vue";
import { useWorkspaceLanesPage } from "./workspace-lanes/useWorkspaceLanesPage";

type TaskBoardPanel = "graph" | "selected-task" | "edges";

const route = useRoute();
const router = useRouter();

const {
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
} = useWorkspaceLanesPage();

const boardPanels = [
  { id: "graph" as const, label: "图谱" },
  { id: "selected-task" as const, label: "当前任务" },
  { id: "edges" as const, label: "依赖边" },
] satisfies ReadonlyArray<{ id: TaskBoardPanel; label: string }>;

const panelFromQuery = computed<TaskBoardPanel | undefined>(() => {
  const panel = route.query.panel;
  if (panel === "graph" || panel === "selected-task" || panel === "edges") {
    return panel;
  }
  return undefined;
});

const activePanel = computed<TaskBoardPanel>(() => panelFromQuery.value ?? "graph");

watch(
  () => route.query.panel,
  (panel) => {
    if (panel === undefined || panelFromQuery.value) {
      return;
    }
    void router.replace({
      query: {
        ...route.query,
        panel: "graph",
      },
    });
  },
  { immediate: true },
);

function switchPanel(nextPanel: string): void {
  if (nextPanel !== "graph" && nextPanel !== "selected-task" && nextPanel !== "edges") {
    return;
  }
  if (nextPanel === activePanel.value) {
    return;
  }
  void router.replace({
    query: {
      ...route.query,
      panel: nextPanel,
    },
  });
}

</script>

<template>
  <section class="workspace-page-stack task-board-page">
    <div class="task-board-toolbar">
      <n-button quaternary size="small" :disabled="loading" @click="loadProjection(false)">
        {{ t("actions.refresh") }}
      </n-button>
      <n-button type="primary" size="small" :disabled="mutating || !runId" @click="handleResume">
        {{ mutating ? t("actions.resuming") : t("actions.resumeRun") }}
      </n-button>
    </div>

    <div class="task-board-page__body">
      <n-collapse class="task-board-summary">
        <n-collapse-item title="任务图摘要" name="task-board-summary">
          <n-card class="status-bar workspace-hero task-board-hero" size="small">
            <div class="task-board-hero__top">
              <div>
                <p class="section-eyebrow">{{ "任务图" }}</p>
                <h1>{{ selectedTask?.title ?? currentTask?.title ?? "当前运行任务看板" }}</h1>
              </div>

              <div class="workspace-hero__meta">
                <span class="flow-pill">{{ "运行" }} {{ projection.runId || runId }}</span>
                <span class="flow-pill">{{ "图版本" }} {{ projection.graphRevision }}</span>
              </div>
            </div>

            <div class="workspace-summary-grid task-board-summary-grid">
              <article class="summary-card">
                <span>{{ "任务总数" }}</span>
                <strong>{{ projection.summary.totalTaskCount }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ t("fields.activeTasks") }}</span>
                <strong>{{ projection.summary.activeTaskCount }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ t("fields.activeSessions") }}</span>
                <strong>{{ projection.summary.activeSessionCount }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ t("fields.approvals") }}</span>
                <strong>{{ projection.summary.pendingApprovalCount }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ t("fields.blocked") }}</span>
                <strong>{{ projection.summary.blockedTaskCount }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ "失败任务" }}</span>
                <strong>{{ projection.summary.failedTaskCount }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ "依赖边数" }}</span>
                <strong>{{ projection.summary.dependencyEdgeCount }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ "已完成" }}</span>
                <strong>{{ projection.summary.completedTaskCount }}</strong>
              </article>
            </div>
          </n-card>
        </n-collapse-item>
      </n-collapse>

    <n-alert v-if="error" type="error" :show-icon="false">{{ error }}</n-alert>

    <n-empty
      v-else-if="loading && projection.tasks.length === 0"
      class="panel-card__empty-state"
      :description="'正在加载执行车道数据。'"
      size="small"
    />

    <n-empty
      v-else-if="projection.tasks.length === 0"
      class="panel-card__empty-state"
      :description="'当前运行暂无可展示的任务图。'"
      size="small"
    />

      <template v-else>
        <n-tabs
          type="segment"
          :value="activePanel"
          :default-value="'graph'"
          display-directive="if"
          @update:value="switchPanel"
        >
          <n-tab-pane v-for="panel in boardPanels" :key="panel.id" :name="panel.id" :tab="panel.label" />
        </n-tabs>

        <n-card v-if="activePanel === 'graph'" class="panel-card task-board-node-rail" size="small">
          <div class="task-board-node-rail__toolbar">
            <div>
              <p class="section-eyebrow">{{ "图谱视图" }}</p>
              <h2>{{ "横向节点卡片" }}</h2>
            </div>
            <div class="task-board-node-rail__controls">
              <n-button quaternary size="small" :disabled="!hasPreviousTask" @click="showPreviousTask">
                {{ "上一个" }}
              </n-button>
              <span class="flow-pill">{{ selectedTaskOrdinal }} / {{ orderedTasks.length }}</span>
              <n-button quaternary size="small" :disabled="!hasNextTask" @click="showNextTask">
                {{ "下一个" }}
              </n-button>
              <n-button quaternary size="small" @click="toggleGraphFullscreen">
                {{ graphFullscreen ? "退出全屏" : "全屏展开" }}
              </n-button>
            </div>
          </div>
          <div class="task-board-link-legend">
            <span class="task-board-link-legend__item" data-link="explicit">
              <span class="task-board-link-legend__line"></span>
              <span>{{ "Solid = dependency flow (A -> B)" }}</span>
            </span>
            <span class="task-board-link-legend__item" data-link="sequence">
              <span class="task-board-link-legend__line"></span>
              <span>{{ "Dashed = browse order flow" }}</span>
            </span>
          </div>
          <div ref="graphViewportRef" class="task-board-node-rail__viewport">
            <div class="task-board-node-rail__canvas" :style="taskGraphCanvasStyle">
              <svg class="task-board-flow-map" :viewBox="taskGraphViewBox" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <marker
                    id="task-flow-arrow-explicit"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="8"
                    markerHeight="8"
                    markerUnits="strokeWidth"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" class="task-board-flow-arrow"></path>
                  </marker>
                  <marker
                    id="task-flow-arrow-sequence"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    markerUnits="strokeWidth"
                    orient="auto"
                  >
                    <path d="M 1 1 L 9 5 L 1 9" class="task-board-flow-arrow task-board-flow-arrow--sequence"></path>
                  </marker>
                </defs>
                <path
                  v-for="link in taskGraphLinks"
                  :key="link.key"
                  :id="link.pathId"
                  class="task-board-flow-link"
                  :data-link="link.linkType"
                  :data-state="link.state"
                  :data-related="isLinkRelated(link, selectedTask?.taskId)"
                  :data-direction="linkDirection(link, selectedTask?.taskId)"
                  :d="link.path"
                />
                <template v-for="link in taskGraphLinks" :key="`label:${link.key}`">
                  <text
                    v-if="showLinkLabel(link)"
                    class="task-board-flow-label"
                    :data-related="isLinkRelated(link, selectedTask?.taskId)"
                  >
                    <textPath :href="`#${link.pathId}`" startOffset="50%">
                      {{ link.fromTaskId }} → {{ link.toTaskId }}
                    </textPath>
                  </text>
                </template>
              </svg>

              <button
                v-for="node in taskGraphNodes"
                :key="node.taskId"
                type="button"
                class="task-board-node-toggle task-board-node-toggle--graph"
                :style="node.style"
                :data-active="node.task.taskId === selectedTask?.taskId"
                :data-current="node.task.taskId === currentTaskId"
                :data-status="node.task.status"
                @click="selectTask(node.task.taskId)"
              >
                <span class="task-board-node-port task-board-node-port--left" aria-hidden="true"></span>
                <span class="task-board-node-port task-board-node-port--right" aria-hidden="true"></span>
                <span class="task-board-node-port task-board-node-port--bottom" aria-hidden="true"></span>
                <div class="task-board-node-toggle__top">
                  <span class="lane-panel__eyebrow">{{ orderedTaskPosition(node.task.taskId) }} - {{ node.task.taskId }}</span>
                  <span class="status-pill" :data-status="node.task.status">{{ statusLabel(node.task.status) }}</span>
                </div>
                <strong>{{ node.task.title }}</strong>
                <div class="task-board-node-toggle__meta">
                  <span class="risk-pill" :data-risk="node.task.riskLevel">{{ riskLabel(node.task.riskLevel) }}</span>
                  <span class="task-board-node-toggle__deps">{{ t("fields.upstreamDeps") }} {{ node.task.dependsOn.length }}</span>
                </div>
                <span class="task-board-node-toggle__depth">Depth {{ node.depth }}</span>
              </button>
            </div>
          </div>
        </n-card>

        <WorkspaceLanesSelectedTaskPanel
          v-else-if="activePanel === 'selected-task'"
          :current-task-id="currentTaskId"
          :selected-task="selectedTask"
          :selected-task-ordinal="selectedTaskOrdinal"
          :ordered-task-count="orderedTasks.length"
          :has-previous-task="hasPreviousTask"
          :has-next-task="hasNextTask"
          :status-label="statusLabel"
          :risk-label="riskLabel"
          :task-path="taskPath"
          :session-title="sessionTitle"
          :session-relation="sessionRelation"
          :source-mode-label="sourceModeLabel"
          :retry-summary="retrySummary"
          :show-previous-task="showPreviousTask"
          :show-next-task="showNextTask"
        />

        <WorkspaceLanesEdgesPanel
          v-else
          :edge-count="projection.edges.length"
          :ordered-edges="orderedEdges"
          :edge-state-label="edgeStateLabel"
          :dependency-summary="dependencySummary"
        />
      </template>
    </div>
  </section>
</template>
