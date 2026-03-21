<script setup lang="ts">
import { NAlert, NButton, NCard, NEmpty, NTag } from "naive-ui";
import { RouterLink } from "vue-router";

import { useWorkspaceLanesPage } from "./workspace-lanes/useWorkspaceLanesPage";

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

function riskTagType(riskLevel: string): "default" | "warning" | "error" {
  switch (riskLevel) {
    case "high":
      return "error";
    case "medium":
      return "warning";
    default:
      return "default";
  }
}
</script>

<template>
  <section class="workspace-page-stack task-board-page">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ "执行车道" }}</p>
        <h1>{{ "任务 DAG 与会话绑定" }}</h1>
      </div>
      <p>
        {{
          "该页面展示任务图中的节点状态、依赖关系、归属与会话关系。"
        }}
      </p>
    </div>

    <n-card class="status-bar workspace-hero task-board-hero" size="small">
      <div class="task-board-hero__top">
        <div>
          <p class="section-eyebrow">{{ "任务图" }}</p>
          <h1>{{ selectedTask?.title ?? currentTask?.title ?? "当前运行任务看板" }}</h1>
          <p class="workspace-hero__lead">
            {{
              selectedTask
                ? `当前查看任务 ${selectedTask.taskId}，图版本 ${projection.graphRevision}。`
                : `运行 ${projection.runId || runId} 的任务看板，图版本 ${projection.graphRevision}。`
            }}
          </p>
        </div>

        <div class="workspace-hero__meta">
          <span class="flow-pill">{{ "运行" }} {{ projection.runId || runId }}</span>
          <span class="flow-pill">{{ "图版本" }} {{ projection.graphRevision }}</span>
          <n-button quaternary size="small" :disabled="loading" @click="loadProjection(false)">
            {{ t("actions.refresh") }}
          </n-button>
          <n-button type="primary" size="small" :disabled="mutating || !runId" @click="handleResume">
            {{ mutating ? t("actions.resuming") : t("actions.resumeRun") }}
          </n-button>
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
      <n-card class="panel-card task-board-node-rail" size="small">
        <div class="task-board-node-rail__toolbar">
          <div>
            <p class="section-eyebrow">{{ "切换集合" }}</p>
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

        <article
          v-if="selectedTask"
          class="task-node-card task-board-node-detail"
          :data-current="selectedTask.taskId === currentTaskId"
          :data-status="selectedTask.status"
        >
          <div class="task-node-card__top">
            <div>
              <p class="lane-panel__eyebrow">{{ selectedTask.taskId }}</p>
              <h3>{{ selectedTask.title }}</h3>
            </div>
            <div class="lane-panel__badges">
              <n-tag :type="statusTagType(selectedTask.status)" size="small">
                {{ statusLabel(selectedTask.status) }}
              </n-tag>
              <n-tag :type="riskTagType(selectedTask.riskLevel)" size="small">
                {{ riskLabel(selectedTask.riskLevel) }}
              </n-tag>
            </div>
          </div>

          <div class="task-node-card__meta">
            <div class="summary-card">
              <span>{{ t("fields.owner") }}</span>
              <strong>{{ selectedTask.ownerLabel }}</strong>
            </div>
            <div class="summary-card">
              <span>{{ "任务类型" }}</span>
              <strong>{{ selectedTask.kind }}</strong>
            </div>
            <div class="summary-card">
              <span>{{ t("fields.lastActivity") }}</span>
              <strong>{{ selectedTask.latestActivityAt }}</strong>
            </div>
            <div class="summary-card">
              <span>{{ "下游任务" }}</span>
              <strong>{{ selectedTask.downstreamTaskIds.length }}</strong>
            </div>
          </div>

          <section class="task-node-card__section">
            <strong>{{ selectedTask.statusReason }}</strong>
            <p class="panel-card__body">{{ selectedTask.latestActivitySummary }}</p>
            <p v-if="selectedTask.waitingReason" class="task-node-card__reason">{{ selectedTask.waitingReason }}</p>
          </section>

          <section class="task-node-card__section">
            <div class="task-node-card__section-header">
              <strong>{{ "依赖关系" }}</strong>
              <span class="flow-pill">{{ "深度" }} {{ selectedTask.depth }}</span>
            </div>
            <div class="task-node-card__list">
              <span v-if="selectedTask.dependsOn.length === 0" class="task-node-card__pill">
                {{ "无上游依赖" }}
              </span>
              <span
                v-for="dependencyId in selectedTask.dependsOn"
                :key="dependencyId"
                class="task-node-card__pill"
              >
                {{ "依赖" }} {{ dependencyId }}
              </span>
            </div>
            <div class="task-node-card__list">
              <span v-if="selectedTask.downstreamTaskIds.length === 0" class="task-node-card__pill">
                {{ "无下游任务" }}
              </span>
              <span
                v-for="downstreamTaskId in selectedTask.downstreamTaskIds"
                :key="downstreamTaskId"
                class="task-node-card__pill"
              >
                {{ "下游" }} {{ downstreamTaskId }}
              </span>
            </div>
          </section>

          <section class="task-node-card__section">
            <div class="task-node-card__section-header">
              <strong>{{ "任务与会话" }}</strong>
              <span class="flow-pill">{{ sessionTitle(selectedTask) }}</span>
            </div>
            <template v-if="selectedTask.activeSession">
              <div class="task-node-card__meta">
                <div class="summary-card">
                  <span>{{ t("fields.agent") }}</span>
                  <strong>{{ selectedTask.activeSession.agentId }}</strong>
                </div>
                <div class="summary-card">
                  <span>{{ t("fields.approvals") }}</span>
                  <strong>{{ selectedTask.activeSession.pendingApprovalCount }}</strong>
                </div>
                <div class="summary-card">
                  <span>{{ t("fields.lastActivity") }}</span>
                  <strong>{{ selectedTask.activeSession.lastActivityAt }}</strong>
                </div>
                <div class="summary-card">
                  <span>{{ "会话来源" }}</span>
                  <strong>{{ sourceModeLabel(selectedTask.activeSession.sourceMode) }}</strong>
                </div>
              </div>
            </template>
            <p class="panel-card__body">{{ sessionRelation(selectedTask) }}</p>
          </section>

          <section class="task-node-card__section">
            <div class="task-node-card__section-header">
              <strong>{{ "重试与重排队" }}</strong>
              <span class="flow-pill">{{ sourceModeLabel(selectedTask.retry.sourceMode) }}</span>
            </div>
            <div class="task-node-card__meta">
              <div class="summary-card">
                <span>{{ "已尝试次数" }}</span>
                <strong>{{ selectedTask.retry.attempts ?? "-" }}</strong>
              </div>
              <div class="summary-card">
                <span>{{ "最大尝试次数" }}</span>
                <strong>{{ selectedTask.retry.maxAttempts }}</strong>
              </div>
              <div class="summary-card">
                <span>{{ "可重试" }}</span>
                <strong>{{ selectedTask.retry.retryable ? "是" : "否" }}</strong>
              </div>
              <div class="summary-card">
                <span>{{ "建议重排队" }}</span>
                <strong>{{ selectedTask.retry.requeueRecommended ? "建议" : "否" }}</strong>
              </div>
            </div>
            <p class="panel-card__body">{{ retrySummary(selectedTask) }}</p>
            <p v-if="selectedTask.retry.lastFailureAt" class="task-node-card__reason">
              {{ "最近失败时间" }}: {{ selectedTask.retry.lastFailureAt }}
            </p>
          </section>

          <div class="task-node-card__footer">
            <RouterLink v-if="taskPath(selectedTask.taskId)" class="ghost-link" :to="taskPath(selectedTask.taskId)!">
              {{ "打开任务/会话入口" }}
            </RouterLink>
          </div>
        </article>
      </n-card>

      <n-card class="panel-card task-board-edges" size="small">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "依赖边" }}</p>
            <h2>{{ "显式依赖关系" }}</h2>
          </div>
          <n-tag size="small" round>{{ projection.edges.length }}</n-tag>
        </div>

        <div class="task-board-edge-list">
          <article
            v-for="edge in orderedEdges"
            :key="edge.edgeId"
            class="summary-card task-board-edge"
            :data-state="edge.state"
          >
            <div class="task-node-card__section-header">
              <strong>{{ edge.fromTaskId }} -> {{ edge.toTaskId }}</strong>
              <span class="flow-pill">{{ edgeStateLabel(edge.state) }}</span>
            </div>
            <p class="panel-card__body">{{ dependencySummary(edge) }}</p>
          </article>
        </div>
      </n-card>
    </template>
  </section>
</template>
