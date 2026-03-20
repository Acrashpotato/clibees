<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { getAuditTimelineProjection } from "../api";
import {
  createEmptyAuditTimelineProjection,
  type AuditTimelineApprovalHistoryItemView,
  type AuditTimelineEntryKind,
  type AuditTimelineEntryView,
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
  getSessionDetailPath,
  getTaskDetailPath,
} from "../workspace";

type InspectSupportTab = "approvals" | "validations" | "replans" | "artifacts";
type TimelineWindow = number | "all";

const TIMELINE_STEP = 100;
const DEFAULT_TIMELINE_WINDOW = 100;

const route = useRoute();
const router = useRouter();
const { riskLabel, t } = usePreferences();
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

const coreSummaryCards = computed(() => [
  ["运行状态", runStatusLabel(projection.value.summary.runStatus)],
  ["审计事件", String(projection.value.summary.totalEventCount)],
  [
    "最近事件",
    projection.value.summary.latestEventAt ?? "未记录",
  ],
  ["重规划", String(projection.value.summary.replanCount)],
]);

const moreSummaryCards = computed(() => [
  ["审批事件", String(projection.value.summary.approvalEventCount)],
  ["验证事件", String(projection.value.summary.validationEventCount)],
  ["产物事件", String(projection.value.summary.artifactEventCount)],
  ["会话事件", String(projection.value.summary.sessionEventCount)],
]);

const findings = computed(() =>
  [
    ["最近失败", projection.value.summary.latestFailure],
    ["最近阻塞", projection.value.summary.latestBlocker],
    ["最近验证", projection.value.summary.latestValidation],
    ["最近重规划", projection.value.summary.latestReplan],
  ].filter((item): item is [string, string] => Boolean(item[1])),
);

const defaultSupportTab = computed<InspectSupportTab>(() => {
  if (projection.value.approvals.length > 0) {
    return "approvals";
  }
  if (projection.value.validations.length > 0) {
    return "validations";
  }
  if (projection.value.replans.length > 0) {
    return "replans";
  }
  if (projection.value.artifacts.length > 0) {
    return "artifacts";
  }
  return "approvals";
});

const supportFromQuery = computed(() => parseSupportQuery(route.query.support));
const activeSupportTab = computed<InspectSupportTab>(
  () => supportFromQuery.value ?? defaultSupportTab.value,
);

const timelineWindowFromQuery = computed(() => parseTimelineQuery(route.query.timeline));
const activeTimelineWindow = computed<TimelineWindow>(
  () => timelineWindowFromQuery.value ?? DEFAULT_TIMELINE_WINDOW,
);

const visibleTimelineEntries = computed<AuditTimelineEntryView[]>(() => {
  if (activeTimelineWindow.value === "all") {
    return projection.value.entries;
  }
  return projection.value.entries.slice(0, activeTimelineWindow.value);
});

const hasMoreTimelineEntries = computed(() => {
  if (activeTimelineWindow.value === "all") {
    return false;
  }
  return projection.value.entries.length > visibleTimelineEntries.value.length;
});

const visibleTimelineSummary = computed(() =>
  `已显示 ${visibleTimelineEntries.value.length} / ${projection.value.entries.length} 条事件`,
);


function textOrDash(value?: string): string {
  return value && value.trim().length > 0 ? value : "-";
}

function runStatusLabel(status: AuditTimelineProjectionView["summary"]["runStatus"]): string {
  return formatRunStatusLabel(status);
}

function runStatusPill(
  status: AuditTimelineProjectionView["summary"]["runStatus"],
): "running" | "awaiting_approval" | "paused" | "completed" | "failed" {
  return formatRunStatusPill(status);
}

function eventKindLabel(kind: AuditTimelineEntryKind): string {
  return formatEventKindLabel(kind);
}

function approvalStateLabel(
  state: AuditTimelineApprovalHistoryItemView["state"],
): string {
  return formatApprovalStateLabel(state);
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
  return formatSourceLabel(sourceMode);
}

function parseSupportQuery(queryValue: unknown): InspectSupportTab | undefined {
  if (typeof queryValue !== "string") {
    return undefined;
  }
  if (
    queryValue === "approvals" ||
    queryValue === "validations" ||
    queryValue === "replans" ||
    queryValue === "artifacts"
  ) {
    return queryValue;
  }
  return undefined;
}

function parseTimelineQuery(queryValue: unknown): TimelineWindow | undefined {
  if (typeof queryValue !== "string") {
    return undefined;
  }
  if (queryValue === "all") {
    return "all";
  }
  const parsed = Number(queryValue);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed % TIMELINE_STEP !== 0) {
    return undefined;
  }
  return parsed;
}

function setSupportQuery(nextTab: InspectSupportTab): void {
  void router.replace({
    query: {
      ...route.query,
      support: nextTab,
    },
  });
}

