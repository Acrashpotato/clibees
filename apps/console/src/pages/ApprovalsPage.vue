<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { approveRequest, getApprovalQueueProjection, rejectRequest } from "../api";
import {
  createEmptyApprovalQueueProjection,
  type ApprovalQueueItemDetailView,
  type ApprovalQueueProjectionView,
} from "../approval-projection";
import { useConsoleSettings } from "../composables/useConsoleSettings";
import { usePreferences } from "../composables/usePreferences";
import { getRunWorkspacePath } from "../workspace";
import ApprovalDetailPanel from "./approvals/comp/ApprovalDetailPanel.vue";

const route = useRoute();
const router = useRouter();
const { isZh, riskLabel, t } = usePreferences();
const { settings } = useConsoleSettings();
const projection = ref<ApprovalQueueProjectionView>(createEmptyApprovalQueueProjection());
const loading = ref(false);
const error = ref("");
const actingId = ref("");
const notes = ref<Record<string, string>>({});
const selectedRequestId = ref("");
const stateFilter = ref<"all" | "pending" | "approved" | "rejected">(settings.value.approvalsDefaultFilter);
let autoRefreshHandle: ReturnType<typeof setInterval> | undefined;

const activeId = computed(() => (typeof route.query.requestId === "string" ? route.query.requestId : undefined));
const scopedRunId = computed(() => (typeof route.params.runId === "string" ? route.params.runId : undefined));
const approvals = computed(() => sortApprovals(projection.value.items));
const stateCounts = computed(() => ({
  all: approvals.value.length,
  pending: approvals.value.filter((item) => item.state === "pending").length,
  approved: approvals.value.filter((item) => item.state === "approved").length,
  rejected: approvals.value.filter((item) => item.state === "rejected").length,
}));
const filteredApprovals = computed(() =>
  stateFilter.value === "all"
    ? approvals.value
    : approvals.value.filter((item) => item.state === stateFilter.value),
);
const selectedApproval = computed(() =>
  filteredApprovals.value.find((item) => item.requestId === selectedRequestId.value),
);
const summaryCards = computed(() => [
  {
    id: "scope",
    label: copy("范围", "Scope"),
    value: scopedRunId.value ?? "-",
  },
  {
    id: "pending",
    label: copy("待审批", "Pending"),
    value: String(projection.value.summary.pendingCount),
  },
  {
    id: "approved",
    label: copy("已通过", "Approved"),
    value: String(projection.value.summary.approvedCount),
  },
  {
    id: "rejected",
    label: copy("已拒绝", "Rejected"),
    value: String(projection.value.summary.rejectedCount),
  },
  {
    id: "high-risk",
    label: copy("高风险", "High risk"),
    value: String(projection.value.summary.highRiskCount),
  },
]);

