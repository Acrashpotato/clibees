<script setup lang="ts">
import { RouterLink } from "vue-router";

import { usePreferences } from "../../composables/usePreferences";
import type { WorkspaceOverviewBlockerViewModel } from "../../composables/useWorkspaceOverview";

const props = defineProps<{
  items: WorkspaceOverviewBlockerViewModel[];
  totalCount: number;
  inspectTo: string;
}>();

const { statusLabel, t } = usePreferences();
</script>

<template>
  <section class="workspace-overview-card workspace-blocker-card panel-card">
    <header class="workspace-overview-card__header">
      <div>
        <p class="section-eyebrow">{{ t("sections.runReminders") }}</p>
        <h2>{{ t("fields.blocked") }}</h2>
      </div>
      <span class="panel-chip">{{ totalCount }}</span>
    </header>

    <div v-if="items.length > 0" class="workspace-blocker-card__list">
      <article v-for="item in items" :key="item.id" class="workspace-blocker-item" :data-status="item.status">
        <div class="workspace-blocker-item__row">
          <span class="status-pill" :data-status="item.status">{{ statusLabel(item.status) }}</span>
          <RouterLink class="ghost-link" :to="item.to">{{ t("actions.openLane") }}</RouterLink>
        </div>
        <strong>{{ item.title }}</strong>
        <p class="panel-card__body">{{ item.summary }}</p>
      </article>
    </div>

    <div v-else class="panel-card__empty-state">
      <p class="panel-card__body">{{ t("workspacePage.healthEmpty") }}</p>
    </div>

    <div class="workspace-overview-card__actions workspace-overview-card__actions--inline">
      <RouterLink class="ghost-link" :to="inspectTo">{{ t("actions.openInspect") }}</RouterLink>
    </div>
  </section>
</template>
