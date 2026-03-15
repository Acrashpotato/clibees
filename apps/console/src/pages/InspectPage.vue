<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { getAuditTimelineProjection, listRuns } from "../api";
import {
  createEmptyAuditTimelineProjection,
  type AuditTimelineApprovalHistoryItemView,
  type AuditTimelineEntryKind,
  type AuditTimelineProjectionView,
  type AuditTimelineRunStatus,
} from "../audit-timeline-projection";
import { usePreferences } from "../composables/usePreferences";
import type { RunSummaryView } from "../types";
import {
  getSessionDetailPath,
  getTaskDetailPath,
  getWorkspacePath,
} from "../workspace";

const route = useRoute();
const { isZh, riskLabel, t } = usePreferences();
const runs = ref<RunSummaryView[]>([]);
const projection = ref<AuditTimelineProjectionView>(createEmptyAuditTimelineProjection());
const loading = ref(false);
const error = ref("");

const selectedRunId = computed(() =>
  typeof route.query.runId === "string" ? route.query.runId : runs.value[0]?.runId
);
const selectedRun = computed(() =>
  runs.value.find((run) => run.runId === selectedRunId.value)
);
const hasProjection = computed(
  () => Boolean(selectedRunId.value) && projection.value.runId === selectedRunId.value
);

const summaryCards = computed(() => [
  [copy("运行状态", "Run status"), runStatusLabel(projection.value.summary.runStatus)],
  [copy("审计事件", "Audit events"), String(projection.value.summary.totalEventCount)],
  [copy("审批事件", "Approval events"), String(projection.value.summary.approvalEventCount)],
  [copy("验证事件", "Validation events"), String(projection.value.summary.validationEventCount)],
  [copy("产物事件", "Artifact events"), String(projection.value.summary.artifactEventCount)],
  [copy("会话事件", "Session events"), String(projection.value.summary.sessionEventCount)],
  [copy("重规划", "Replans"), String(projection.value.summary.replanCount)],
  [copy("最近事件", "Latest event"), projection.value.summary.latestEventAt ?? copy("未记录", "Not recorded")],
]);

const findings = computed(() =>
  [
    [copy("最近失败", "Latest failure"), projection.value.summary.latestFailure],
    [copy("最近阻塞", "Latest blocker"), projection.value.summary.latestBlocker],
    [copy("最近验证", "Latest validation"), projection.value.summary.latestValidation],
    [copy("最近重规划", "Latest replan"), projection.value.summary.latestReplan],
  ].filter((item): item is [string, string] => Boolean(item[1]))
);

