<script setup lang="ts">
import { RouterLink } from "vue-router";

import { usePreferences } from "../../composables/usePreferences";
import type { WorkspaceOverviewActionViewModel } from "../../composables/useWorkspaceOverview";

const props = defineProps<{
  action?: WorkspaceOverviewActionViewModel;
  inspectTo: string;
  mutating: boolean;
}>();

const emit = defineEmits<{
  resume: [];
}>();

const { t } = usePreferences();
</script>

<template>
  <section class="workspace-overview-card workspace-next-action-card panel-card">
    <header class="workspace-overview-card__header">
      <div>
        <p class="section-eyebrow">{{ t("sections.pendingForYou") }}</p>
        <h2>{{ t("sections.actionQueue") }}</h2>
      </div>
    </header>

    <template v-if="action">
      <p class="workspace-next-action-card__title">{{ action.title }}</p>
      <p class="workspace-overview-card__description">{{ action.summary }}</p>
      <div class="workspace-overview-card__actions workspace-overview-card__actions--inline">
        <button
          v-if="action.kind === 'resume'"
          class="primary-button"
          type="button"
          :disabled="mutating"
          @click="emit('resume')"
        >
          {{ mutating ? t("actions.resuming") : t("actions.resumeRun") }}
        </button>
        <RouterLink v-else-if="action.to" class="primary-link" :to="action.to">
          {{ action.to.includes("/inspect") ? t("actions.openInspect") : t("actions.openLane") }}
        </RouterLink>
        <RouterLink class="ghost-link" :to="inspectTo">
          {{ t("actions.openInspect") }}
        </RouterLink>
      </div>
    </template>

    <div v-else class="panel-card__empty-state">
      <p class="panel-card__body">{{ t("workspacePage.actionQueueEmpty") }}</p>
      <RouterLink class="ghost-link" :to="inspectTo">{{ t("actions.openInspect") }}</RouterLink>
    </div>
  </section>
</template>
