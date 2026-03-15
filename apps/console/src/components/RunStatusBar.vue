<script setup lang="ts">
import { computed } from "vue";

import { usePreferences } from "../composables/usePreferences";
import type { WorkspaceView } from "../view-models";
import { getFocusTask } from "../workspace";

const props = defineProps<{
  workspace: WorkspaceView;
  loading?: boolean;
  mutating?: boolean;
}>();

const emit = defineEmits<{
  resume: [];
}>();

const { statusLabel, t } = usePreferences();

const focusTask = computed(() => getFocusTask(props.workspace));
const pendingCount = computed(
  () => props.workspace.approvals.length + props.workspace.tasks.filter((task) => task.status !== "completed").length
);
</script>

<template>
  <section class="status-bar workspace-hero">
    <div class="workspace-hero__intro">
      <div>
        <p class="section-eyebrow">{{ t("sections.runWorkspace") }}</p>
        <h1>{{ workspace.goal }}</h1>
        <p class="workspace-hero__lead">{{ workspace.stage }}</p>
      </div>
      <div class="workspace-hero__meta">
        <span class="status-pill" :data-status="workspace.runStatus">{{ statusLabel(workspace.runStatus) }}</span>
        <button v-if="workspace.canResume" class="primary-button" type="button" :disabled="loading || mutating" @click="emit('resume')">
          {{ mutating ? t("actions.resuming") : t("actions.resumeRun") }}
        </button>
      </div>
    </div>

    <div class="workspace-summary-grid">
      <article class="summary-card">
        <span>{{ t("fields.stage") }}</span>
        <strong>{{ workspace.stage }}</strong>
      </article>
      <article class="summary-card">
        <span>{{ t("fields.focus") }}</span>
        <strong>{{ focusTask?.role ?? t("runs.noRuns") }}</strong>
      </article>
      <article class="summary-card">
        <span>{{ t("fields.pendingActions") }}</span>
        <strong>{{ pendingCount }}</strong>
      </article>
      <article class="summary-card">
        <span>{{ t("fields.lastActivity") }}</span>
        <strong>{{ focusTask?.lastActivityAt ?? workspace.updatedAt }}</strong>
      </article>
    </div>
  </section>
</template>
