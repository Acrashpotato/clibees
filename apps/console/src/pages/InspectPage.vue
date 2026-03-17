<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { getAuditTimelineProjection } from "../api";
import {
  createEmptyAuditTimelineProjection,
  type AuditTimelineApprovalHistoryItemView,
  type AuditTimelineEntryKind,
  type AuditTimelineProjectionView,
} from "../audit-timeline-projection";
import { useConsoleSettings } from "../composables/useConsoleSettings";
import { usePreferences } from "../composables/usePreferences";
import InspectSupportGrid from "./inspect/comp/InspectSupportGrid.vue";
import InspectTimelineGrid from "./inspect/comp/InspectTimelineGrid.vue";
import {
  approvalStateLabel as formatApprovalStateLabel,
  approvalStatePill as formatApprovalStatePill,
  eventKindLabel as formatEventKindLabel,
  riskTone as formatRiskTone,
  runStatusLabel as formatRunStatusLabel,
  runStatusPill as formatRunStatusPill,
  sourceLabel as formatSourceLabel,
} from "./inspect/comp/inspect-formatters";
import {
  getRunApprovalsPath,
  getRunWorkspacePath,
  getSessionDetailPath,
  getTaskDetailPath,
} from "../workspace";

const route = useRoute();
const { isZh, riskLabel, t } = usePreferences();
const { settings } = useConsoleSettings();
const projection = ref<AuditTimelineProjectionView>(createEmptyAuditTimelineProjection());
const loading = ref(false);
const error = ref("");
let autoRefreshHandle: ReturnType<typeof setInterval> | undefined;

const routeRunId = computed(() =>
  typeof route.params.runId === "string" ? route.params.runId : undefined,
);
const hasProjection = computed(
  () => Boolean(routeRunId.value) && projection.value.runId === routeRunId.value,
);

const summaryCards = computed(() => [
  [copy("运行状态", "Run status"), runStatusLabel(projection.value.summary.runStatus)],
  [copy("审计事件", "Audit events"), String(projection.value.summary.totalEventCount)],
  [copy("审批事件", "Approval events"), String(projection.value.summary.approvalEventCount)],
  [copy("验证事件", "Validation events"), String(projection.value.summary.validationEventCount)],
  [copy("产物事件", "Artifact events"), String(projection.value.summary.artifactEventCount)],
  [copy("会话事件", "Session events"), String(projection.value.summary.sessionEventCount)],
  [copy("重规划", "Replans"), String(projection.value.summary.replanCount)],
  [
    copy("最近事件", "Latest event"),
    projection.value.summary.latestEventAt ?? copy("未记录", "Not recorded"),
  ],
]);

const findings = computed(() =>
  [
    [copy("最近失败", "Latest failure"), projection.value.summary.latestFailure],
    [copy("最近阻塞", "Latest blocker"), projection.value.summary.latestBlocker],
    [copy("最近验证", "Latest validation"), projection.value.summary.latestValidation],
    [copy("最近重规划", "Latest replan"), projection.value.summary.latestReplan],
  ].filter((item): item is [string, string] => Boolean(item[1])),
);

