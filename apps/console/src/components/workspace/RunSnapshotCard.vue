<script setup lang="ts">
import { NButton, NCard, NGi, NGrid, NTag } from "naive-ui";

import { usePreferences } from "../../composables/usePreferences";
import type { WorkspaceOverviewRunSnapshot } from "../../workspace-overview-selectors";

defineProps<{
  run: WorkspaceOverviewRunSnapshot;
  loading: boolean;
  mutating: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  resume: [];
}>();

const { statusLabel, t } = usePreferences();

function statusTagType(status: WorkspaceOverviewRunSnapshot["status"]): "default" | "info" | "success" | "warning" | "error" {
  switch (status) {
    case "running":
      return "info";
    case "completed":
      return "success";
    case "awaiting_approval":
      return "warning";
    case "failed":
      return "error";
    default:
      return "default";
  }
}
</script>

<template>
  <n-card class="workspace-overview-card workspace-run-card panel-card" size="small">
    <div class="workspace-overview-card__header">
      <div>
        <p class="section-eyebrow">{{ t("sections.runWorkspace") }}</p>
        <h2>{{ run.goal }}</h2>
      </div>
      <div class="workspace-overview-card__actions">
        <n-tag :type="statusTagType(run.status)" size="small">
          {{ statusLabel(run.status) }}
        </n-tag>
        <n-button quaternary size="small" :disabled="loading" @click="emit('refresh')">
          {{ t("actions.refresh") }}
        </n-button>
        <n-button
          v-if="run.canResume"
          type="primary"
          size="small"
          :disabled="loading || mutating"
          @click="emit('resume')"
        >
          {{ mutating ? t("actions.resuming") : t("actions.resumeRun") }}
        </n-button>
      </div>
    </div>

    <p class="workspace-overview-card__description">{{ run.stage }}</p>

    <n-grid class="workspace-overview-card__metrics" :x-gap="10" :y-gap="10" cols="2 s:2 m:4" responsive="screen">
      <n-gi>
        <article class="summary-card">
          <span>{{ t("fields.activeTasks") }}</span>
          <strong>{{ run.activeTaskCount }}</strong>
        </article>
      </n-gi>
      <n-gi>
        <article class="summary-card">
          <span>{{ t("fields.blocked") }}</span>
          <strong>{{ run.blockedTaskCount }}</strong>
        </article>
      </n-gi>
      <n-gi>
        <article class="summary-card">
          <span>{{ t("fields.approvals") }}</span>
          <strong>{{ run.pendingApprovalCount }}</strong>
        </article>
      </n-gi>
      <n-gi>
        <article class="summary-card">
          <span>{{ t("fields.totalTasks") }}</span>
          <strong>{{ run.totalTaskCount }}</strong>
        </article>
      </n-gi>
    </n-grid>
  </n-card>
</template>