function copy(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

async function loadRuns() {
  runs.value = await listRuns();
}

function runStatusLabel(status: AuditTimelineRunStatus): string {
  switch (status) {
    case "created":
      return copy("已创建", "Created");
    case "planning":
      return copy("规划中", "Planning");
    case "ready":
      return copy("就绪", "Ready");
    case "running":
      return copy("运行中", "Running");
    case "waiting_approval":
      return copy("待审批", "Waiting approval");
    case "replanning":
      return copy("重规划中", "Replanning");
    case "paused":
      return copy("已暂停", "Paused");
    case "completed":
      return copy("已完成", "Completed");
    case "failed":
      return copy("失败", "Failed");
    case "cancelled":
      return copy("已取消", "Cancelled");
  }
}

function runStatusPill(status: AuditTimelineRunStatus): "running" | "awaiting_approval" | "paused" | "completed" | "failed" {
  switch (status) {
    case "running":
    case "planning":
    case "replanning":
      return "running";
    case "waiting_approval":
      return "awaiting_approval";
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      return "paused";
  }
}

function eventKindLabel(kind: AuditTimelineEntryKind): string {
  switch (kind) {
    case "lifecycle":
      return copy("生命周期", "Lifecycle");
    case "session":
      return copy("会话", "Session");
    case "approval":
      return copy("审批", "Approval");
    case "validation":
      return copy("验证", "Validation");
    case "artifact":
      return copy("产物", "Artifact");
    case "replan":
      return copy("重规划", "Replan");
  }
}

function approvalStateLabel(state: AuditTimelineApprovalHistoryItemView["state"]): string {
  switch (state) {
    case "pending":
      return copy("待决", "Pending");
    case "approved":
      return copy("已批准", "Approved");
    case "rejected":
      return copy("已拒绝", "Rejected");
  }
}

function approvalStatePill(state: AuditTimelineApprovalHistoryItemView["state"]): "awaiting_approval" | "completed" | "failed" {
  switch (state) {
    case "pending":
      return "awaiting_approval";
    case "approved":
      return "completed";
    case "rejected":
      return "failed";
  }
}

function riskTone(riskLevel: AuditTimelineApprovalHistoryItemView["riskLevel"]): "low" | "medium" | "high" {
  return riskLevel === "none" ? "low" : riskLevel;
}

function sourceLabel(sourceMode: string): string {
  switch (sourceMode) {
    case "run_event":
      return copy("运行事件", "Run event");
    case "approval_artifact":
      return copy("审批快照", "Approval artifact");
    case "inspection_approval":
      return copy("检查回填", "Inspection fallback");
    case "validation_record":
      return copy("验证记录", "Validation record");
    case "task_status_backfill":
      return copy("状态回填", "Status backfill");
    case "artifact_record":
      return copy("产物记录", "Artifact record");
    case "run_event_backfill":
      return copy("事件回填", "Event backfill");
    default:
      return sourceMode.replaceAll("_", " ");
  }
}

function taskLink(taskId?: string): string | undefined {
  return selectedRunId.value && taskId ? getTaskDetailPath(selectedRunId.value, taskId) : undefined;
}

function sessionLink(sessionId?: string): string | undefined {
  return selectedRunId.value && sessionId ? getSessionDetailPath(selectedRunId.value, sessionId) : undefined;
}

function approvalLink(requestId?: string): string | undefined {
  return selectedRunId.value && requestId
    ? `/approvals?runId=${encodeURIComponent(selectedRunId.value)}&requestId=${encodeURIComponent(requestId)}`
    : undefined;
}

async function loadAudit(showLoading = true) {
  loading.value = true;

  if (showLoading) {
    projection.value = createEmptyAuditTimelineProjection();
  }

  try {
    error.value = "";
    await loadRuns();

    if (!selectedRunId.value) {
      projection.value = createEmptyAuditTimelineProjection();
      return;
    }

    projection.value = await getAuditTimelineProjection(selectedRunId.value);
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
</script><template>
  <section class="workspace-page-stack audit-page">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ t("nav.inspect") }}</p>
        <h1>{{ copy("审计与复盘", "Audit and replay") }}</h1>
      </div>
      <p>
        {{ copy("Inspect 页现在只承载审计时间线、复盘信号和 task/session 追溯。控制动作和焦点态仍留在 Workspace。", "The Inspect page now carries only the audit timeline, replay signals, and task/session traceability. Control actions and focus state stay in Workspace.") }}
      </p>
    </div>

    <div class="section-actions approvals-page__actions">
      <button class="ghost-button" type="button" :disabled="loading" @click="loadAudit(false)">{{ t("actions.refresh") }}</button>
      <RouterLink v-if="selectedRunId" class="ghost-link" :to="getWorkspacePath('overview', selectedRunId)">{{ t("actions.openWorkspace") }}</RouterLink>
    </div>

    <div v-if="runs.length > 0" class="audit-run-selector">
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

    <div v-else-if="!hasProjection" class="panel-card__empty-state">
      <p class="panel-card__body">
        {{ loading ? copy("正在加载审计时间线。", "Loading audit timeline.") : copy("当前没有可查看的审计数据。", "No audit data is available for the selected run.") }}
      </p>
    </div>

    <template v-else>
      <section class="status-bar workspace-hero audit-hero">
        <div class="audit-hero__top">
          <div>
            <p class="section-eyebrow">{{ copy("审计主线", "Audit spine") }}</p>
            <h2>{{ selectedRun?.goal ?? projection.runId }}</h2>
            <p class="workspace-hero__lead">{{ copy("所有条目都直接指向 task、session、approval 或 artifact 标识，便于从复盘视图追回真实执行实体。", "Every entry points back to task, session, approval, or artifact identifiers so the replay view can trace back to real execution entities.") }}</p>
          </div>
          <div class="audit-badges">
            <span class="status-pill" :data-status="runStatusPill(projection.summary.runStatus)">{{ runStatusLabel(projection.summary.runStatus) }}</span>
            <span class="flow-pill">run {{ projection.runId }}</span>
            <span class="flow-pill">graph {{ projection.graphRevision }}</span>
            <span class="flow-pill">{{ projection.generatedAt || selectedRun?.updatedAt || "-" }}</span>
          </div>
        </div>

        <div class="workspace-summary-grid audit-summary-grid">
          <article v-for="card in summaryCards" :key="card[0]" class="summary-card">
            <span>{{ card[0] }}</span>
            <strong>{{ card[1] }}</strong>
          </article>
        </div>
      </section>

      <section class="audit-grid">
        <article class="panel-card audit-card audit-card--timeline">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ copy("统一时间线", "Unified timeline") }}</p>
              <h2>{{ copy("审计事件回放", "Audit event replay") }}</h2>
            </div>
            <span class="panel-chip">{{ projection.entries.length }}</span>
          </div>

          <div v-if="projection.entries.length > 0" class="audit-stack">
            <article v-for="entry in projection.entries" :key="entry.eventId" class="handoff-card handoff-card--flow audit-item">
              <div class="audit-row">
                <div>
                  <span class="approval-card__lane">{{ eventKindLabel(entry.kind) }}</span>
                  <strong>{{ entry.title }}</strong>
                </div>
                <span class="flow-pill">{{ entry.timestamp }}</span>
              </div>

              <div class="audit-links">
                <RouterLink v-if="taskLink(entry.taskId)" class="flow-pill" :to="taskLink(entry.taskId)!">task {{ entry.taskId }}</RouterLink>
                <RouterLink v-if="sessionLink(entry.sessionId)" class="flow-pill" :to="sessionLink(entry.sessionId)!">session {{ entry.sessionId }}</RouterLink>
                <RouterLink v-if="approvalLink(entry.approvalRequestId)" class="flow-pill" :to="approvalLink(entry.approvalRequestId)!">approval {{ entry.approvalRequestId }}</RouterLink>
                <span v-if="entry.artifactId" class="flow-pill">artifact {{ entry.artifactId }}</span>
                <span class="flow-pill">{{ sourceLabel(entry.sourceMode) }}</span>
              </div>

              <p v-for="detail in entry.details" :key="detail" class="panel-card__body">{{ detail }}</p>
            </article>
          </div>
          <div v-else class="panel-card__empty-state">
            <p class="panel-card__body">{{ copy("当前运行还没有可回放的审计事件。", "This run has no audit events to replay yet.") }}</p>
          </div>
        </article>

        <article class="panel-card audit-card">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ copy("复盘锚点", "Replay anchors") }}</p>
              <h2>{{ copy("关键审计信号", "Key audit signals") }}</h2>
            </div>
          </div>

          <div v-if="findings.length > 0" class="audit-stack">
            <article v-for="finding in findings" :key="finding[0]" class="detail-chip detail-chip--compact detail-chip--row">
              <span>{{ finding[0] }}</span>
              <strong>{{ finding[1] }}</strong>
            </article>
          </div>
          <div v-else class="panel-card__empty-state">
            <p class="panel-card__body">{{ copy("当前没有失败、阻塞、重规划或最近验证摘要。", "No failure, blocker, replan, or recent validation summary is recorded yet.") }}</p>
          </div>

          <div class="audit-subsection">
            <div class="panel-card__header">
              <div>
                <p class="section-eyebrow">{{ copy("会话事件", "Session events") }}</p>
                <h2>{{ copy("关键执行窗口", "Key execution windows") }}</h2>
              </div>
              <span class="panel-chip">{{ projection.sessionEvents.length }}</span>
            </div>

            <div v-if="projection.sessionEvents.length > 0" class="audit-stack">
              <article v-for="event in projection.sessionEvents.slice(0, 6)" :key="event.eventId" class="approval-card audit-item">
                <div class="audit-row">
                  <div>
                    <span class="approval-card__lane">{{ event.type }}</span>
                    <strong>{{ event.title }}</strong>
                  </div>
                  <span class="flow-pill">{{ event.timestamp }}</span>
                </div>
                <p>{{ event.summary }}</p>
                <div class="audit-links">
                  <RouterLink class="flow-pill" :to="getTaskDetailPath(projection.runId, event.taskId)">task {{ event.taskId }}</RouterLink>
                  <RouterLink class="flow-pill" :to="getSessionDetailPath(projection.runId, event.sessionId)">session {{ event.sessionId }}</RouterLink>
                  <span class="flow-pill">{{ sourceLabel(event.sourceMode) }}</span>
                </div>
              </article>
            </div>
            <div v-else class="panel-card__empty-state">
              <p class="panel-card__body">{{ copy("当前没有可追溯的关键会话事件。", "No traceable key session events are available yet.") }}</p>
            </div>
          </div>
        </article>
      </section>      <section class="audit-grid audit-grid--support">
        <article class="panel-card audit-card">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ copy("审批历史", "Approval history") }}</p>
              <h2>{{ copy("审批请求与决策回放", "Approval requests and decisions") }}</h2>
            </div>
            <span class="panel-chip">{{ projection.approvals.length }}</span>
          </div>

          <div v-if="projection.approvals.length > 0" class="audit-stack">
            <article v-for="approval in projection.approvals" :key="approval.requestId" class="approval-card audit-item" :data-risk="riskTone(approval.riskLevel)">
              <div class="audit-row">
                <div>
                  <span class="approval-card__lane">{{ approval.requestId }}</span>
                  <strong>{{ approval.taskTitle }}</strong>
                </div>
                <div class="audit-links">
                  <span class="status-pill" :data-status="approvalStatePill(approval.state)">{{ approvalStateLabel(approval.state) }}</span>
                  <span class="risk-pill" :data-risk="riskTone(approval.riskLevel)">{{ approval.riskLevel === "none" ? copy("无", "None") : riskLabel(approval.riskLevel) }}</span>
                </div>
              </div>
              <p>{{ approval.summary }}</p>
              <div class="audit-links">
                <RouterLink v-if="approvalLink(approval.requestId)" class="flow-pill" :to="approvalLink(approval.requestId)!">approval {{ approval.requestId }}</RouterLink>
                <RouterLink v-if="taskLink(approval.taskId)" class="flow-pill" :to="taskLink(approval.taskId)!">task {{ approval.taskId }}</RouterLink>
                <RouterLink v-if="sessionLink(approval.sessionId)" class="flow-pill" :to="sessionLink(approval.sessionId)!">session {{ approval.sessionId }}</RouterLink>
                <span class="flow-pill">{{ sourceLabel(approval.sourceMode) }}</span>
              </div>
              <p class="panel-card__body">{{ copy("请求时间", "Requested") }}: {{ approval.requestedAt }}</p>
              <p class="panel-card__body" v-if="approval.decidedAt">{{ copy("决策时间", "Decided") }}: {{ approval.decidedAt }}</p>
            </article>
          </div>
          <div v-else class="panel-card__empty-state">
            <p class="panel-card__body">{{ copy("当前没有审批历史。", "No approval history is available for this run.") }}</p>
          </div>
        </article>

        <article class="panel-card audit-card">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ copy("验证记录", "Validation records") }}</p>
              <h2>{{ copy("任务验证与结果", "Task validation and outcomes") }}</h2>
            </div>
            <span class="panel-chip">{{ projection.validations.length }}</span>
          </div>

          <div v-if="projection.validations.length > 0" class="audit-stack">
            <article v-for="validation in projection.validations" :key="validation.taskId" class="approval-card audit-item">
              <div class="audit-row">
                <div>
                  <span class="approval-card__lane">{{ validation.taskId }}</span>
                  <strong>{{ validation.taskTitle }}</strong>
                </div>
                <span class="flow-pill">{{ validation.outcome ?? validation.taskStatus }}</span>
              </div>
              <p>{{ validation.summary }}</p>
              <div class="audit-links">
                <RouterLink v-if="taskLink(validation.taskId)" class="flow-pill" :to="taskLink(validation.taskId)!">task {{ validation.taskId }}</RouterLink>
                <RouterLink v-if="sessionLink(validation.sessionId)" class="flow-pill" :to="sessionLink(validation.sessionId)!">session {{ validation.sessionId }}</RouterLink>
                <span class="flow-pill">{{ sourceLabel(validation.sourceMode) }}</span>
              </div>
              <p v-for="detail in validation.details" :key="detail" class="panel-card__body">{{ detail }}</p>
            </article>
          </div>
          <div v-else class="panel-card__empty-state">
            <p class="panel-card__body">{{ copy("当前没有验证记录。", "No validation records are available yet.") }}</p>
          </div>
        </article>

        <article class="panel-card audit-card">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ copy("重规划记录", "Replans") }}</p>
              <h2>{{ copy("范围变化与后续处理", "Scope changes and follow-up") }}</h2>
            </div>
            <span class="panel-chip">{{ projection.replans.length }}</span>
          </div>

          <div v-if="projection.replans.length > 0" class="audit-stack">
            <article v-for="replan in projection.replans" :key="replan.eventId" class="approval-card audit-item">
              <div class="audit-row">
                <div>
                  <span class="approval-card__lane">{{ replan.type }}</span>
                  <strong>{{ replan.title }}</strong>
                </div>
                <span class="flow-pill">{{ replan.timestamp }}</span>
              </div>
              <div class="audit-links">
                <RouterLink v-if="taskLink(replan.taskId)" class="flow-pill" :to="taskLink(replan.taskId)!">task {{ replan.taskId }}</RouterLink>
                <span class="flow-pill">{{ sourceLabel(replan.sourceMode) }}</span>
              </div>
              <p v-for="detail in replan.details" :key="detail" class="panel-card__body">{{ detail }}</p>
            </article>
          </div>
          <div v-else class="panel-card__empty-state">
            <p class="panel-card__body">{{ copy("当前没有重规划记录。", "No replans are recorded for this run.") }}</p>
          </div>
        </article>

        <article class="panel-card audit-card">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ copy("产物摘要", "Artifact summary") }}</p>
              <h2>{{ copy("按 task 汇总产物高亮", "Artifact highlights grouped by task") }}</h2>
            </div>
            <span class="panel-chip">{{ projection.artifacts.length }}</span>
          </div>

          <div v-if="projection.artifacts.length > 0" class="audit-stack">
            <article v-for="group in projection.artifacts" :key="group.taskId ?? group.taskTitle" class="approval-card audit-item">
              <div class="audit-row">
                <div>
                  <span class="approval-card__lane">{{ group.taskId ?? copy("运行级", "Run level") }}</span>
                  <strong>{{ group.taskTitle }}</strong>
                </div>
                <span class="flow-pill">{{ group.totalCount }}</span>
              </div>
              <div class="audit-links">
                <RouterLink v-if="taskLink(group.taskId)" class="flow-pill" :to="taskLink(group.taskId)!">task {{ group.taskId }}</RouterLink>
                <span class="flow-pill">{{ group.artifactKinds.join(", ") || copy("无类型", "No kinds") }}</span>
              </div>
              <article v-for="artifact in group.highlights" :key="artifact.artifactId" class="detail-chip detail-chip--compact detail-chip--row">
                <span>{{ artifact.kind }} · {{ artifact.createdAt }}</span>
                <strong>{{ artifact.summary }}</strong>
                <RouterLink v-if="sessionLink(artifact.sessionId)" class="ghost-link" :to="sessionLink(artifact.sessionId)!">session {{ artifact.sessionId }}</RouterLink>
              </article>
            </article>
          </div>
          <div v-else class="panel-card__empty-state">
            <p class="panel-card__body">{{ copy("当前没有可展示的产物摘要。", "No artifact summary is available yet.") }}</p>
          </div>
        </article>
      </section>
    </template>
  </section>
</template>

<style scoped>
.audit-page,
.audit-hero,
.audit-card,
.audit-stack,
.audit-subsection {
  display: grid;
  gap: 16px;
}

.audit-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.7fr);
  gap: 18px;
  align-items: start;
}

.audit-grid--support {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.audit-card--timeline {
  min-width: 0;
}

.audit-row,
.audit-hero__top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}

.audit-links,
.audit-run-selector,
.audit-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.audit-item {
  display: grid;
  gap: 10px;
}

.audit-summary-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

@media (max-width: 1240px) {
  .audit-grid,
  .audit-grid--support,
  .audit-summary-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .audit-row,
  .audit-hero__top {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>