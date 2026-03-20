<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { getTaskDetailProjection } from "../api";
import { useArtifactPreview } from "../composables/useArtifactPreview";
import { useEntityProjection } from "../composables/useEntityProjection";
import { usePreferences } from "../composables/usePreferences";
import {
  createEmptyTaskDetailProjection,
  type TaskDetailDependencyItemView,
  type TaskDetailProjectionView,
  type TaskDetailSessionSourceMode,
} from "../detail-projection";
import {
  getRunTaskBoardPath,
  getRunWorkspacePath,
  getSessionDetailPath,
  getTaskDetailPath,
} from "../workspace";

const route = useRoute();
const { riskLabel, statusLabel, validationLabel, t } = usePreferences();

const runId = computed(() => (typeof route.params.runId === "string" ? route.params.runId : ""));
const taskId = computed(() => (typeof route.params.taskId === "string" ? route.params.taskId : ""));
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
  getMissingParamMessage: () =>
    "缺少 runId 或 taskId，无法打开任务详情。",
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
const dependencyColumns = computed(() => [
  {
    id: "upstream",
    title: "上游依赖",
    items: projection.value.upstream,
    empty: "这个任务没有上游依赖。",
  },
  {
    id: "downstream",
    title: "下游影响",
    items: projection.value.downstream,
    empty: "这个任务当前没有下游任务。",
  },
]);
const primarySession = computed(() =>
  projection.value.sessions.find(
    (session) => session.status === "running" || session.status === "awaiting_approval",
  ) ?? projection.value.sessions[0],
);
const summaryCards = computed(() => [
  {
    id: "owner",
    label: t("fields.owner"),
    value: overview.value.ownerLabel,
  },
  {
    id: "sessions",
    label: "会话数",
    value: String(overview.value.sessionCount),
  },
  {
    id: "active-sessions",
    label: t("fields.activeSessions"),
    value: String(overview.value.activeSessionCount),
  },
  {
    id: "approvals",
    label: t("fields.approvals"),
    value: String(overview.value.pendingApprovalCount),
  },
  {
    id: "artifacts",
    label: "产物数",
    value: String(overview.value.artifactCount),
  },
  {
    id: "activity",
    label: t("fields.lastActivity"),
    value: overview.value.latestActivityAt || "-",
  },
]);

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

function taskLink(item: TaskDetailDependencyItemView): string {
  return getTaskDetailPath(projection.value.runId, item.taskId);
}

function sessionLink(sessionId?: string): string | undefined {
  return sessionId ? getSessionDetailPath(projection.value.runId, sessionId) : undefined;
}

function boardLink(): string {
  return getRunTaskBoardPath(projection.value.runId);
}

function workspaceLink(): string {
  return getRunWorkspacePath(projection.value.runId);
}
</script>

