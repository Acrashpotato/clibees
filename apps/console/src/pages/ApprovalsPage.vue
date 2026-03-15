<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { approveRequest, getApprovalQueueProjection, rejectRequest } from "../api";
import {
  createEmptyApprovalQueueProjection,
  type ApprovalQueueActionPlanSnapshotView,
  type ApprovalQueueItemDetailView,
  type ApprovalQueueProjectionView,
} from "../approval-projection";
import { usePreferences } from "../composables/usePreferences";
import { getSessionDetailPath, getTaskDetailPath, getWorkspacePath } from "../workspace";

const route = useRoute();
const { isZh, riskLabel, t } = usePreferences();
const projection = ref<ApprovalQueueProjectionView>(createEmptyApprovalQueueProjection());
const loading = ref(false);
const error = ref("");
const actingId = ref("");
const notes = ref<Record<string, string>>({});

const activeId = computed(() => (typeof route.query.requestId === "string" ? route.query.requestId : undefined));
const scopedRunId = computed(() => (typeof route.query.runId === "string" ? route.query.runId : undefined));
const approvals = computed(() => projection.value.items);
const summaryCards = computed(() => [
  {
    id: "scope",
    label: copy("当前范围", "Scope"),
    value: scopedRunId.value ?? copy("全部运行", "All runs"),
  },
  {
    id: "pending",
    label: copy("待决", "Pending"),
    value: String(projection.value.summary.pendingCount),
  },
  {
    id: "approved",
    label: copy("已批准", "Approved"),
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

function decisionStateLabel(state: ApprovalQueueItemDetailView["state"]): string {
  switch (state) {
    case "pending":
      return copy("待决", "Pending");
    case "approved":
      return copy("已批准", "Approved");
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

function displayRiskLevel(riskLevel: ApprovalQueueItemDetailView["riskLevel"]): "low" | "medium" | "high" {
  return riskLevel === "none" ? "low" : riskLevel;
}

function riskLevelLabel(riskLevel: ApprovalQueueItemDetailView["riskLevel"]): string {
  return riskLevel === "none" ? copy("无", "None") : riskLabel(riskLevel);
}

function approvalSourceLabel(sourceMode: ApprovalQueueItemDetailView["sourceMode"]): string {
  switch (sourceMode) {
    case "approval_artifact":
      return copy("审批快照产物", "Approval artifact snapshot");
    default:
      return copy("检查聚合回填", "Inspection fallback");
  }
}

function sessionSourceLabel(sourceMode: NonNullable<ApprovalQueueItemDetailView["session"]>["sourceMode"]): string {
  switch (sourceMode) {
    case "run_event_backfill":
      return copy("事件窗口回填", "Event window backfill");
    default:
      return copy("任务状态回填", "Task status backfill");
  }
}

function actorLabel(approval: ApprovalQueueItemDetailView): string {
  if (approval.actor) {
    return approval.actor;
  }

  return approval.state === "pending"
    ? copy("待决", "Pending")
    : copy("未记录", "Not recorded");
}

function noteLabel(approval: ApprovalQueueItemDetailView): string {
  if (approval.note) {
    return approval.note;
  }

  return approval.state === "pending"
    ? copy("未填写", "None yet")
    : copy("无", "None");
}

function formatCommand(actionPlan: ApprovalQueueActionPlanSnapshotView): string | undefined {
  if (!actionPlan.command) {
    return undefined;
  }

  return [actionPlan.command, ...actionPlan.args].join(" ");
}

function taskLink(approval: ApprovalQueueItemDetailView): string | undefined {
  return approval.taskId ? getTaskDetailPath(approval.runId, approval.taskId) : undefined;
}

function sessionLink(approval: ApprovalQueueItemDetailView): string | undefined {
  return approval.session ? getSessionDetailPath(approval.runId, approval.session.sessionId) : undefined;
}

async function loadProjection(showLoading = true) {
  if (showLoading) {
    loading.value = true;
  }

  try {
    error.value = "";
    projection.value = await getApprovalQueueProjection({
      ...(scopedRunId.value ? { runId: scopedRunId.value } : {}),
      limit: 100,
    });
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
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

watch(
  () => scopedRunId.value ?? "",
  () => {
    void loadProjection();
  },
  { immediate: true },
);
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
          scopedRunId
            ? copy(
              `当前仅查看 run ${scopedRunId} 的审批请求、所属 task/session 与 actionPlans 快照。`,
              `Reviewing only the approval requests, task/session binding, and action plan snapshots for run ${scopedRunId}.`,
            )
            : copy(
              "这里聚合所有审批请求，包含所属 task/session、决策结果、审批人、备注和 actionPlans 快照明细。",
              "This queue aggregates every approval request together with task/session ownership, decisions, actors, notes, and action plan snapshots.",
            )
        }}
      </p>
    </div>

    <div class="section-actions approvals-page__actions">
      <button class="ghost-button" type="button" :disabled="loading" @click="loadProjection(false)">
        {{ t("actions.refresh") }}
      </button>
      <RouterLink v-if="scopedRunId" class="ghost-link" :to="getWorkspacePath('overview', scopedRunId)">
        {{ t("actions.openWorkspace") }}
      </RouterLink>
      <RouterLink v-if="scopedRunId" class="ghost-link" to="/approvals">
        {{ copy("查看全部审批", "View all approvals") }}
      </RouterLink>
    </div>

    <div v-if="error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ error }}</p>
    </div>

    <section class="status-bar workspace-hero approvals-hero">
      <div class="approvals-hero__header">
        <div>
          <p class="section-eyebrow">{{ copy("审批摘要", "Approval summary") }}</p>
          <h2>{{ copy("按审批事实统一归约", "Normalized from approval facts") }}</h2>
        </div>
        <span class="panel-chip">{{ projection.summary.totalCount }}</span>
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

    <section v-else-if="approvals.length > 0" class="approvals-board approvals-page__board">
      <article
        v-for="approval in approvals"
        :key="approval.requestId"
        class="approval-card approval-card--decision approvals-page__card"
        :class="{ 'approval-card--active': approval.requestId === activeId }"
        :data-risk="displayRiskLevel(approval.riskLevel)"
      >
        <div class="approvals-page__card-top">
          <div>
            <span class="approval-card__lane">{{ approval.requestId }}</span>
            <h2>{{ approval.taskTitle }}</h2>
          </div>
          <div class="approvals-page__badge-row">
            <span class="status-pill" :data-status="decisionStatePill(approval.state)">
              {{ decisionStateLabel(approval.state) }}
            </span>
            <span class="risk-pill" :data-risk="displayRiskLevel(approval.riskLevel)">
              {{ riskLevelLabel(approval.riskLevel) }}
            </span>
          </div>
        </div>

        <div class="approvals-page__identity-row">
          <span class="flow-pill">run {{ approval.runId }}</span>
          <span class="flow-pill">task {{ approval.taskId ?? copy("未挂载", "unbound") }}</span>
          <span class="flow-pill">
            session {{ approval.session?.sessionId ?? copy("未回填", "unbound") }}
          </span>
        </div>

        <p class="approvals-page__summary">{{ approval.summary }}</p>

        <div class="approvals-page__meta-grid">
          <div class="detail-chip detail-chip--compact">
            <span>{{ copy("请求时间", "Requested") }}</span>
            <strong>{{ approval.requestedAt }}</strong>
          </div>
          <div class="detail-chip detail-chip--compact">
            <span>{{ copy("决策时间", "Decided") }}</span>
            <strong>{{ approval.decidedAt ?? copy("未决", "Pending") }}</strong>
          </div>
          <div class="detail-chip detail-chip--compact">
            <span>{{ copy("审批人", "Actor") }}</span>
            <strong>{{ actorLabel(approval) }}</strong>
          </div>
          <div class="detail-chip detail-chip--compact">
            <span>{{ copy("备注", "Note") }}</span>
            <strong>{{ noteLabel(approval) }}</strong>
          </div>
          <div class="detail-chip detail-chip--compact">
            <span>{{ copy("审批来源", "Approval source") }}</span>
            <strong>{{ approvalSourceLabel(approval.sourceMode) }}</strong>
          </div>
          <div class="detail-chip detail-chip--compact">
            <span>{{ copy("会话绑定", "Session binding") }}</span>
            <strong>
              {{
                approval.session
                  ? `${approval.session.label} · ${sessionSourceLabel(approval.session.sourceMode)}`
                  : copy("当前未能稳定回填 session", "Session binding is not backfilled yet")
              }}
            </strong>
          </div>
        </div>

        <section class="approvals-page__plans">
          <div class="panel-card__header approvals-page__plans-header">
            <div>
              <p class="section-eyebrow">{{ copy("动作快照", "Action snapshots") }}</p>
              <h2>{{ copy("actionPlans 明细", "Action plan details") }}</h2>
            </div>
            <span class="panel-chip">{{ approval.actionPlanCount }}</span>
          </div>

          <div v-if="approval.actionPlans.length > 0" class="approvals-page__plan-list">
            <article
              v-for="actionPlan in approval.actionPlans"
              :key="actionPlan.actionPlanId"
              class="approval-card approvals-page__plan-card"
              :data-risk="actionPlan.riskLevel"
            >
              <div class="approvals-page__plan-top">
                <div>
                  <span class="approval-card__lane">{{ actionPlan.kind }}</span>
                  <strong>{{ actionPlan.reason }}</strong>
                </div>
                <div class="approvals-page__badge-row">
                  <span class="flow-pill">
                    {{ actionPlan.requiresApproval ? copy("需审批", "Requires approval") : copy("自动执行", "Auto") }}
                  </span>
                  <span class="risk-pill" :data-risk="actionPlan.riskLevel">{{ riskLabel(actionPlan.riskLevel) }}</span>
                </div>
              </div>

              <pre v-if="formatCommand(actionPlan)" class="approvals-page__command">{{ formatCommand(actionPlan) }}</pre>

              <div class="approvals-page__meta-grid approvals-page__meta-grid--plans">
                <div class="detail-chip detail-chip--compact">
                  <span>ID</span>
                  <strong>{{ actionPlan.actionPlanId }}</strong>
                </div>
                <div class="detail-chip detail-chip--compact">
                  <span>cwd</span>
                  <strong>{{ actionPlan.cwd ?? "-" }}</strong>
                </div>
                <div class="detail-chip detail-chip--compact approvals-page__meta-grid-item--wide">
                  <span>{{ copy("目标", "Targets") }}</span>
                  <strong>{{ actionPlan.targets.length > 0 ? actionPlan.targets.join(", ") : "-" }}</strong>
                </div>
              </div>
            </article>
          </div>
          <div v-else class="panel-card__empty-state">
            <p class="panel-card__body">
              {{
                copy(
                  "当前审批没有持久化的 actionPlans 快照，页面不再退化成只有 summary 的待办卡片。",
                  "This approval has no persisted action plan snapshot, and the page no longer falls back to a summary-only todo card.",
                )
              }}
            </p>
          </div>
        </section>

        <label v-if="approval.state === 'pending'" class="form-label approvals-page__note-field">
          <span>{{ copy("审批备注（可选）", "Decision note (optional)") }}</span>
          <textarea
            v-model="notes[approval.requestId]"
            class="text-input text-input--textarea approvals-page__note-input"
            :disabled="actingId === approval.requestId"
          ></textarea>
        </label>

        <div class="run-card__actions">
          <button
            v-if="approval.state === 'pending'"
            class="primary-button"
            type="button"
            :disabled="actingId === approval.requestId"
            @click="decide(approval, 'approve')"
          >
            {{ actingId === approval.requestId ? t("actions.processing") : t("actions.approve") }}
          </button>
          <button
            v-if="approval.state === 'pending'"
            class="ghost-button"
            type="button"
            :disabled="actingId === approval.requestId"
            @click="decide(approval, 'reject')"
          >
            {{ t("actions.reject") }}
          </button>
          <RouterLink class="ghost-link" :to="getWorkspacePath('overview', approval.runId)">
            {{ t("actions.openWorkspace") }}
          </RouterLink>
          <RouterLink v-if="taskLink(approval)" class="ghost-link" :to="taskLink(approval)!">
            {{ copy("打开任务详情", "Open task detail") }}
          </RouterLink>
          <RouterLink v-if="sessionLink(approval)" class="ghost-link" :to="sessionLink(approval)!">
            {{ copy("打开会话详情", "Open session detail") }}
          </RouterLink>
        </div>
      </article>
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

<style scoped>
.approvals-page,
.approvals-hero,
.approvals-page__card,
.approvals-page__plans,
.approvals-page__plan-list {
  display: grid;
  gap: 16px;
}

.approvals-page__summary-grid {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.approvals-hero__header,
.approvals-page__card-top,
.approvals-page__plan-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}

.approvals-page__board {
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  align-items: start;
}

.approvals-page__card {
  align-content: start;
}

.approvals-page__card h2,
.approvals-page__plans h2 {
  margin: 0;
}

.approvals-page__badge-row,
.approvals-page__identity-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.approvals-page__summary {
  margin: 0;
}

.approvals-page__meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.approvals-page__meta-grid--plans {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.approvals-page__meta-grid-item--wide {
  grid-column: span 3;
}

.approvals-page__plan-card {
  display: grid;
  gap: 12px;
}

.approvals-page__command {
  margin: 0;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
  white-space: pre-wrap;
  line-height: 1.55;
}

.approvals-page__plans {
  padding-top: 4px;
  border-top: 1px solid rgba(126, 168, 180, 0.14);
}

.approvals-page__plans-header {
  align-items: center;
}

.approvals-page__note-field {
  display: grid;
  gap: 8px;
}

.approvals-page__note-input {
  min-height: 88px;
}

@media (max-width: 1240px) {
  .approvals-page__summary-grid,
  .approvals-page__meta-grid,
  .approvals-page__meta-grid--plans {
    grid-template-columns: 1fr;
  }

  .approvals-page__meta-grid-item--wide {
    grid-column: auto;
  }
}

@media (max-width: 720px) {
  .approvals-hero__header,
  .approvals-page__card-top,
  .approvals-page__plan-top {
    flex-direction: column;
    align-items: stretch;
  }

  .approvals-page__board {
    grid-template-columns: 1fr;
  }
}
</style>