function copy(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

function stateFilterLabel(state: "all" | "pending" | "approved" | "rejected"): string {
  switch (state) {
    case "pending":
      return copy("待审批", "Pending");
    case "approved":
      return copy("已通过", "Approved");
    case "rejected":
      return copy("已拒绝", "Rejected");
    default:
      return copy("全部", "All");
  }
}



function displayRiskLevel(riskLevel: ApprovalQueueItemDetailView["riskLevel"]): "low" | "medium" | "high" {
  return riskLevel === "none" ? "low" : riskLevel;
}

function riskLevelLabel(riskLevel: ApprovalQueueItemDetailView["riskLevel"]): string {
  return riskLevel === "none" ? copy("无", "None") : riskLabel(riskLevel);
}

function decisionStateLabel(state: ApprovalQueueItemDetailView["state"]): string {
  switch (state) {
    case "pending":
      return copy("待审批", "Pending");
    case "approved":
      return copy("已通过", "Approved");
    default:
      return copy("已拒绝", "Rejected");
  }
}

function decisionStatePill(state: ApprovalQueueItemDetailView["state"]): "awaiting_approval" | "completed" | "failed" {
  switch (state) {
    case "pending":
      return "awaiting_approval";
    case "approved":
      return "completed";
    default:
      return "failed";
  }
}

function decisionTimeLabel(approval: ApprovalQueueItemDetailView): string {
  return approval.decidedAt ?? approval.requestedAt;
}

function snippet(summary: string): string {
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (normalized.length <= 110) {
    return normalized;
  }
  return `${normalized.slice(0, 107)}...`;
}








async function loadProjection(showLoading = true) {
  if (loading.value && !showLoading) {
    return;
  }

  if (showLoading) {
    loading.value = true;
  }

  try {
    error.value = "";
    if (!scopedRunId.value) {
      projection.value = createEmptyApprovalQueueProjection();
      error.value = copy("缺少 runId，无法打开审批队列。", "Missing runId, so approval queue cannot be opened.");
      return;
    }
    projection.value = await getApprovalQueueProjection({
      runId: scopedRunId.value,
      limit: settings.value.approvalsFetchLimit,
    });
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

function stopAutoRefresh() {
  if (autoRefreshHandle) {
    clearInterval(autoRefreshHandle);
    autoRefreshHandle = undefined;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();

  if (settings.value.approvalsAutoRefreshSec <= 0) {
    return;
  }

  autoRefreshHandle = setInterval(() => {
    void loadProjection(false);
  }, settings.value.approvalsAutoRefreshSec * 1000);
}

async function decide(approval: ApprovalQueueItemDetailView, decision: "approve" | "reject") {
  actingId.value = approval.requestId;

  try {
    const note = notes.value[approval.requestId]?.trim() || undefined;

    if (decision === "approve") {
      await approveRequest(approval.runId, approval.requestId, note);
    } else {
      await rejectRequest(approval.runId, approval.requestId, note);
    }

    notes.value[approval.requestId] = "";
    await loadProjection(false);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    actingId.value = "";
  }
}

const selectedApprovalNote = computed(() =>
  selectedApproval.value ? (notes.value[selectedApproval.value.requestId] ?? "") : "",
);

function updateSelectedApprovalNote(note: string): void {
  if (!selectedApproval.value) {
    return;
  }

  notes.value = {
    ...notes.value,
    [selectedApproval.value.requestId]: note,
  };
}

function decideSelected(decision: "approve" | "reject"): void {
  if (!selectedApproval.value) {
    return;
  }
  void decide(selectedApproval.value, decision);
}

function sortApprovals(items: ApprovalQueueItemDetailView[]): ApprovalQueueItemDetailView[] {
  return [...items].sort((left, right) => {
    const stateRank = rankApprovalState(left.state) - rankApprovalState(right.state);
    if (stateRank !== 0) {
      return stateRank;
    }
    const riskRank = rankRiskLevel(right.riskLevel) - rankRiskLevel(left.riskLevel);
    if (riskRank !== 0) {
      return riskRank;
    }
    return decisionTimeLabel(right).localeCompare(decisionTimeLabel(left));
  });
}

function rankApprovalState(state: ApprovalQueueItemDetailView["state"]): number {
  switch (state) {
    case "pending":
      return 0;
    case "approved":
      return 1;
    default:
      return 2;
  }
}

function rankRiskLevel(riskLevel: ApprovalQueueItemDetailView["riskLevel"]): number {
  switch (riskLevel) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function selectApproval(approval: ApprovalQueueItemDetailView): void {
  selectedRequestId.value = approval.requestId;
  syncRequestIdQuery(approval.requestId);
}

function syncRequestIdQuery(requestId: string | undefined): void {
  const nextQuery = { ...route.query };
  if (requestId) {
    nextQuery.requestId = requestId;
  } else {
    delete nextQuery.requestId;
  }

  void router.replace({
    query: nextQuery,
  });
}

watch(
  () => scopedRunId.value ?? "",
  () => {
    void loadProjection();
  },
  { immediate: true },
);

watch(
  () => settings.value.approvalsAutoRefreshSec,
  () => {
    startAutoRefresh();
  },
  { immediate: true },
);

watch(
  () => [filteredApprovals.value, activeId.value] as const,
  ([items, routeActiveId]) => {
    if (items.length === 0) {
      selectedRequestId.value = "";
      syncRequestIdQuery(undefined);
      return;
    }

    const routeMatch = routeActiveId
      ? items.find((item) => item.requestId === routeActiveId)
      : undefined;
    if (routeMatch) {
      selectedRequestId.value = routeMatch.requestId;
      return;
    }

    const current = items.find((item) => item.requestId === selectedRequestId.value);
    if (current) {
      return;
    }

    selectedRequestId.value = items[0]!.requestId;
    syncRequestIdQuery(selectedRequestId.value);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopAutoRefresh();
});
</script>

<template>
  <section class="workspace-page-stack approvals-page">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ t("nav.approvals") }}</p>
        <h1>{{ copy("审批队列", "Approval queue") }}</h1>
      </div>
      <p>
        {{
          copy(
            `仅查看 run ${scopedRunId ?? "-"} 的审批请求、task/session 绑定与 action plan 快照。`,
            `Reviewing only approval requests, task/session bindings, and action plan snapshots for run ${scopedRunId ?? "-"}.`,
          )
        }}
      </p>
    </div>

    <div v-if="error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ error }}</p>
    </div>

    <section class="status-bar workspace-hero approvals-hero">
      <div class="approvals-hero__header">
        <div>
          <p class="section-eyebrow">{{ copy("审批摘要", "Approval summary") }}</p>
          <h2>{{ copy("基于审批事实归一化", "Normalized from approval facts") }}</h2>
        </div>
        <div class="approvals-hero__controls">
          <RouterLink
            v-if="scopedRunId"
            class="ghost-link approvals-hero__link"
            :to="getRunWorkspacePath(scopedRunId)"
          >
            {{ t("actions.openWorkspace") }}
          </RouterLink>
          <button
            class="icon-button approvals-hero__refresh"
            type="button"
            :disabled="loading"
            :aria-label="t('actions.refresh')"
            :title="t('actions.refresh')"
            @click="loadProjection(false)"
          >
            <svg
              class="approvals-hero__refresh-icon"
              :class="{ 'approvals-hero__refresh-icon--spinning': loading }"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 4v6h-6" />
            </svg>
          </button>
          <span class="panel-chip">{{ projection.summary.totalCount }}</span>
        </div>
      </div>

      <div class="workspace-summary-grid approvals-page__summary-grid">
        <article v-for="card in summaryCards" :key="card.id" class="summary-card">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </article>
      </div>
    </section>

    <div v-if="loading && approvals.length === 0 && !error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ copy("正在加载审批队列。", "Loading approval queue.") }}</p>
    </div>

    <section v-else-if="approvals.length > 0" class="approvals-mailboard">
      <aside class="panel-card approvals-inbox">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("审批收件箱", "Approval inbox") }}</p>
            <h2>{{ copy("逐条处理", "Open one by one") }}</h2>
          </div>
          <span class="panel-chip">{{ filteredApprovals.length }}</span>
        </div>

        <div class="approvals-filter-row">
          <button
            v-for="state in ['pending', 'approved', 'rejected', 'all'] as const"
            :key="state"
            class="ghost-button approvals-filter-chip"
            type="button"
            :data-active="stateFilter === state"
            @click="stateFilter = state"
          >
            {{ stateFilterLabel(state) }} | {{ stateCounts[state] }}
          </button>
        </div>

        <div v-if="filteredApprovals.length > 0" class="approvals-inbox__list">
          <button
            v-for="approval in filteredApprovals"
            :key="approval.requestId"
            class="approval-card approvals-inbox__item"
            :class="{ 'approvals-inbox__item--active': approval.requestId === selectedApproval?.requestId }"
            :data-risk="displayRiskLevel(approval.riskLevel)"
            type="button"
            @click="selectApproval(approval)"
          >
            <div class="approvals-inbox__item-top">
              <span class="approval-card__lane">{{ approval.requestId }}</span>
              <span class="status-pill" :data-status="decisionStatePill(approval.state)">
                {{ decisionStateLabel(approval.state) }}
              </span>
            </div>
            <strong>{{ approval.taskTitle }}</strong>
            <p class="panel-card__body">{{ snippet(approval.summary) }}</p>
            <div class="approvals-page__badge-row">
              <span class="risk-pill" :data-risk="displayRiskLevel(approval.riskLevel)">
                {{ riskLevelLabel(approval.riskLevel) }}
              </span>
              <span class="flow-pill">{{ decisionTimeLabel(approval) }}</span>
            </div>
          </button>
        </div>
        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ copy("当前筛选条件下没有审批项。", "No approvals under the current filter.") }}</p>
        </div>
      </aside>

      <ApprovalDetailPanel
        :selected-approval="selectedApproval"
        :acting-id="actingId"
        :note="selectedApprovalNote"
        @update:note="updateSelectedApprovalNote"
        @decide="decideSelected"
      />
    </section>

    <div v-else class="panel-card__empty-state">
      <p class="panel-card__body">
        {{
          loading
            ? copy("正在加载审批队列。", "Loading approval queue.")
            : copy("当前没有可展示的审批请求。", "There is no approval request to display right now.")
        }}
      </p>
    </div>
  </section>
</template>


