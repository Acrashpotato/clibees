<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NInput,
  NTabPane,
  NTabs,
  NTag,
} from "naive-ui";
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

const { riskLabel, t } = usePreferences();
type ApprovalDetailTab = "decision" | "plans" | "context";

const activeDetailTab = ref<ApprovalDetailTab>("decision");

function decisionStateLabel(state: ApprovalQueueItemDetailView["state"]): string {
  switch (state) {
    case "pending":
      return "待决";
    case "approved":
      return "已批准";
    default:
      return "已拒绝";
  }
}

function decisionTagType(state: ApprovalQueueItemDetailView["state"]): "warning" | "success" | "error" {
  switch (state) {
    case "pending":
      return "warning";
    case "approved":
      return "success";
    default:
      return "error";
  }
}

function displayRiskLevel(riskLevel: ApprovalQueueItemDetailView["riskLevel"]): "low" | "medium" | "high" {
  return riskLevel === "none" ? "low" : riskLevel;
}

function riskLevelLabel(riskLevel: ApprovalQueueItemDetailView["riskLevel"]): string {
  return riskLevel === "none" ? "无" : riskLabel(riskLevel);
}

function riskTagType(riskLevel: ApprovalQueueItemDetailView["riskLevel"]): "default" | "warning" | "error" {
  switch (riskLevel) {
    case "high":
      return "error";
    case "medium":
      return "warning";
    default:
      return "default";
  }
}

function approvalSourceLabel(sourceMode: ApprovalQueueItemDetailView["sourceMode"]): string {
  switch (sourceMode) {
    case "approval_artifact":
      return "审批快照产物";
    default:
      return "检查聚合回填";
  }
}

function sessionSourceLabel(sourceMode: NonNullable<ApprovalQueueItemDetailView["session"]>["sourceMode"]): string {
  switch (sourceMode) {
    case "run_event_backfill":
      return "事件窗口回填";
    default:
      return "任务状态回填";
  }
}

function actorLabel(approval: ApprovalQueueItemDetailView): string {
  if (approval.actor) {
    return approval.actor;
  }
  return approval.state === "pending" ? "待决" : "未记录";
}

function noteLabel(approval: ApprovalQueueItemDetailView): string {
  if (approval.note) {
    return approval.note;
  }
  return approval.state === "pending" ? "未填写" : "无";
}

function formatCommand(actionPlan: ApprovalQueueActionPlanSnapshotView): string | undefined {
  if (!actionPlan.command) {
    return undefined;
  }
  return [actionPlan.command, ...actionPlan.args].join(" ");
}

