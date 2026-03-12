<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { getInspect, listRuns } from "../api";
import { usePreferences } from "../composables/usePreferences";
import type { InspectView, RunSummaryView } from "../types";
import { getWorkspacePath } from "../workspace";

const route = useRoute();
const { t } = usePreferences();
const runs = ref<RunSummaryView[]>([]);
const inspect = ref<InspectView | null>(null);
const loading = ref(false);
const error = ref("");

const selectedRunId = computed(() => (typeof route.query.runId === "string" ? route.query.runId : runs.value[0]?.runId));

async function loadRuns() {
  runs.value = await listRuns();
}

async function loadInspect() {
  loading.value = true;
  try {
    error.value = "";
    await loadRuns();
    if (!selectedRunId.value) {
      inspect.value = null;
      return;
    }
    inspect.value = await getInspect(selectedRunId.value);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

watch(
  () => route.fullPath,
  () => {
    void loadInspect();
  },
  { immediate: true },
);

</script>

<template>
  <section class="workspace-page-stack">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ t("nav.inspect") }}</p>
        <h1>{{ t("inspectPage.title") }}</h1>
      </div>
      <p>{{ t("inspectPage.description") }}</p>
    </div>

    <div class="section-actions approvals-page__actions">
      <button class="ghost-button" type="button" :disabled="loading" @click="loadInspect">{{ t("actions.refresh") }}</button>
    </div>

    <div v-if="runs.length > 0" class="inspect-run-selector">
      <RouterLink
        v-for="run in runs"
        :key="run.runId"
        class="workspace-tabs__link"
        :class="{ 'workspace-tabs__link--active': run.runId === selectedRunId }"
        :to="`/inspect?runId=${encodeURIComponent(run.runId)}`"
      >
        {{ run.runId }}
      </RouterLink>
    </div>

    <div v-if="error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ error }}</p>
    </div>

    <template v-if="inspect">
      <section class="inspect-summary-grid">
        <article class="summary-card">
          <span>{{ t("fields.stage") }}</span>
          <strong>{{ inspect.run.status }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("inspectPage.completed") }}</span>
          <strong>{{ inspect.summary.completedTasks }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.blocked") }}</span>
          <strong>{{ inspect.summary.blockedTasks }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.approvals") }}</span>
          <strong>{{ inspect.summary.pendingApprovals }}</strong>
        </article>
      </section>

      <section class="workspace-support-grid">
        <article class="panel-card">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ t("inspectPage.timeline") }}</p>
              <h2>{{ inspect.run.goal }}</h2>
            </div>
            <RouterLink class="ghost-link" :to="getWorkspacePath('overview', inspect.run.runId)">{{ t("actions.openWorkspace") }}</RouterLink>
          </div>
          <div class="inspect-timeline">
            <article v-for="entry in inspect.timeline.slice().reverse()" :key="entry.eventId" class="handoff-card handoff-card--flow">
              <div class="handoff-card__topline">
                <strong>{{ entry.title }}</strong>
                <span>{{ entry.timestamp }}</span>
              </div>
              <p v-if="entry.taskId">{{ entry.taskId }}</p>
              <div v-if="entry.details.length > 0" class="detail-grid">
                <div v-for="detail in entry.details" :key="detail" class="detail-chip detail-chip--compact detail-chip--row">
                  <span>{{ t("inspectPage.detail") }}</span>
                  <strong>{{ detail }}</strong>
                </div>
              </div>
            </article>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ t("sections.recentChecks") }}</p>
              <h2>{{ t("inspectPage.validation") }}</h2>
            </div>
          </div>
          <div class="approval-list">
            <article v-for="item in inspect.validation" :key="item.taskId" class="approval-card">
              <span class="approval-card__lane">{{ item.taskId }}</span>
              <strong>{{ item.taskTitle }}</strong>
              <p>{{ item.summary }}</p>
            </article>
          </div>
        </article>
      </section>
    </template>

    <div v-else class="panel-card__empty-state">
      <p class="panel-card__body">{{ loading ? t("inspectPage.loading") : t("inspectPage.empty") }}</p>
    </div>
  </section>
</template>

