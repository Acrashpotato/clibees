<script setup lang="ts">
import { NButton, NCard, NEmpty } from "naive-ui";
import { useRouter } from "vue-router";

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

const router = useRouter();
const { t } = usePreferences();

function goTo(path: string): void {
  void router.push(path);
}
</script>

<template>
  <n-card class="workspace-overview-card workspace-next-action-card panel-card" size="small">
    <div class="workspace-overview-card__header">
      <div>
        <p class="section-eyebrow">{{ t("sections.pendingForYou") }}</p>
        <h2>{{ t("sections.actionQueue") }}</h2>
      </div>
    </div>

    <template v-if="action">
      <p class="workspace-next-action-card__title">{{ action.title }}</p>
      <p class="workspace-overview-card__description">{{ action.summary }}</p>
      <div class="workspace-overview-card__actions workspace-overview-card__actions--inline">
        <n-button
          v-if="action.kind === 'resume'"
          type="primary"
          size="small"
          :disabled="mutating"
          @click="emit('resume')"
        >
          {{ mutating ? t("actions.resuming") : t("actions.resumeRun") }}
        </n-button>
        <n-button
          v-else-if="action.to"
          type="primary"
          size="small"
          @click="goTo(action.to)"
        >
          {{ action.to.includes("/inspect") ? t("actions.openInspect") : t("actions.openLane") }}
        </n-button>
        <n-button quaternary size="small" @click="goTo(inspectTo)">
          {{ t("actions.openInspect") }}
        </n-button>
      </div>
    </template>

    <n-empty
      v-else
      :description="t('workspacePage.actionQueueEmpty')"
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