function actionPlanRiskType(riskLevel: ApprovalQueueActionPlanSnapshotView["riskLevel"]): "default" | "warning" | "error" {
  switch (riskLevel) {
    case "high":
      return "error";
    case "medium":
      return "warning";
    default:
      return "default";
  }
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

watch(
  () => props.selectedApproval?.requestId,
  () => {
    activeDetailTab.value = "decision";
  },
);

function switchDetailTab(nextTab: string): void {
  if (nextTab === "decision" || nextTab === "plans" || nextTab === "context") {
    activeDetailTab.value = nextTab;
  }
}

function onApprove(): void {
  emit("decide", "approve");
}

function onReject(): void {
  emit("decide", "reject");
}
</script>

<template>
  <n-card
    v-if="selectedApproval"
    class="approval-card approval-card--decision panel-card approvals-detail"
    size="small"
    :data-risk="displayRiskLevel(selectedApproval.riskLevel)"
  >
    <div class="approvals-page__card-top">
      <div>
        <span class="approval-card__lane">{{ selectedApproval.requestId }}</span>
        <h2>{{ selectedApproval.taskTitle }}</h2>
      </div>
      <div class="approvals-page__badge-row">
        <n-tag :type="decisionTagType(selectedApproval.state)" size="small">
          {{ decisionStateLabel(selectedApproval.state) }}
        </n-tag>
        <n-tag :type="riskTagType(selectedApproval.riskLevel)" size="small">
          {{ riskLevelLabel(selectedApproval.riskLevel) }}
        </n-tag>
      </div>
    </div>

    <n-tabs
      class="approvals-detail__tabs"
      type="segment"
      display-directive="if"
      :value="activeDetailTab"
      @update:value="switchDetailTab"
    >
      <n-tab-pane name="decision" :tab="'决策'">
        <div class="approvals-page__identity-row">
          <span class="flow-pill">run {{ selectedApproval.runId }}</span>
          <span class="flow-pill">task {{ selectedApproval.taskId ?? "未挂载" }}</span>
          <span class="flow-pill">session {{ selectedApproval.session?.sessionId ?? "未回填" }}</span>
        </div>

        <p class="approvals-page__summary">{{ selectedApproval.summary }}</p>

        <div class="approvals-page__meta-grid">
          <div class="detail-chip detail-chip--compact">
            <span>{{ "请求时间" }}</span>
            <strong>{{ selectedApproval.requestedAt }}</strong>
          </div>
          <div class="detail-chip detail-chip--compact">
            <span>{{ "决策时间" }}</span>
            <strong>{{ selectedApproval.decidedAt ?? "未决" }}</strong>
          </div>
          <div class="detail-chip detail-chip--compact">
            <span>{{ "审批人" }}</span>
            <strong>{{ actorLabel(selectedApproval) }}</strong>
          </div>
          <div class="detail-chip detail-chip--compact">
            <span>{{ "备注" }}</span>
            <strong>{{ noteLabel(selectedApproval) }}</strong>
          </div>
        </div>

        <div v-if="selectedApproval.state === 'pending'" class="approvals-page__note-field">
          <span class="form-label">{{ "审批备注（可选）" }}</span>
          <n-input
            :value="note"
            type="textarea"
            class="approvals-page__note-input"
            :disabled="actingId === selectedApproval.requestId"
            :autosize="{ minRows: 3, maxRows: 6 }"
            @update:value="emit('update:note', $event)"
          />
        </div>

        <div class="run-card__actions">
          <n-button
            v-if="selectedApproval.state === 'pending'"
            type="primary"
            size="small"
            :disabled="actingId === selectedApproval.requestId"
            @click="onApprove"
          >
            {{ actingId === selectedApproval.requestId ? t("actions.processing") : t("actions.approve") }}
          </n-button>
          <n-button
            v-if="selectedApproval.state === 'pending'"
            quaternary
            size="small"
            :disabled="actingId === selectedApproval.requestId"
            @click="onReject"
          >
            {{ t("actions.reject") }}
          </n-button>
        </div>
      </n-tab-pane>

      <n-tab-pane name="plans" :tab="`方案 | ${selectedApproval.actionPlanCount}`">
        <section class="approvals-page__plans">
          <div class="panel-card__header approvals-page__plans-header">
            <div>
              <p class="section-eyebrow">{{ "动作快照" }}</p>
              <h2>{{ "actionPlans 明细" }}</h2>
            </div>
            <n-tag size="small" round>{{ selectedApproval.actionPlanCount }}</n-tag>
          </div>

          <n-collapse v-if="selectedApproval.actionPlans.length > 0" accordion>
            <n-collapse-item
              v-for="actionPlan in selectedApproval.actionPlans"
              :key="actionPlan.actionPlanId"
              :title="`${actionPlan.kind} · ${actionPlan.reason}`"
              :name="actionPlan.actionPlanId"
            >
              <div class="approvals-page__badge-row">
                <n-tag size="small">
                  {{ actionPlan.requiresApproval ? "需审批" : "自动执行" }}
                </n-tag>
                <n-tag :type="actionPlanRiskType(actionPlan.riskLevel)" size="small">
                  {{ riskLabel(actionPlan.riskLevel) }}
                </n-tag>
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
                  <span>{{ "目标" }}</span>
                  <strong>{{ actionPlan.targets.length > 0 ? actionPlan.targets.join(", ") : "-" }}</strong>
                </div>
              </div>
            </n-collapse-item>
          </n-collapse>
          <n-empty
            v-else
            class="panel-card__empty-state"
            :description="'当前审批没有持久化的 actionPlans 快照。'"
            size="small"
          />
        </section>
      </n-tab-pane>

      <n-tab-pane name="context" :tab="'上下文'">
        <div class="approvals-page__meta-grid">
          <div class="detail-chip detail-chip--compact">
            <span>{{ "审批来源" }}</span>
            <strong>{{ approvalSourceLabel(selectedApproval.sourceMode) }}</strong>
          </div>
          <div class="detail-chip detail-chip--compact">
            <span>{{ "会话绑定" }}</span>
            <strong>
              {{
                selectedApproval.session
                  ? `${selectedApproval.session.label} · ${sessionSourceLabel(selectedApproval.session.sourceMode)}`
                  : "当前未能稳定回填 session"
              }}
            </strong>
          </div>
          <div class="detail-chip detail-chip--compact approvals-page__meta-grid-item--wide">
            <span>{{ "摘要" }}</span>
            <strong>{{ selectedApproval.summary }}</strong>
          </div>
        </div>
        <div class="run-card__actions">
          <RouterLink v-if="workspaceTo" class="ghost-link" :to="workspaceTo">{{ t("actions.openWorkspace") }}</RouterLink>
          <RouterLink v-if="taskTo" class="ghost-link" :to="taskTo">{{ "打开任务详情" }}</RouterLink>
          <RouterLink v-if="sessionTo" class="ghost-link" :to="sessionTo">{{ "打开会话详情" }}</RouterLink>
        </div>
      </n-tab-pane>
    </n-tabs>
  </n-card>

  <n-empty
    v-else
    class="panel-card approvals-detail"
    :description="'请选择左侧审批项查看详情。'"
    size="small"
  />
</template>
