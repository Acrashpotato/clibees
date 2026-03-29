<script setup lang="ts">
import { NAlert, NButton, NCard, NTabPane, NTabs, NTag } from "naive-ui";
import { RouterLink } from "vue-router";

import TaskDetailArtifactsSection from "./task-detail/TaskDetailArtifactsSection.vue";
import TaskDetailDependenciesSection from "./task-detail/TaskDetailDependenciesSection.vue";
import TaskDetailSessionsSection from "./task-detail/TaskDetailSessionsSection.vue";
import TaskDetailSummarySection from "./task-detail/TaskDetailSummarySection.vue";
import { useTaskDetailPage } from "./task-detail/useTaskDetailPage";

const {
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
} = useTaskDetailPage();
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
          {{ "刷新" }}
        </n-button>
        <RouterLink class="ghost-link" :to="boardLink()">{{ "返回任务板" }}</RouterLink>
        <RouterLink class="ghost-link" :to="workspaceLink()">{{ "返回工作台" }}</RouterLink>
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

      <div v-if="loading && !error" class="panel-card__empty-state">
        {{ "正在加载任务详情。" }}
      </div>

      <TaskDetailSummarySection
        v-else-if="activeSection === 'summary'"
        :overview="overview"
        :validation="projection.validation"
        :latest-approval="projection.latestApproval"
        :requirement-groups="requirementGroups"
        :validation-label="validationLabel"
        :validation-tag-type="validationTagType"
        :approval-state-label="approvalStateLabel"
        :source-mode-label="sourceModeLabel"
      />

      <TaskDetailDependenciesSection
        v-else-if="activeSection === 'dependencies'"
        :visible-upstream="visibleUpstream"
        :has-more-upstream="hasMoreUpstream"
        :load-more-upstream="loadMoreUpstream"
        :visible-downstream="visibleDownstream"
        :has-more-downstream="hasMoreDownstream"
        :load-more-downstream="loadMoreDownstream"
        :status-label="statusLabel"
        :status-tag-type="statusTagType"
        :task-link="taskLink"
      />

      <TaskDetailSessionsSection
        v-else-if="activeSection === 'sessions'"
        :session-count="projection.sessions.length"
        :visible-sessions="visibleSessions"
        :has-more-sessions="hasMoreSessions"
        :load-more-sessions="loadMoreSessions"
        :status-label="statusLabel"
        :status-tag-type="statusTagType"
        :session-source-label="sessionSourceLabel"
        :session-link="sessionLink"
      />

      <TaskDetailArtifactsSection
        v-else
        :total-count="projection.artifacts.totalCount"
        :visible-artifacts="visibleArtifacts"
        :has-more-artifacts="hasMoreArtifacts"
        :load-more-artifacts="loadMoreArtifacts"
        :toggle-artifact-preview="toggleArtifactPreview"
        :is-artifact-expanded="isArtifactExpanded"
        :artifact-preview-loading-id="artifactPreviewLoadingId"
        :artifact-preview-error-by-id="artifactPreviewErrorById"
        :artifact-preview-by-id="artifactPreviewById"
      />
    </div>
  </section>
</template>