function setTimelineQuery(nextWindow: TimelineWindow): void {
  void router.replace({
    query: {
      ...route.query,
      timeline: String(nextWindow),
    },
  });
}

function normalizeInspectQuery(): void {
  const rawSupport = route.query.support;
  const rawTimeline = route.query.timeline;
  const hasSupportQuery = rawSupport !== undefined;
  const hasTimelineQuery = rawTimeline !== undefined;
  const parsedSupport = parseSupportQuery(rawSupport);
  const parsedTimeline = parseTimelineQuery(rawTimeline);
  const normalizeSupport = hasSupportQuery && !parsedSupport && (hasProjection.value || !routeRunId.value);
  const normalizeTimeline = hasTimelineQuery && !parsedTimeline;

  if (!normalizeSupport && !normalizeTimeline) {
    return;
  }

  void router.replace({
    query: {
      ...route.query,
      ...(normalizeSupport
        ? { support: defaultSupportTab.value }
        : {}),
      ...(normalizeTimeline
        ? { timeline: String(DEFAULT_TIMELINE_WINDOW) }
        : {}),
    },
  });
}

function changeSupportTab(nextTab: InspectSupportTab): void {
  setSupportQuery(nextTab);
}

function loadMoreTimelineEntries(): void {
  if (activeTimelineWindow.value === "all") {
    return;
  }
  setTimelineQuery(activeTimelineWindow.value + TIMELINE_STEP);
}

function resetTimelineWindow(): void {
  setTimelineQuery(DEFAULT_TIMELINE_WINDOW);
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
      error.value = "缺少 runId，无法打开审计页面。";
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
  () => routeRunId.value,
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

watch(
  () => [route.query.support, route.query.timeline, defaultSupportTab.value, hasProjection.value] as const,
  () => {
    normalizeInspectQuery();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopAutoRefresh();
});
</script>

<template>
  <section class="workspace-page-stack audit-page">
    <div class="workspace-page-header audit-page__header">
      <div>
        <p class="section-eyebrow">{{ t("nav.inspect") }}</p>
        <h1>{{ "审计与复盘" }}</h1>
        <p class="audit-page__description">
          {{
            `Inspect 页聚焦 run ${routeRunId ?? "-"} 的审计时间线、复盘信号和 task/session 可追踪链路。`
          }}
        </p>
      </div>
      <div class="audit-page__header-actions">
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
      </div>
    </div>

    <div v-if="error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ error }}</p>
    </div>

    <div v-else-if="!hasProjection" class="panel-card__empty-state">
      <p class="panel-card__body">
        {{
          loading
            ? "正在加载审计时间线。"
            : "所选运行暂无审计数据。"
        }}
      </p>
    </div>

    <template v-else>
      <section class="status-bar workspace-hero audit-hero">
        <div class="audit-hero__top">
          <div>
            <p class="section-eyebrow">{{ "审计主线" }}</p>
            <h2>{{ projection.runId }}</h2>
            <p class="workspace-hero__lead">
              {{
                "行按分类组织，可按需展开查看完整追踪详情。"
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
          <article v-for="card in coreSummaryCards" :key="card[0]" class="summary-card">
            <span>{{ card[0] }}</span>
            <strong>{{ card[1] }}</strong>
          </article>
        </div>

        <details class="audit-hero__more">
          <summary>{{ "更多指标" }}</summary>
          <div class="workspace-summary-grid audit-summary-grid audit-summary-grid--more">
            <article v-for="card in moreSummaryCards" :key="card[0]" class="summary-card">
              <span>{{ card[0] }}</span>
              <strong>{{ card[1] }}</strong>
            </article>
          </div>
        </details>
      </section>

      <InspectTimelineGrid
        :entries="visibleTimelineEntries"
        :session-events="projection.sessionEvents"
        :total-entry-count="projection.entries.length"
        :timeline-window="activeTimelineWindow"
        :timeline-step="TIMELINE_STEP"
        :has-more-timeline-entries="hasMoreTimelineEntries"
        :visible-timeline-summary="visibleTimelineSummary"
        :findings="findings"
        :event-kind-label="eventKindLabel"
        :source-label="sourceLabel"
        :task-link="taskLink"
        :session-link="sessionLink"
        :approval-link="approvalLink"
        @load-more="loadMoreTimelineEntries"
        @reset-window="resetTimelineWindow"
      />

      <InspectSupportGrid
        :projection="projection"
        :active-support-tab="activeSupportTab"
        :risk-label="riskLabel"
        :approval-state-label="approvalStateLabel"
        :approval-state-pill="approvalStatePill"
        :risk-tone="riskTone"
        :source-label="sourceLabel"
        :text-or-dash="textOrDash"
        :task-link="taskLink"
        :session-link="sessionLink"
        :approval-link="approvalLink"
        @change-support="changeSupportTab"
      />
    </template>
  </section>
</template>