function copy(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

function textOrDash(value?: string): string {
  return value && value.trim().length > 0 ? value : "-";
}

function runStatusLabel(status: AuditTimelineProjectionView["summary"]["runStatus"]): string {
  return formatRunStatusLabel(status, copy);
}

function runStatusPill(
  status: AuditTimelineProjectionView["summary"]["runStatus"],
): "running" | "awaiting_approval" | "paused" | "completed" | "failed" {
  return formatRunStatusPill(status);
}

function eventKindLabel(kind: AuditTimelineEntryKind): string {
  return formatEventKindLabel(kind, copy);
}

function approvalStateLabel(
  state: AuditTimelineApprovalHistoryItemView["state"],
): string {
  return formatApprovalStateLabel(state, copy);
}

function approvalStatePill(
  state: AuditTimelineApprovalHistoryItemView["state"],
): "awaiting_approval" | "completed" | "failed" {
  return formatApprovalStatePill(state);
}

function riskTone(
  riskLevel: AuditTimelineApprovalHistoryItemView["riskLevel"],
): "low" | "medium" | "high" {
  return formatRiskTone(riskLevel);
}

function sourceLabel(sourceMode: string): string {
  return formatSourceLabel(sourceMode, copy);
}

function taskLink(taskId?: string): string | undefined {
  return routeRunId.value && taskId
    ? getTaskDetailPath(routeRunId.value, taskId)
    : undefined;
}

function sessionLink(sessionId?: string): string | undefined {
  return routeRunId.value && sessionId
    ? getSessionDetailPath(routeRunId.value, sessionId)
    : undefined;
}

function approvalLink(requestId?: string): string | undefined {
  return routeRunId.value && requestId
    ? `${getRunApprovalsPath(routeRunId.value)}?requestId=${encodeURIComponent(requestId)}`
    : undefined;
}

function stopAutoRefresh() {
  if (autoRefreshHandle) {
    clearInterval(autoRefreshHandle);
    autoRefreshHandle = undefined;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();

  if (!routeRunId.value || settings.value.inspectAutoRefreshSec <= 0) {
    return;
  }

  autoRefreshHandle = setInterval(() => {
    void loadAudit(false);
  }, settings.value.inspectAutoRefreshSec * 1000);
}

async function loadAudit(showLoading = true) {
  if (loading.value && !showLoading) {
    return;
  }

  loading.value = true;

  if (showLoading) {
    projection.value = createEmptyAuditTimelineProjection();
  }

  try {
    error.value = "";

    if (!routeRunId.value) {
      projection.value = createEmptyAuditTimelineProjection();
      error.value = copy("缺少 runId，无法打开审计页面。", "Missing runId, so audit page cannot be opened.");
      return;
    }

    projection.value = await getAuditTimelineProjection(routeRunId.value);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

watch(
  () => route.fullPath,
  () => {
    void loadAudit();
  },
  { immediate: true },
);

watch(
  () => [routeRunId.value, settings.value.inspectAutoRefreshSec] as const,
  () => {
    startAutoRefresh();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopAutoRefresh();
});
</script>

<template>
  <section class="workspace-page-stack audit-page">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ t("nav.inspect") }}</p>
        <h1>{{ copy("审计与复盘", "Audit and replay") }}</h1>
      </div>
      <p>
        {{
          copy(
            `Inspect 页聚焦 run ${routeRunId ?? "-"} 的审计时间线、复盘信号和 task/session 可追踪链路。`,
            `Inspect focuses on run ${routeRunId ?? "-"} audit timeline, replay signals, and task/session traceability.`,
          )
        }}
      </p>
    </div>

    <div class="audit-page__actions">
      <button
        class="icon-button audit-page__refresh"
        type="button"
        :disabled="loading"
        :aria-label="t('actions.refresh')"
        :title="t('actions.refresh')"
        @click="loadAudit(false)"
      >
        <svg
          class="audit-page__refresh-icon"
          :class="{ 'audit-page__refresh-icon--spinning': loading }"
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
      <RouterLink
        v-if="routeRunId"
        class="ghost-link audit-page__action-link"
        :to="getRunWorkspacePath(routeRunId)"
      >
        {{ t("actions.openWorkspace") }}
      </RouterLink>
    </div>

    <div v-if="error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ error }}</p>
    </div>

    <div v-else-if="!hasProjection" class="panel-card__empty-state">
      <p class="panel-card__body">
        {{
          loading
            ? copy("正在加载审计时间线。", "Loading audit timeline.")
            : copy("所选运行暂无审计数据。", "No audit data is available for the selected run.")
        }}
      </p>
    </div>

    <template v-else>
      <section class="status-bar workspace-hero audit-hero">
        <div class="audit-hero__top">
          <div>
            <p class="section-eyebrow">{{ copy("审计主线", "Audit spine") }}</p>
            <h2>{{ projection.runId }}</h2>
            <p class="workspace-hero__lead">
              {{
                copy(
                  "行按分类组织，可按需展开查看完整追踪详情。",
                  "Rows are grouped by category and each row can expand to show full trace details.",
                )
              }}
            </p>
          </div>
          <div class="audit-badges">
            <span class="status-pill" :data-status="runStatusPill(projection.summary.runStatus)">
              {{ runStatusLabel(projection.summary.runStatus) }}
            </span>
            <span class="flow-pill">run {{ projection.runId }}</span>
            <span class="flow-pill">graph {{ projection.graphRevision }}</span>
            <span class="flow-pill">{{ projection.generatedAt || "-" }}</span>
          </div>
        </div>

        <div class="workspace-summary-grid audit-summary-grid">
          <article v-for="card in summaryCards" :key="card[0]" class="summary-card">
            <span>{{ card[0] }}</span>
            <strong>{{ card[1] }}</strong>
          </article>
        </div>
      </section>

      <InspectTimelineGrid
        :projection="projection"
        :findings="findings"
        :copy="copy"
        :event-kind-label="eventKindLabel"
        :source-label="sourceLabel"
        :task-link="taskLink"
        :session-link="sessionLink"
        :approval-link="approvalLink"
      />

      <InspectSupportGrid
        :projection="projection"
        :copy="copy"
        :risk-label="riskLabel"
        :approval-state-label="approvalStateLabel"
        :approval-state-pill="approvalStatePill"
        :risk-tone="riskTone"
        :source-label="sourceLabel"
        :text-or-dash="textOrDash"
        :task-link="taskLink"
        :session-link="sessionLink"
        :approval-link="approvalLink"
      />
    </template>
  </section>
</template>
