<script setup lang="ts">
import { NButton, NCard, NEmpty, NGi, NGrid, NTag } from "naive-ui";
import { useRouter } from "vue-router";

import { usePreferences } from "../../composables/usePreferences";
import type { WorkspaceOverviewFocusViewModel } from "../../composables/useWorkspaceOverview";

const props = defineProps<{
  focusTask?: WorkspaceOverviewFocusViewModel;
  inspectTo: string;
}>();

const router = useRouter();
const { riskLabel, statusLabel, t } = usePreferences();

function goTo(path: string): void {
  void router.push(path);
}

function statusTagType(status: WorkspaceOverviewFocusViewModel["status"]): "default" | "info" | "success" | "warning" | "error" {
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

function riskTagType(riskLevel: WorkspaceOverviewFocusViewModel["riskLevel"]): "default" | "warning" | "error" {
  switch (riskLevel) {
    case "high":
      return "error";
    case "medium":
      return "warning";
    default:
      return "default";
  }
}
</script>

<template>
  <n-card class="workspace-overview-card workspace-focus-card panel-card" size="small">
    <div class="workspace-overview-card__header">
      <div>
        <p class="section-eyebrow">{{ t("sections.currentBottleneck") }}</p>
        <h2>{{ focusTask?.title ?? t("workspacePage.focusTitle") }}</h2>
      </div>
      <div v-if="focusTask" class="lane-panel__badges">
        <n-tag :type="statusTagType(focusTask.status)" size="small">
          {{ statusLabel(focusTask.status) }}
        </n-tag>
        <n-tag :type="riskTagType(focusTask.riskLevel)" size="small">
          {{ riskLabel(focusTask.riskLevel) }}
        </n-tag>
      </div>
    </div>

    <template v-if="focusTask">
      <p class="workspace-overview-card__description">{{ focusTask.statusReason }}</p>
      <n-grid class="workspace-overview-card__metrics workspace-overview-card__metrics--two" :x-gap="10" :y-gap="10" cols="1 s:2 m:2" responsive="screen">
        <n-gi>
          <article class="summary-card">
            <span>{{ t("fields.owner") }}</span>
            <strong>{{ focusTask.ownerLabel }}</strong>
          </article>
        </n-gi>
        <n-gi>
          <article class="summary-card">
            <span>{{ t("fields.lastActivity") }}</span>
            <strong>{{ focusTask.lastActivityAt }}</strong>
          </article>
        </n-gi>
        <n-gi>
          <article class="summary-card">
            <span>{{ t("fields.upstreamDeps") }}</span>
            <strong>{{ focusTask.dependsOnCount }}</strong>
          </article>
        </n-gi>
        <n-gi>
          <article class="summary-card">
            <span>{{ t("fields.downstreamTasks") }}</span>
            <strong>{{ focusTask.downstreamCount }}</strong>
          </article>
        </n-gi>
      </n-grid>
      <div class="workspace-overview-card__actions workspace-overview-card__actions--inline">
        <n-button type="primary" size="small" @click="goTo(focusTask.to)">
          {{ t("actions.openLane") }}
        </n-button>
      </div>
    </template>

    <n-empty
      v-else
      :description="t('workspacePage.focusDescriptionShort')"
      size="small"
    >
      <template #extra>
        <n-button quaternary size="small" @click="goTo(inspectTo)">
          {{ t("actions.openInspect") }}
        </n-button>
      </template>
    </n-empty>
  </n-card>
</template>

