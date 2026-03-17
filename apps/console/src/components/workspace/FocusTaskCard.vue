<script setup lang="ts">
import { RouterLink } from "vue-router";

import { usePreferences } from "../../composables/usePreferences";
import type { WorkspaceOverviewFocusViewModel } from "../../composables/useWorkspaceOverview";

const props = defineProps<{
  focusTask?: WorkspaceOverviewFocusViewModel;
  inspectTo: string;
}>();

const { riskLabel, statusLabel, t } = usePreferences();
</script>

<template>
  <section class="workspace-overview-card workspace-focus-card panel-card">
    <header class="workspace-overview-card__header">
      <div>
        <p class="section-eyebrow">{{ t("sections.currentBottleneck") }}</p>
        <h2>{{ focusTask?.title ?? t("workspacePage.focusTitle") }}</h2>
      </div>
      <div v-if="focusTask" class="lane-panel__badges">
        <span class="status-pill" :data-status="focusTask.status">{{ statusLabel(focusTask.status) }}</span>
        <span class="risk-pill" :data-risk="focusTask.riskLevel">{{ riskLabel(focusTask.riskLevel) }}</span>
      </div>
    </header>

    <template v-if="focusTask">
      <p class="workspace-overview-card__description">{{ focusTask.statusReason }}</p>
      <div class="workspace-overview-card__metrics workspace-overview-card__metrics--two">
        <article class="summary-card">
          <span>{{ t("fields.owner") }}</span>
          <strong>{{ focusTask.ownerLabel }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.lastActivity") }}</span>
          <strong>{{ focusTask.lastActivityAt }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.upstreamDeps") }}</span>
          <strong>{{ focusTask.dependsOnCount }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.downstreamTasks") }}</span>
          <strong>{{ focusTask.downstreamCount }}</strong>
        </article>
      </div>
      <div class="workspace-overview-card__actions workspace-overview-card__actions--inline">
        <RouterLink class="primary-link" :to="focusTask.to">{{ t("actions.openLane") }}</RouterLink>
      </div>
    </template>

    <div v-else class="panel-card__empty-state">
      <p class="panel-card__body">{{ t("workspacePage.focusDescriptionShort") }}</p>
      <RouterLink class="ghost-link" :to="inspectTo">{{ t("actions.openInspect") }}</RouterLink>
    </div>
  </section>
</template>