<template>
  <section class="workspace-page-stack detail-page">
    <div class="workspace-page-header detail-page__header">
      <div>
        <p class="section-eyebrow">{{ "任务详情" }}</p>
        <h1>{{ overview.title }}</h1>
      </div>
      <p>
        {{
          "详情页基于任务图与运行事件聚合依赖、会话、审批、验证和产物，并持续刷新。"
        }}
      </p>
    </div>

    <div class="section-actions approvals-page__actions">
      <button class="ghost-button" type="button" :disabled="loading" @click="loadProjection(false)">
        {{ t("actions.refresh") }}
      </button>
      <RouterLink class="ghost-link" :to="boardLink()">{{ "返回任务板" }}</RouterLink>
      <RouterLink class="ghost-link" :to="workspaceLink()">{{ t("actions.backToWorkspace") }}</RouterLink>
      <RouterLink v-if="primarySession && sessionLink(primarySession.sessionId)" class="primary-link" :to="sessionLink(primarySession.sessionId)!">
        {{ "打开活动会话" }}
      </RouterLink>
    </div>

    <div v-if="error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ error }}</p>
    </div>

    <section class="status-bar workspace-hero detail-hero">
      <div class="detail-hero__top">
        <div>
          <p class="section-eyebrow">{{ overview.taskId }}</p>
          <h1>{{ overview.goal || overview.title }}</h1>
          <p class="workspace-hero__lead">{{ overview.statusReason }}</p>
        </div>
        <div class="lane-panel__badges">
          <span class="status-pill" :data-status="overview.status">{{ statusLabel(overview.status) }}</span>
          <span class="risk-pill" :data-risk="overview.riskLevel">{{ riskLabel(overview.riskLevel) }}</span>
        </div>
      </div>

      <div class="workspace-summary-grid detail-summary-grid">
        <article v-for="card in summaryCards" :key="card.id" class="summary-card">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </article>
      </div>
    </section>

    <div v-if="loading && !error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ "正在加载任务详情。" }}</p>
    </div>

    <div class="detail-grid detail-grid--primary">
      <section class="panel-card detail-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "任务概况" }}</p>
            <h2>{{ "任务目标与当前判断" }}</h2>
          </div>
          <span class="panel-chip">{{ overview.kind }}</span>
        </div>

        <div class="focus-panel__status-block">
          <strong class="focus-panel__status">{{ overview.latestActivitySummary }}</strong>
          <p class="panel-card__body">{{ overview.goal || "当前没有单独的任务 goal 文本。" }}</p>
        </div>
      </section>

      <section class="panel-card detail-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "需求边界" }}</p>
            <h2>{{ "输入、验收与预期产物" }}</h2>
          </div>
        </div>

        <div class="detail-stack">
          <article v-for="group in requirementGroups" :key="group.id" class="detail-subcard">
            <strong>{{ group.title }}</strong>
            <ul v-if="group.items.length > 0" class="health-list">
              <li v-for="item in group.items" :key="item">{{ item }}</li>
            </ul>
            <p v-else class="panel-card__body">{{ group.empty }}</p>
          </article>
        </div>
      </section>
    </div>

    <div class="detail-grid detail-grid--primary">
      <section class="panel-card detail-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "依赖关系" }}</p>
            <h2>{{ "上游与下游任务" }}</h2>
          </div>
        </div>

        <div class="detail-split">
          <article v-for="column in dependencyColumns" :key="column.id" class="detail-subcard">
            <strong>{{ column.title }}</strong>
            <div v-if="column.items.length > 0" class="detail-stack detail-stack--tight">
              <article v-for="item in column.items" :key="item.taskId" class="approval-card detail-item-card">
                <div class="detail-item-card__top">
                  <div>
                    <span class="approval-card__lane">{{ item.taskId }}</span>
                    <strong>{{ item.title }}</strong>
                  </div>
                  <span class="status-pill" :data-status="item.status">{{ statusLabel(item.status) }}</span>
                </div>
                <p>{{ item.statusReason }}</p>
                <p class="panel-card__body">{{ item.latestActivitySummary }}</p>
                <RouterLink class="ghost-link detail-item-card__link" :to="taskLink(item)">
                  {{ "打开任务详情" }}
                </RouterLink>
              </article>
            </div>
            <p v-else class="panel-card__body">{{ column.empty }}</p>
          </article>
        </div>
      </section>

      <section class="panel-card detail-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "执行会话" }}</p>
            <h2>{{ "任务绑定的会话视图" }}</h2>
          </div>
          <span class="panel-chip">{{ projection.sessions.length }}</span>
        </div>

        <div v-if="projection.sessions.length > 0" class="detail-stack">
          <article v-for="session in projection.sessions" :key="session.sessionId ?? session.label" class="approval-card detail-item-card">
            <div class="detail-item-card__top">
              <div>
                <span class="approval-card__lane">{{ session.label }}</span>
                <strong>{{ session.agentId }}</strong>
              </div>
              <span class="status-pill" :data-status="session.status">{{ statusLabel(session.status) }}</span>
            </div>
            <div class="detail-chip detail-chip--compact">
              <span>{{ "来源" }}</span>
              <strong>{{ sessionSourceLabel(session.sourceMode) }}</strong>
            </div>
            <div class="detail-chip detail-chip--compact">
              <span>{{ t("fields.lastActivity") }}</span>
              <strong>{{ session.lastActivityAt }}</strong>
            </div>
            <div class="detail-chip detail-chip--compact">
              <span>{{ t("fields.approvals") }}</span>
              <strong>{{ session.pendingApprovalCount }}</strong>
            </div>
            <p>{{ session.latestActivitySummary }}</p>
            <RouterLink v-if="sessionLink(session.sessionId)" class="ghost-link detail-item-card__link" :to="sessionLink(session.sessionId)!">
              {{ "打开会话详情" }}
            </RouterLink>
          </article>
        </div>
        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ "当前没有可回放的会话窗口。" }}</p>
        </div>
      </section>
    </div>

    <div class="detail-grid detail-grid--support">
      <section class="panel-card detail-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "验证摘要" }}</p>
            <h2>{{ "当前验证结论" }}</h2>
          </div>
          <span class="status-pill" :data-status="projection.validation.state === 'fail' ? 'failed' : projection.validation.state === 'pass' ? 'completed' : 'awaiting_approval'">
            {{ validationLabel(projection.validation.state) }}
          </span>
        </div>

        <div class="detail-stack">
          <div class="focus-panel__status-block">
            <strong class="focus-panel__status">{{ projection.validation.summary }}</strong>
            <p class="panel-card__body">{{ sourceModeLabel(projection.validation.sourceMode) }}</p>
          </div>
          <ul v-if="projection.validation.details.length > 0" class="health-list">
            <li v-for="detail in projection.validation.details" :key="detail">{{ detail }}</li>
          </ul>
          <p v-if="projection.validation.updatedAt" class="panel-card__body">
            {{ "更新时间" }}: {{ projection.validation.updatedAt }}
          </p>
        </div>
      </section>

      <section class="panel-card detail-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "最近审批" }}</p>
            <h2>{{ "最近一次审批快照" }}</h2>
          </div>
        </div>

        <template v-if="projection.latestApproval">
          <div class="detail-stack">
            <div class="detail-chip detail-chip--compact">
              <span>{{ "审批状态" }}</span>
              <strong>{{ approvalStateLabel(projection.latestApproval.state) }}</strong>
            </div>
            <div class="detail-chip detail-chip--compact">
              <span>{{ "来源" }}</span>
              <strong>{{ sourceModeLabel(projection.latestApproval.sourceMode) }}</strong>
            </div>
            <p>{{ projection.latestApproval.summary }}</p>
            <p class="panel-card__body" v-if="projection.latestApproval.requestedAt">
              {{ "请求时间" }}: {{ projection.latestApproval.requestedAt }}
            </p>
            <p class="panel-card__body" v-if="projection.latestApproval.decidedAt">
              {{ "决策时间" }}: {{ projection.latestApproval.decidedAt }}
            </p>
            <p class="panel-card__body" v-if="projection.latestApproval.actor">
              {{ "审批人" }}: {{ projection.latestApproval.actor }}
            </p>
          </div>
        </template>
        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ "当前没有审批快照。" }}</p>
        </div>
      </section>

      <section class="panel-card detail-card detail-card--wide">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "产物摘要" }}</p>
            <h2>{{ "最近产物与高亮" }}</h2>
          </div>
          <span class="panel-chip">{{ projection.artifacts.totalCount }}</span>
        </div>

        <div v-if="projection.artifacts.highlights.length > 0" class="detail-stack detail-stack--grid">
          <article v-for="artifact in projection.artifacts.highlights" :key="artifact.artifactId" class="approval-card detail-item-card">
            <div class="detail-item-card__top">
              <div>
                <span class="approval-card__lane">{{ artifact.kind }}</span>
                <strong>{{ artifact.summary }}</strong>
              </div>
              <span class="flow-pill">{{ artifact.createdAt }}</span>
            </div>
            <p class="panel-card__body">{{ artifact.uri }}</p>
            <button class="ghost-button detail-item-card__link" type="button" @click="toggleArtifactPreview(artifact.artifactId)">
              {{ isArtifactExpanded(artifact.artifactId) ? "收起内容" : "查看内容" }}
            </button>
            <p v-if="isArtifactExpanded(artifact.artifactId) && artifactPreviewLoadingId === artifact.artifactId" class="panel-card__body">
              {{ "正在加载产物内容..." }}
            </p>
            <p v-if="isArtifactExpanded(artifact.artifactId) && artifactPreviewErrorById[artifact.artifactId]" class="form-error">
              {{ artifactPreviewErrorById[artifact.artifactId] }}
            </p>
            <template v-if="isArtifactExpanded(artifact.artifactId) && artifactPreviewById[artifact.artifactId]">
              <p class="panel-card__body">
                {{ artifactPreviewById[artifact.artifactId]!.source }} · {{ artifactPreviewById[artifact.artifactId]!.contentType }}
                <span v-if="artifactPreviewById[artifact.artifactId]!.filePath"> · {{ artifactPreviewById[artifact.artifactId]!.filePath }}</span>
              </p>
              <pre class="detail-pre">{{ artifactPreviewById[artifact.artifactId]!.body }}</pre>
            </template>
          </article>
        </div>
        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ "当前没有可展示的 task 产物。" }}</p>
        </div>
      </section>
    </div>
  </section>
</template>
