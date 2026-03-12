<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { approveRequest, listApprovals, rejectRequest } from "../api";
import { usePreferences } from "../composables/usePreferences";
import type { ApprovalItem } from "../types";
import { getLaneConsolePath, getWorkspacePath } from "../workspace";

const route = useRoute();
const { riskLabel, t } = usePreferences();
const approvals = ref<ApprovalItem[]>([]);
const loading = ref(false);
const error = ref("");
const activeId = computed(() => (typeof route.query.requestId === "string" ? route.query.requestId : undefined));
const actingId = ref("");

const sortedApprovals = computed(() =>
  [...approvals.value].sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
);

async function refreshApprovals() {
  loading.value = true;
  try {
    error.value = "";
    approvals.value = await listApprovals();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function decide(approval: ApprovalItem, decision: "approve" | "reject") {
  actingId.value = approval.id;
  try {
    if (decision === "approve") {
      await approveRequest(approval.runId, approval.id);
    } else {
      await rejectRequest(approval.runId, approval.id);
    }
    await refreshApprovals();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    actingId.value = "";
  }
}

onMounted(() => {
  void refreshApprovals();
});
</script>

<template>
  <section class="workspace-page-stack">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ t("nav.approvals") }}</p>
        <h1>{{ t("approvalsPage.title") }}</h1>
      </div>
      <p>{{ t("approvalsPage.description") }}</p>
    </div>

    <div class="section-actions approvals-page__actions">
      <button class="ghost-button" type="button" :disabled="loading" @click="refreshApprovals">{{ t("actions.refresh") }}</button>
    </div>

    <div v-if="error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ error }}</p>
    </div>

    <section v-if="sortedApprovals.length > 0" class="approvals-board">
      <article
        v-for="approval in sortedApprovals"
        :key="approval.id"
        class="approval-card approval-card--decision"
        :class="{ 'approval-card--active': approval.id === activeId }"
        :data-risk="approval.riskLevel"
      >
        <div class="handoff-card__topline">
          <div>
            <span class="approval-card__lane">{{ approval.runId }}</span>
            <h2>{{ approval.title }}</h2>
          </div>
          <span class="risk-pill" :data-risk="approval.riskLevel">{{ riskLabel(approval.riskLevel) }}</span>
        </div>

        <p>{{ approval.summary }}</p>

        <div class="approval-card__meta-row">
          <span>{{ approval.laneId }}</span>
          <span>{{ approval.requestedAt }}</span>
        </div>

        <div v-if="approval.actions.length > 0" class="detail-grid">
          <div v-for="action in approval.actions" :key="action" class="detail-chip detail-chip--compact detail-chip--row">
            <span>{{ t("approvalsPage.actionSummary") }}</span>
            <strong>{{ action }}</strong>
          </div>
        </div>

        <div class="run-card__actions">
          <button class="primary-button" type="button" :disabled="actingId === approval.id" @click="decide(approval, 'approve')">
            {{ actingId === approval.id ? t("actions.processing") : t("actions.approve") }}
          </button>
          <button class="ghost-button" type="button" :disabled="actingId === approval.id" @click="decide(approval, 'reject')">
            {{ t("actions.reject") }}
          </button>
          <RouterLink class="ghost-link" :to="getWorkspacePath('overview', approval.runId)">{{ t("actions.openWorkspace") }}</RouterLink>
          <RouterLink class="ghost-link" :to="getLaneConsolePath(approval.runId, approval.laneId)">{{ t("actions.openLane") }}</RouterLink>
        </div>
      </article>
    </section>

    <div v-else class="panel-card__empty-state">
      <p class="panel-card__body">{{ loading ? t("approvalsPage.loading") : t("approvalsPage.empty") }}</p>
    </div>
  </section>
</template>

