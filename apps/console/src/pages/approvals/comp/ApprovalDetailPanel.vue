<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import { usePreferences } from "../../../composables/usePreferences";
import type { ApprovalQueueActionPlanSnapshotView, ApprovalQueueItemDetailView } from "../../../approval-projection";
import { getRunWorkspacePath, getSessionDetailPath, getTaskDetailPath } from "../../../workspace";

const props = defineProps<{
  selectedApproval?: ApprovalQueueItemDetailView;
  actingId: string;
  note: string;
}>();

const emit = defineEmits<{
  "update:note": [note: string];
  decide: [decision: "approve" | "reject"];
}>();

const { isZh, riskLabel, t } = usePreferences();

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
  return approval.state === "pending" ? copy("待决", "Pending") : copy("未记录", "Not recorded");
}

function noteLabel(approval: ApprovalQueueItemDetailView): string {
  if (approval.note) {
    return approval.note;
  }
  return approval.state === "pending" ? copy("未填写", "None yet") : copy("无", "None");
}

function formatCommand(actionPlan: ApprovalQueueActionPlanSnapshotView): string | undefined {
  if (!actionPlan.command) {
    return undefined;
  }
  return [actionPlan.command, ...actionPlan.args].join(" ");
}

const taskTo = computed(() => {
  if (!props.selectedApproval?.taskId) {
    return undefined;
  }
  return getTaskDetailPath(props.selectedApproval.runId, props.selectedApproval.taskId);
});

const sessionTo = computed(() => {
  const sessionId = props.selectedApproval?.session?.sessionId;
  if (!sessionId || !props.selectedApproval) {
    return undefined;
  }
  return getSessionDetailPath(props.selectedApproval.runId, sessionId);
});

const workspaceTo = computed(() =>
  props.selectedApproval ? getRunWorkspacePath(props.selectedApproval.runId) : undefined,
);

function onApprove(): void {
  emit("decide", "approve");
}

function onReject(): void {
  emit("decide", "reject");
}

function onNoteInput(event: Event): void {
  emit("update:note", (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <article
    v-if="selectedApproval"
    class="approval-card approval-card--decision panel-card approvals-detail"
    :data-risk="displayRiskLevel(selectedApproval.riskLevel)"
  >
    <div class="approvals-page__card-top">
      <div>
        <span class="approval-card__lane">{{ selectedApproval.requestId }}</span>
        <h2>{{ selectedApproval.taskTitle }}</h2>
      </div>
      <div class="approvals-page__badge-row">
        <span class="status-pill" :data-status="decisionStatePill(selectedApproval.state)">
          {{ decisionStateLabel(selectedApproval.state) }}
        </span>
        <span class="risk-pill" :data-risk="displayRiskLevel(selectedApproval.riskLevel)">
          {{ riskLevelLabel(selectedApproval.riskLevel) }}
        </span>
      </div>
    </div>

    <div class="approvals-page__identity-row">
      <span class="flow-pill">run {{ selectedApproval.runId }}</span>
      <span class="flow-pill">task {{ selectedApproval.taskId ?? copy("未挂载", "unbound") }}</span>
      <span class="flow-pill">session {{ selectedApproval.session?.sessionId ?? copy("未回填", "unbound") }}</span>
    </div>

    <p class="approvals-page__summary">{{ selectedApproval.summary }}</p>

    <div class="approvals-page__meta-grid">
      <div class="detail-chip detail-chip--compact">
        <span>{{ copy("请求时间", "Requested") }}</span>
        <strong>{{ selectedApproval.requestedAt }}</strong>
      </div>
      <div class="detail-chip detail-chip--compact">
        <span>{{ copy("决策时间", "Decided") }}</span>
        <strong>{{ selectedApproval.decidedAt ?? copy("未决", "Pending") }}</strong>
      </div>
      <div class="detail-chip detail-chip--compact">
        <span>{{ copy("审批人", "Actor") }}</span>
        <strong>{{ actorLabel(selectedApproval) }}</strong>
      </div>
      <div class="detail-chip detail-chip--compact">
        <span>{{ copy("备注", "Note") }}</span>
        <strong>{{ noteLabel(selectedApproval) }}</strong>
      </div>
      <div class="detail-chip detail-chip--compact">
        <span>{{ copy("审批来源", "Approval source") }}</span>
        <strong>{{ approvalSourceLabel(selectedApproval.sourceMode) }}</strong>
      </div>
      <div class="detail-chip detail-chip--compact">
        <span>{{ copy("会话绑定", "Session binding") }}</span>
        <strong>
          {{
            selectedApproval.session
              ? `${selectedApproval.session.label} · ${sessionSourceLabel(selectedApproval.session.sourceMode)}`
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
        <span class="panel-chip">{{ selectedApproval.actionPlanCount }}</span>
      </div>

      <div v-if="selectedApproval.actionPlans.length > 0" class="approvals-page__plan-list">
        <article
          v-for="actionPlan in selectedApproval.actionPlans"
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
              "当前审批没有持久化的 actionPlans 快照。",
              "This approval has no persisted action plan snapshot.",
            )
          }}
        </p>
      </div>
    </section>

    <label v-if="selectedApproval.state === 'pending'" class="form-label approvals-page__note-field">
      <span>{{ copy("审批备注（可选）", "Decision note (optional)") }}</span>
      <textarea
        :value="note"
        class="text-input text-input--textarea approvals-page__note-input"
        :disabled="actingId === selectedApproval.requestId"
        @input="onNoteInput"
      ></textarea>
    </label>

    <div class="run-card__actions">
      <button
        v-if="selectedApproval.state === 'pending'"
        class="primary-button"
        type="button"
        :disabled="actingId === selectedApproval.requestId"
        @click="onApprove"
      >
        {{ actingId === selectedApproval.requestId ? t("actions.processing") : t("actions.approve") }}
      </button>
      <button
        v-if="selectedApproval.state === 'pending'"
        class="ghost-button"
        type="button"
        :disabled="actingId === selectedApproval.requestId"
        @click="onReject"
      >
        {{ t("actions.reject") }}
      </button>
      <RouterLink v-if="workspaceTo" class="ghost-link" :to="workspaceTo">{{ t("actions.openWorkspace") }}</RouterLink>
      <RouterLink v-if="taskTo" class="ghost-link" :to="taskTo">{{ copy("打开任务详情", "Open task detail") }}</RouterLink>
      <RouterLink v-if="sessionTo" class="ghost-link" :to="sessionTo">{{ copy("打开会话详情", "Open session detail") }}</RouterLink>
    </div>
  </article>

  <div v-else class="panel-card__empty-state approvals-detail">
    <p class="panel-card__body">{{ copy("请选择左侧审批项查看详情。", "Select an approval item from the inbox to view details.") }}</p>
  </div>
</template>
