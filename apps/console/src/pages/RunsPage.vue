<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";

import { createRun, listRuns } from "../api";
import { usePreferences } from "../composables/usePreferences";
import type { RunSummaryView } from "../types";
import { getWorkspacePath } from "../workspace";

const router = useRouter();
const { statusLabel, t } = usePreferences();
const runIdInput = ref("");
const goalInput = ref("");
const openError = ref("");
const createError = ref("");
const loading = ref(false);
const creating = ref(false);
const runs = ref<RunSummaryView[]>([]);

const sortedRuns = computed(() =>
  [...runs.value].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
);

async function loadRuns() {
  loading.value = true;
  try {
    runs.value = await listRuns();
    openError.value = "";
  } catch (caught) {
    openError.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

function openRunWorkspace() {
  const runId = runIdInput.value.trim();

  if (!runId) {
    openError.value = t("runs.enterRunIdError");
    return;
  }

  openError.value = "";
  void router.push(getWorkspacePath("overview", runId));
}

async function createNewRun() {
  const goal = goalInput.value.trim();
  if (!goal) {
    createError.value = t("runs.enterGoalError");
    return;
  }

  creating.value = true;
  try {
    createError.value = "";
    const created = await createRun(goal);
    goalInput.value = "";
    await loadRuns();
    void router.push(getWorkspacePath("overview", created.runId));
  } catch (caught) {
    createError.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    creating.value = false;
  }
}

onMounted(() => {
  void loadRuns();
});
</script>

<template>
  <section class="runs-shell">
    <div class="runs-hero">
      <div class="runs-hero__copy">
        <p class="section-eyebrow">{{ t("sections.runs") }}</p>
        <h1>{{ t("runs.heroTitle") }}</h1>
        <p>{{ t("runs.heroDescription") }}</p>

        <div class="run-create-card">
          <div>
            <p class="section-eyebrow">{{ t("sections.runWorkspace") }}</p>
            <h2>{{ t("runs.createRunTitle") }}</h2>
          </div>
          <label class="form-label" for="run-goal-input">{{ t("runs.goal") }}</label>
          <textarea
            id="run-goal-input"
            v-model="goalInput"
            class="text-input text-input--textarea"
            rows="4"
            :placeholder="t('runs.goalPlaceholder')"
          ></textarea>
          <p v-if="createError" class="form-error">{{ createError }}</p>
          <div class="run-open-card__actions">
            <button class="primary-button" type="button" :disabled="creating" @click="createNewRun">
              {{ creating ? t("actions.creating") : t("actions.createRun") }}
            </button>
          </div>
        </div>
      </div>

      <div class="run-open-card">
        <div>
          <p class="section-eyebrow">{{ t("runs.runOpen") }}</p>
          <h2>{{ t("runs.jumpByRunId") }}</h2>
        </div>
        <label class="form-label" for="run-id-input">{{ t("runs.runId") }}</label>
        <input
          id="run-id-input"
          v-model="runIdInput"
          class="text-input"
          type="text"
          placeholder="run-2026-03-11T10-10-27-084Z-99439c9c"
          @keydown.enter.prevent="openRunWorkspace"
        />
        <p class="form-hint">{{ t("runs.runIdHint") }}</p>
        <p v-if="openError" class="form-error">{{ openError }}</p>
        <div class="run-open-card__actions">
          <button class="primary-button" type="button" @click="openRunWorkspace">{{ t("actions.openWorkspace") }}</button>
          <RouterLink class="ghost-link" to="/workspace">{{ t("actions.openDefaultShell") }}</RouterLink>
        </div>
      </div>
    </div>

    <section class="runs-board">
      <div class="section-header">
        <div>
          <p class="section-eyebrow">{{ t("sections.recentRuns") }}</p>
          <h2>{{ t("sections.latestActivity") }}</h2>
        </div>
        <div class="section-actions">
          <button class="ghost-button" type="button" :disabled="loading" @click="loadRuns">{{ t("actions.refresh") }}</button>
          <span class="mode-chip mode-chip--active">{{ sortedRuns.length }} {{ t("sections.runs") }}</span>
        </div>
      </div>

      <div v-if="sortedRuns.length > 0" class="run-list">
        <article v-for="run in sortedRuns" :key="run.runId" class="run-card" :data-status="run.status">
          <div class="run-card__header">
            <div>
              <p class="lane-panel__eyebrow">{{ run.runId }}</p>
              <h3>{{ run.goal }}</h3>
            </div>
            <span class="status-pill" :data-status="run.status">{{ statusLabel(run.status) }}</span>
          </div>

          <p class="run-card__summary">{{ run.summary }}</p>

          <div class="run-card__meta">
            <div>
              <span>{{ t("fields.stage") }}</span>
              <strong>{{ run.stage }}</strong>
            </div>
            <div>
              <span>{{ t("fields.started") }}</span>
              <strong>{{ run.startedAt }}</strong>
            </div>
            <div>
              <span>{{ t("fields.updated") }}</span>
              <strong>{{ run.updatedAt }}</strong>
            </div>
          </div>

          <div class="run-card__stats">
            <span>{{ t("fields.activeTasks") }} {{ run.activeTaskCount }}</span>
            <span>{{ t("fields.activeSessions") }} {{ run.activeSessionCount }}</span>
            <span>{{ t("fields.blocked") }} {{ run.blockedTaskCount }}</span>
            <span>{{ t("fields.approvals") }} {{ run.pendingApprovalCount }}</span>
          </div>

          <div class="run-card__actions">
            <RouterLink class="primary-link" :to="getWorkspacePath('overview', run.runId)">{{ t("actions.openWorkspace") }}</RouterLink>
            <RouterLink class="ghost-link" :to="`/inspect?runId=${encodeURIComponent(run.runId)}`">{{ t("actions.openInspect") }}</RouterLink>
            <button class="ghost-button" type="button" @click="runIdInput = run.runId">{{ t("actions.useThisId") }}</button>
          </div>
        </article>
      </div>

      <div v-else class="panel-card__empty-state">
        <p class="panel-card__body">{{ loading ? t("runs.loadingRuns") : t("runs.noRuns") }}</p>
      </div>
    </section>
  </section>
</template>

