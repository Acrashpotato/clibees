<script setup lang="ts">
import { usePreferences } from "../../composables/usePreferences";
import type { WorkspaceOverviewRunSnapshot } from "../../workspace-overview-selectors";

const props = defineProps<{
  run: WorkspaceOverviewRunSnapshot;
  loading: boolean;
  mutating: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  resume: [];
}>();

const { statusLabel, t } = usePreferences();
</script>

<template>
  <section class="workspace-overview-card workspace-run-card panel-card">
    <header class="workspace-overview-card__header">
      <div>
        <p class="section-eyebrow">{{ t("sections.runWorkspace") }}</p>
        <h2>{{ run.goal }}</h2>
      </div>
      <div class="workspace-overview-card__actions">
        <span class="status-pill" :data-status="run.status">{{ statusLabel(run.status) }}</span>
        <button class="ghost-button" type="button" :disabled="loading" @click="emit('refresh')">
          {{ t("actions.refresh") }}
        </button>
        <button
          v-if="run.canResume"
          class="primary-button"
          type="button"
          :disabled="loading || mutating"
          @click="emit('resume')"
        >
          {{ mutating ? t("actions.resuming") : t("actions.resumeRun") }}
        </button>
      </div>
    </header>

    <p class="workspace-overview-card__description">{{ run.stage }}</p>

    <div class="workspace-overview-card__metrics">
      <article class="summary-card">
        <span>{{ t("fields.activeTasks") }}</span>
        <strong>{{ run.activeTaskCount }}</strong>
      </article>
      <article class="summary-card">
        <span>{{ t("fields.blocked") }}</span>
        <strong>{{ run.blockedTaskCount }}</strong>
      </article>
      <article class="summary-card">
        <span>{{ t("fields.approvals") }}</span>
        <strong>{{ run.pendingApprovalCount }}</strong>
      </article>
      <article class="summary-card">
        <span>{{ t("fields.totalTasks") }}</span>
        <strong>{{ run.totalTaskCount }}</strong>
      </article>
    </div>
  </section>
</template>
