<script setup lang="ts">
import { computed, watch } from "vue";
import { NAlert, NButton, NCard, NEmpty, NTabPane, NTabs, NTag } from "naive-ui";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { getTaskDetailProjection } from "../api";
import { useArtifactPreview } from "../composables/useArtifactPreview";
import { useChunkedRender } from "../composables/useChunkedRender";
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
  type TaskDetailSection,
} from "../workspace";

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

    <div class="detail-page__body">
      <div class="section-actions approvals-page__actions">
        <n-button quaternary size="small" :disabled="loading" @click="loadProjection(false)">
          {{ t("actions.refresh") }}
        </n-button>
        <RouterLink class="ghost-link" :to="boardLink()">{{ "返回任务板" }}</RouterLink>
        <RouterLink class="ghost-link" :to="workspaceLink()">{{ t("actions.backToWorkspace") }}</RouterLink>
        <RouterLink
          v-if="primarySession && sessionLink(primarySession.sessionId)"
          class="primary-link"
          :to="sessionLink(primarySession.sessionId)!"
        >
          {{ "打开活动会话" }}
        </RouterLink>
      </div>

      <n-alert v-if="error" type="error" :show-icon="false">
        {{ error }}
      </n-alert>

      <n-card class="status-bar workspace-hero detail-hero" size="small">
        <div class="detail-hero__top">
          <div>
            <p class="section-eyebrow">{{ overview.taskId }}</p>
            <h1>{{ overview.goal || overview.title }}</h1>
            <p class="workspace-hero__lead">{{ overview.statusReason }}</p>
          </div>
          <div class="lane-panel__badges">
            <n-tag :type="statusTagType(overview.status)" size="small">{{ statusLabel(overview.status) }}</n-tag>
            <n-tag :type="riskTagType(overview.riskLevel)" size="small">{{ riskLabel(overview.riskLevel) }}</n-tag>
          </div>
        </div>

        <div class="workspace-summary-grid detail-summary-grid">
          <article v-for="card in summaryCards" :key="card.id" class="summary-card">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
          </article>
        </div>
      </n-card>

      <n-tabs type="segment" :value="activeSection" :default-value="'summary'" @update:value="switchSection">
        <n-tab-pane v-for="tab in detailTabs" :key="tab.name" :name="tab.name" :tab="tab.label" />
      </n-tabs>

      <n-empty
        v-if="loading && !error"
        class="panel-card__empty-state"
        :description="'正在加载任务详情。'"
        size="small"
      />

      <template v-else>
        <div v-if="activeSection === 'summary'" class="detail-grid detail-grid--support">
          <n-card class="panel-card detail-card" size="small">
            <div class="panel-card__header">
              <div>
                <p class="section-eyebrow">{{ "任务概况" }}</p>
                <h2>{{ "任务目标与当前判断" }}</h2>
              </div>
              <n-tag size="small">{{ overview.kind }}</n-tag>
            </div>

            <div class="focus-panel__status-block">
              <strong class="focus-panel__status">{{ overview.latestActivitySummary }}</strong>
              <p class="panel-card__body">{{ overview.goal || "当前没有单独的任务 goal 文本。" }}</p>
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
          </n-card>

          <n-card class="panel-card detail-card" size="small">
            <div class="panel-card__header">
              <div>
                <p class="section-eyebrow">{{ "验证摘要" }}</p>
                <h2>{{ "当前验证结论" }}</h2>
              </div>
              <n-tag :type="validationTagType(projection.validation.state)" size="small">
                {{ validationLabel(projection.validation.state) }}
              </n-tag>
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

            <div class="detail-stack" v-if="projection.latestApproval">
              <div class="detail-chip detail-chip--compact">
                <span>{{ "最近审批" }}</span>
                <strong>{{ approvalStateLabel(projection.latestApproval.state) }}</strong>
              </div>
              <p>{{ projection.latestApproval.summary }}</p>
            </div>
          </n-card>
        </div>

        <n-card v-else-if="activeSection === 'dependencies'" class="panel-card detail-card" size="small">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ "依赖关系" }}</p>
              <h2>{{ "上游与下游任务" }}</h2>
            </div>
          </div>

          <div class="detail-split">
            <article class="detail-subcard">
              <strong>{{ "上游依赖" }}</strong>
              <div v-if="visibleUpstream.length > 0" class="detail-stack detail-stack--tight">
                <article v-for="item in visibleUpstream" :key="item.taskId" class="approval-card detail-item-card">
                  <div class="detail-item-card__top">
                    <div>
                      <span class="approval-card__lane">{{ item.taskId }}</span>
                      <strong>{{ item.title }}</strong>
                    </div>
                    <n-tag :type="statusTagType(item.status)" size="small">{{ statusLabel(item.status) }}</n-tag>
                  </div>
                  <p>{{ item.statusReason }}</p>
                  <RouterLink class="ghost-link detail-item-card__link" :to="taskLink(item)">
                    {{ "打开任务详情" }}
                  </RouterLink>
                </article>
                <n-button v-if="hasMoreUpstream" quaternary size="small" @click="loadMoreUpstream">
                  {{ "加载更多上游依赖" }}
                </n-button>
              </div>
              <p v-else class="panel-card__body">{{ "这个任务没有上游依赖。" }}</p>
            </article>

            <article class="detail-subcard">
              <strong>{{ "下游影响" }}</strong>
              <div v-if="visibleDownstream.length > 0" class="detail-stack detail-stack--tight">
                <article v-for="item in visibleDownstream" :key="item.taskId" class="approval-card detail-item-card">
                  <div class="detail-item-card__top">
                    <div>
                      <span class="approval-card__lane">{{ item.taskId }}</span>
                      <strong>{{ item.title }}</strong>
                    </div>
                    <n-tag :type="statusTagType(item.status)" size="small">{{ statusLabel(item.status) }}</n-tag>
                  </div>
                  <p>{{ item.statusReason }}</p>
                  <RouterLink class="ghost-link detail-item-card__link" :to="taskLink(item)">
                    {{ "打开任务详情" }}
                  </RouterLink>
                </article>
                <n-button v-if="hasMoreDownstream" quaternary size="small" @click="loadMoreDownstream">
                  {{ "加载更多下游任务" }}
                </n-button>
              </div>
              <p v-else class="panel-card__body">{{ "这个任务当前没有下游任务。" }}</p>
            </article>
          </div>
        </n-card>

        <n-card v-else-if="activeSection === 'sessions'" class="panel-card detail-card" size="small">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ "执行会话" }}</p>
              <h2>{{ "任务绑定的会话视图" }}</h2>
            </div>
            <n-tag size="small" round>{{ projection.sessions.length }}</n-tag>
          </div>

          <div v-if="visibleSessions.length > 0" class="detail-stack">
            <article
              v-for="session in visibleSessions"
              :key="session.sessionId ?? session.label"
              class="approval-card detail-item-card"
            >
              <div class="detail-item-card__top">
                <div>
                  <span class="approval-card__lane">{{ session.label }}</span>
                  <strong>{{ session.agentId }}</strong>
                </div>
                <n-tag :type="statusTagType(session.status)" size="small">{{ statusLabel(session.status) }}</n-tag>
              </div>
              <p class="panel-card__body">{{ sessionSourceLabel(session.sourceMode) }}</p>
              <p>{{ session.latestActivitySummary }}</p>
              <RouterLink v-if="sessionLink(session.sessionId)" class="ghost-link detail-item-card__link" :to="sessionLink(session.sessionId)!">
                {{ "打开会话详情" }}
              </RouterLink>
            </article>
            <n-button v-if="hasMoreSessions" quaternary size="small" @click="loadMoreSessions">
              {{ "加载更多会话" }}
            </n-button>
          </div>
          <n-empty
            v-else
            class="panel-card__empty-state"
            :description="'当前没有可回放的会话窗口。'"
            size="small"
          />
        </n-card>

        <n-card v-else class="panel-card detail-card" size="small">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ "产物摘要" }}</p>
              <h2>{{ "最近产物与高亮" }}</h2>
            </div>
            <n-tag size="small" round>{{ projection.artifacts.totalCount }}</n-tag>
          </div>

          <div v-if="visibleArtifacts.length > 0" class="detail-stack detail-stack--grid">
            <article v-for="artifact in visibleArtifacts" :key="artifact.artifactId" class="approval-card detail-item-card">
              <div class="detail-item-card__top">
                <div>
                  <span class="approval-card__lane">{{ artifact.kind }}</span>
                  <strong>{{ artifact.summary }}</strong>
                </div>
                <span class="flow-pill">{{ artifact.createdAt }}</span>
              </div>
              <p class="panel-card__body">{{ artifact.uri }}</p>
              <n-button quaternary size="small" class="detail-item-card__link" @click="toggleArtifactPreview(artifact.artifactId)">
                {{ isArtifactExpanded(artifact.artifactId) ? "收起内容" : "查看内容" }}
              </n-button>
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
            <n-button v-if="hasMoreArtifacts" quaternary size="small" @click="loadMoreArtifacts">
              {{ "加载更多产物" }}
            </n-button>
          </div>
          <n-empty
            v-else
            class="panel-card__empty-state"
            :description="'当前没有可展示的 task 产物。'"
            size="small"
          />
        </n-card>
      </template>
    </div>
  </section>
</template>
