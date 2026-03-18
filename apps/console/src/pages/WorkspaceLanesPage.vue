<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { getTaskBoardProjection } from "../api";
import { usePreferences } from "../composables/usePreferences";
import { useRunScopedResource } from "../composables/useRunScopedResource";
import {
  type TaskBoardDependencyEdge,
  createEmptyTaskBoardProjection,
  type TaskBoardDependencyState,
  type TaskBoardProjectionView,
  type TaskBoardRetrySourceMode,
  type TaskBoardSessionSourceMode,
  type TaskBoardTaskNode,
} from "../task-board-projection";
import { getTaskConsolePath } from "../workspace";

const route = useRoute();
const { isZh, riskLabel, statusLabel, t } = usePreferences();

function copy(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

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

async function loadProjection(showLoading = true): Promise<void> {
  await resource.load(showLoading);
}

async function handleResume(): Promise<void> {
  await resource.resumeScopedRun();
}

watch(
  () => route.fullPath,
  () => {
    void loadProjection();
  },
  { immediate: true },
);

const runId = computed(() => resolvedRunId.value ?? projection.value.runId);
const currentTaskId = computed(() => projection.value.currentTaskId);
const currentTask = computed(() =>
  currentTaskId.value
    ? projection.value.tasks.find((task) => task.taskId === currentTaskId.value)
    : undefined,
);
const taskColumns = computed(() => {
  const grouped = new Map<number, TaskBoardTaskNode[]>();

  for (const task of projection.value.tasks) {
    const bucket = grouped.get(task.depth) ?? [];
    bucket.push(task);
    grouped.set(task.depth, bucket);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([depth, tasks]) => ({
      depth,
      tasks,
    }));
});

function sessionTitle(task: TaskBoardTaskNode): string {
  if (!task.activeSession) {
    return copy("无活跃会话", "No active session");
  }

  return task.activeSession.sessionId
    ? copy(`会话 ${task.activeSession.sessionId}`, `Session ${task.activeSession.sessionId}`)
    : copy("状态回填会话", "Backfilled session");
}

function sessionRelation(task: TaskBoardTaskNode): string {
  if (!task.activeSession) {
    return copy(
      "当前任务没有活跃会话记录，仅展示任务状态与依赖关系。",
      "No active session record for this task; showing task status and dependencies only.",
    );
  }

  return copy(
    `当前任务由 ${task.activeSession.agentId} 负责，会话 ${task.activeSession.sessionId ?? "（状态回填）"}。`,
    `Task ${task.taskId} is currently owned by ${task.activeSession.agentId}, session ${task.activeSession.sessionId ?? "(backfilled)"}.`,
  );
}

function edgeStateLabel(state: TaskBoardDependencyState): string {
  switch (state) {
    case "satisfied":
      return copy("已满足", "Satisfied");
    case "active":
      return copy("上游执行中", "Upstream active");
    case "blocked":
      return copy("上游阻塞", "Upstream blocked");
    default:
      return copy("等待中", "Waiting");
  }
}

function sourceModeLabel(sourceMode: TaskBoardSessionSourceMode | TaskBoardRetrySourceMode): string {
  switch (sourceMode) {
    case "task_session":
      return copy("真实任务会话", "Task session (recorded)");
    case "task_record":
      return copy("任务记录", "Task record");
    case "task_status_backfill":
      return copy("状态回填", "Status backfill");
    default:
      return copy("事件回填", "Event backfill");
  }
}

function retrySummary(task: TaskBoardTaskNode): string {
  const attempts = task.retry.attempts ?? 0;
  const maxAttempts = task.retry.maxAttempts;

  if (task.retry.retryable) {
    return copy(
      `已尝试 ${attempts}/${maxAttempts} 次，可继续重试。`,
      `Attempts ${attempts}/${maxAttempts}; retry is available.`,
    );
  }

  if (task.retry.requeueRecommended) {
    return copy(
      `已尝试 ${attempts}/${maxAttempts} 次，建议重排队。`,
      `Attempts ${attempts}/${maxAttempts}; requeue is recommended.`,
    );
  }

  return copy(
    `已尝试 ${attempts}/${maxAttempts} 次。`,
    `Attempts ${attempts}/${maxAttempts}.`,
  );
}

function dependencySummary(edge: TaskBoardDependencyEdge): string {
  switch (edge.state) {
    case "satisfied":
      return copy(
        `${edge.fromTaskId} 已满足 ${edge.toTaskId} 的依赖。`,
        `${edge.fromTaskId} has satisfied the dependency for ${edge.toTaskId}.`,
      );
    case "active":
      return copy(
        `${edge.toTaskId} 正在等待 ${edge.fromTaskId} 完成当前执行。`,
        `${edge.toTaskId} is waiting for ${edge.fromTaskId} to finish.`,
      );
    case "blocked":
      return copy(
        `${edge.toTaskId} 受 ${edge.fromTaskId} 阻塞。`,
        `${edge.toTaskId} is blocked by ${edge.fromTaskId}.`,
      );
    default:
      return copy(
        `${edge.toTaskId} 仍依赖 ${edge.fromTaskId}。`,
        `${edge.toTaskId} still depends on ${edge.fromTaskId}.`,
      );
  }
}

function taskPath(taskId: string): string | undefined {
  return runId.value ? getTaskConsolePath(runId.value, taskId) : undefined;
}
</script>

<template>
  <section class="workspace-page-stack task-board-page">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ copy("执行车道", "Task Board") }}</p>
        <h1>{{ copy("任务 DAG 与会话绑定", "Task DAG and Session Bindings") }}</h1>
      </div>
      <p>
        {{
          copy(
            "该页面展示任务图中的节点状态、依赖关系、归属与会话关系。",
            "This page shows node status, dependencies, ownership, and session relationship.",
          )
        }}
      </p>
    </div>

    <section class="status-bar workspace-hero task-board-hero">
      <div class="task-board-hero__top">
        <div>
          <p class="section-eyebrow">{{ copy("任务图", "Task Graph") }}</p>
          <h1>{{ currentTask?.title ?? copy("当前运行任务看板", "Selected Run Task Board") }}</h1>
          <p class="workspace-hero__lead">
            {{
              currentTask
                ? copy(
                    `当前高亮任务：${currentTask.taskId}，图版本 ${projection.graphRevision}。`,
                    `Current highlighted task is ${currentTask.taskId}, graph revision ${projection.graphRevision}.`,
                  )
                : copy(
                    `运行 ${projection.runId || runId} 的任务看板，图版本 ${projection.graphRevision}。`,
                    `Task board for run ${projection.runId || runId}, graph revision ${projection.graphRevision}.`,
                  )
            }}
          </p>
        </div>

        <div class="workspace-hero__meta">
          <span class="flow-pill">{{ copy("运行", "Run") }} {{ projection.runId || runId }}</span>
          <span class="flow-pill">{{ copy("图版本", "Graph") }} {{ projection.graphRevision }}</span>
          <button class="ghost-button" type="button" :disabled="loading" @click="loadProjection(false)">
            {{ t("actions.refresh") }}
          </button>
          <button class="primary-button" type="button" :disabled="mutating || !runId" @click="handleResume">
            {{ mutating ? t("actions.resuming") : t("actions.resumeRun") }}
          </button>
        </div>
      </div>

      <div class="workspace-summary-grid task-board-summary-grid">
        <article class="summary-card">
          <span>{{ copy("任务总数", "Total tasks") }}</span>
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
          <span>{{ copy("失败任务", "Failed tasks") }}</span>
          <strong>{{ projection.summary.failedTaskCount }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ copy("依赖边数", "Dependency edges") }}</span>
          <strong>{{ projection.summary.dependencyEdgeCount }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ copy("已完成", "Completed") }}</span>
          <strong>{{ projection.summary.completedTaskCount }}</strong>
        </article>
      </div>
    </section>

    <div v-if="error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ error }}</p>
    </div>

    <div v-else-if="loading && projection.tasks.length === 0" class="panel-card__empty-state">
      <p class="panel-card__body">{{ copy("正在加载执行车道数据。", "Loading task board.") }}</p>
    </div>

    <div v-else-if="projection.tasks.length === 0" class="panel-card__empty-state">
      <p class="panel-card__body">{{ copy("当前运行暂无可展示的任务图。", "The selected run does not expose a task graph yet.") }}</p>
    </div>

    <template v-else>
      <section class="panel-card task-board-intro">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("节点视图", "Node View") }}</p>
            <h2>{{ copy("按 DAG 深度分列", "Columns by DAG Depth") }}</h2>
          </div>
          <span class="panel-chip">{{ taskColumns.length }}</span>
        </div>
        <p class="panel-card__body">
          {{
            copy(
              "每个节点显示任务状态、等待原因、负责人、最近活动、会话摘要与重试状态。",
              "Each node shows task state, waiting reason, owner, latest activity, session summary, and retry state.",
            )
          }}
        </p>
      </section>

      <section class="task-board-columns">
        <article v-for="column in taskColumns" :key="column.depth" class="panel-card task-board-column">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ copy("深度", "Depth") }}</p>
              <h2>{{ copy("深度", "Depth") }} {{ column.depth }}</h2>
            </div>
            <span class="panel-chip">{{ column.tasks.length }}</span>
          </div>

          <article
            v-for="task in column.tasks"
            :key="task.taskId"
            class="task-node-card"
            :data-current="task.taskId === currentTaskId"
            :data-status="task.status"
          >
            <div class="task-node-card__top">
              <div>
                <p class="lane-panel__eyebrow">{{ task.taskId }}</p>
                <h3>{{ task.title }}</h3>
              </div>
              <div class="lane-panel__badges">
                <span class="status-pill" :data-status="task.status">{{ statusLabel(task.status) }}</span>
                <span class="risk-pill" :data-risk="task.riskLevel">{{ riskLabel(task.riskLevel) }}</span>
              </div>
            </div>

            <div class="task-node-card__meta">
              <div class="summary-card">
                <span>{{ t("fields.owner") }}</span>
                <strong>{{ task.ownerLabel }}</strong>
              </div>
              <div class="summary-card">
                <span>{{ copy("任务类型", "Task kind") }}</span>
                <strong>{{ task.kind }}</strong>
              </div>
              <div class="summary-card">
                <span>{{ t("fields.lastActivity") }}</span>
                <strong>{{ task.latestActivityAt }}</strong>
              </div>
              <div class="summary-card">
                <span>{{ copy("下游任务", "Downstream tasks") }}</span>
                <strong>{{ task.downstreamTaskIds.length }}</strong>
              </div>
            </div>

            <section class="task-node-card__section">
              <strong>{{ task.statusReason }}</strong>
              <p class="panel-card__body">{{ task.latestActivitySummary }}</p>
              <p v-if="task.waitingReason" class="task-node-card__reason">{{ task.waitingReason }}</p>
            </section>

            <section class="task-node-card__section">
              <div class="task-node-card__section-header">
                <strong>{{ copy("依赖关系", "Dependencies") }}</strong>
                <span class="flow-pill">{{ copy("深度", "Depth") }} {{ task.depth }}</span>
              </div>
              <div class="task-node-card__list">
                <span v-if="task.dependsOn.length === 0" class="task-node-card__pill">
                  {{ copy("无上游依赖", "No upstream deps") }}
                </span>
                <span v-for="dependencyId in task.dependsOn" :key="dependencyId" class="task-node-card__pill">
                  {{ copy("依赖", "Depends on") }} {{ dependencyId }}
                </span>
              </div>
              <div class="task-node-card__list">
                <span v-if="task.downstreamTaskIds.length === 0" class="task-node-card__pill">
                  {{ copy("无下游任务", "No downstream tasks") }}
                </span>
                <span v-for="downstreamTaskId in task.downstreamTaskIds" :key="downstreamTaskId" class="task-node-card__pill">
                  {{ copy("下游", "Downstream") }} {{ downstreamTaskId }}
                </span>
              </div>
            </section>

            <section class="task-node-card__section">
              <div class="task-node-card__section-header">
                <strong>{{ copy("任务与会话", "Task and Session") }}</strong>
                <span class="flow-pill">{{ sessionTitle(task) }}</span>
              </div>
              <template v-if="task.activeSession">
                <div class="task-node-card__meta">
                  <div class="summary-card">
                    <span>{{ t("fields.agent") }}</span>
                    <strong>{{ task.activeSession.agentId }}</strong>
                  </div>
                  <div class="summary-card">
                    <span>{{ t("fields.approvals") }}</span>
                    <strong>{{ task.activeSession.pendingApprovalCount }}</strong>
                  </div>
                  <div class="summary-card">
                    <span>{{ t("fields.lastActivity") }}</span>
                    <strong>{{ task.activeSession.lastActivityAt }}</strong>
                  </div>
                  <div class="summary-card">
                    <span>{{ copy("会话来源", "Session source") }}</span>
                    <strong>{{ sourceModeLabel(task.activeSession.sourceMode) }}</strong>
                  </div>
                </div>
              </template>
              <p class="panel-card__body">{{ sessionRelation(task) }}</p>
            </section>

            <section class="task-node-card__section">
              <div class="task-node-card__section-header">
                <strong>{{ copy("重试与重排队", "Retry and Requeue") }}</strong>
                <span class="flow-pill">{{ sourceModeLabel(task.retry.sourceMode) }}</span>
              </div>
              <div class="task-node-card__meta">
                <div class="summary-card">
                  <span>{{ copy("已尝试次数", "Attempts") }}</span>
                  <strong>{{ task.retry.attempts ?? "-" }}</strong>
                </div>
                <div class="summary-card">
                  <span>{{ copy("最大尝试次数", "Max attempts") }}</span>
                  <strong>{{ task.retry.maxAttempts }}</strong>
                </div>
                <div class="summary-card">
                  <span>{{ copy("可重试", "Retryable") }}</span>
                  <strong>{{ task.retry.retryable ? copy("是", "Yes") : copy("否", "No") }}</strong>
                </div>
                <div class="summary-card">
                  <span>{{ copy("建议重排队", "Requeue") }}</span>
                  <strong>{{ task.retry.requeueRecommended ? copy("建议", "Recommended") : copy("否", "No") }}</strong>
                </div>
              </div>
              <p class="panel-card__body">{{ retrySummary(task) }}</p>
              <p v-if="task.retry.lastFailureAt" class="task-node-card__reason">
                {{ copy("最近失败时间", "Last failure") }}: {{ task.retry.lastFailureAt }}
              </p>
            </section>

            <div class="task-node-card__footer">
              <RouterLink v-if="taskPath(task.taskId)" class="ghost-link" :to="taskPath(task.taskId)!">
                {{ copy("打开任务/会话入口", "Open task / session entry") }}
              </RouterLink>
            </div>
          </article>
        </article>
      </section>

      <section class="panel-card task-board-edges">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("依赖边", "Dependency Edges") }}</p>
            <h2>{{ copy("显式依赖关系", "Explicit Edge Relationships") }}</h2>
          </div>
          <span class="panel-chip">{{ projection.edges.length }}</span>
        </div>

        <div class="task-board-edge-list">
          <article
            v-for="edge in projection.edges"
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
      </section>
    </template>
  </section>
</template>
