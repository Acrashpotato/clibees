<script setup lang="ts">
import { NButton, NCard, NEmpty, NTag } from "naive-ui";
import { useRouter } from "vue-router";

import { usePreferences } from "../../composables/usePreferences";
import type { WorkspaceOverviewBlockerViewModel } from "../../composables/useWorkspaceOverview";

defineProps<{
  items: WorkspaceOverviewBlockerViewModel[];
  totalCount: number;
  inspectTo: string;
}>();

const router = useRouter();
const { statusLabel, t } = usePreferences();

function goTo(path: string): void {
  void router.push(path);
}

function statusTagType(status: WorkspaceOverviewBlockerViewModel["status"]): "warning" | "error" {
  return status === "failed" ? "error" : "warning";
}
</script>

<template>
  <n-card class="workspace-overview-card workspace-blocker-card panel-card" size="small">
    <div class="workspace-overview-card__header">
      <div>
        <p class="section-eyebrow">{{ t("sections.runReminders") }}</p>
        <h2>{{ t("fields.blocked") }}</h2>
      </div>
      <n-tag size="small" round>{{ totalCount }}</n-tag>
    </div>

    <div v-if="items.length > 0" class="workspace-blocker-card__list">
      <article v-for="item in items" :key="item.id" class="workspace-blocker-item" :data-status="item.status">
        <div class="workspace-blocker-item__row">
          <n-tag :type="statusTagType(item.status)" size="small">
            {{ statusLabel(item.status) }}
          </n-tag>
          <n-button quaternary size="small" @click="goTo(item.to)">
            {{ t("actions.openLane") }}
          </n-button>
        </div>
        <strong>{{ item.title }}</strong>
        <p class="panel-card__body">{{ item.summary }}</p>
      </article>
    </div>

    <n-empty
      v-else
      :description="t('workspacePage.healthEmpty')"
      size="small"
    />

    <div class="workspace-overview-card__actions workspace-overview-card__actions--inline">
      <n-button quaternary size="small" @click="goTo(inspectTo)">
        {{ t("actions.openInspect") }}
      </n-button>
    </div>
  </n-card>
</template>

