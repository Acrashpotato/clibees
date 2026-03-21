<script setup lang="ts">
import { NAlert } from "naive-ui";

import BlockerQueueCard from "../components/workspace/BlockerQueueCard.vue";
import FocusTaskCard from "../components/workspace/FocusTaskCard.vue";
import NextActionCard from "../components/workspace/NextActionCard.vue";
import RunSnapshotCard from "../components/workspace/RunSnapshotCard.vue";
import { usePreferences } from "../composables/usePreferences";
import { useWorkspaceOverview } from "../composables/useWorkspaceOverview";

const { t } = usePreferences();
const {
  error,
  loading,
  mutating,
  refresh,
  resumeRun,
  inspectTo,
  run,
  focusTask,
  nextAction,
  blockerTop,
  blockerTotalCount,
} = useWorkspaceOverview();
</script>

<template>
  <section class="workspace-page-stack workspace-overview-page">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ t("sections.workspace") }}</p>
        <h1>{{ t("workspacePage.overviewTitle") }}</h1>
      </div>
      <p>{{ t("workspacePage.overviewDescription") }}</p>
    </div>

    <n-alert v-if="error" type="error" :show-icon="false">
      {{ error }}
    </n-alert>

    <div class="workspace-overview-grid">
      <RunSnapshotCard
        :run="run"
        :loading="loading"
        :mutating="mutating"
        @refresh="refresh"
        @resume="resumeRun"
      />
      <NextActionCard :action="nextAction" :inspect-to="inspectTo" :mutating="mutating" @resume="resumeRun" />
      <FocusTaskCard :focus-task="focusTask" :inspect-to="inspectTo" />
      <BlockerQueueCard :items="blockerTop" :total-count="blockerTotalCount" :inspect-to="inspectTo" />
    </div>
  </section>
</template>

