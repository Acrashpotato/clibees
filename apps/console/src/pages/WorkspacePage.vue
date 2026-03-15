<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import { usePreferences } from "../composables/usePreferences";
import { useWorkspaceProjection } from "../composables/useWorkspaceProjection";
import type {
  WorkspaceProjectionActionQueueItem,
  WorkspaceProjectionControlAction,
  WorkspaceProjectionRiskLevel,
} from "../workspace-projection";
import {
  getSessionDetailPath,
  getTaskDetailPath,
  getTaskConsolePath,
  getWorkspacePath,
} from "../workspace";

const { isZh, riskLabel, statusLabel, t } = usePreferences();
const { error, loading, mutating, projection, refresh, resumeRun } = useWorkspaceProjection();

const run = computed(() => projection.value.run);
const focusTask = computed(() => projection.value.focusTask);
const activeSession = computed(() => projection.value.activeSession);
const actionQueue = computed(() => projection.value.actionQueue);
const pendingMessages = computed(() => projection.value.pendingMessages);
const dependencySummary = computed(() => projection.value.dependencySummary);
const riskSummary = computed(() => projection.value.riskSummary);
const controlActions = computed(() => projection.value.controlActions);

const focusTaskLink = computed(() =>
  focusTask.value ? getTaskDetailPath(run.value.runId, focusTask.value.taskId) : undefined,
);
const activeSessionLink = computed(() => {
  if (!activeSession.value) {
    return undefined;
  }

  if (activeSession.value.sessionId) {
    return getSessionDetailPath(run.value.runId, activeSession.value.sessionId);
  }

  return getTaskDetailPath(run.value.runId, activeSession.value.taskId);
});

function copy(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

function inspectPath(): string {
  return `/inspect?runId=${encodeURIComponent(run.value.runId)}`;
}

function approvalPath(requestId: string): string {
  return `/approvals?runId=${encodeURIComponent(run.value.runId)}&requestId=${encodeURIComponent(requestId)}`;
}

function actionRisk(tone: WorkspaceProjectionActionQueueItem["tone"]): "low" | "medium" | "high" {
  if (tone === "danger") {
    return "high";
  }
  if (tone === "warning") {
    return "medium";
  }
  return "low";
}

function actionQueueKindLabel(item: WorkspaceProjectionActionQueueItem): string {
  switch (item.kind) {
    case "approval_request":
      return copy("审批请求", "Approval request");
    case "blocked_task":
      return copy("阻塞任务", "Blocked task");
    case "pending_message":
      return copy("待处理消息", "Pending message");
    case "run_control":
      return copy("运行控制", "Run control");
    default:
      return copy("提醒", "Reminder");
  }
}

function queueActionLabel(item: WorkspaceProjectionActionQueueItem): string {
  switch (item.recommendedAction) {
    case "resume":
      return t("actions.resumeRun");
    case "review_approval":
      return copy("查看审批", "Review approval");
    case "interact":
      return copy("打开会话", "Open session");
    case "requeue":
    case "cancel":
      return copy("打开任务", "Open task");
    case "interrupt":
      return copy("查看会话", "Open session");
    case "inspect":
    default:
      return t("actions.openInspect");
  }
}

function queueActionTo(item: WorkspaceProjectionActionQueueItem): string {
  switch (item.recommendedAction) {
    case "review_approval":
      return approvalPath(item.targetId);
    case "requeue":
    case "cancel":
      return item.targetType === "task" ? getTaskDetailPath(run.value.runId, item.targetId) : inspectPath();
    case "interrupt":
    case "interact":
      return item.targetType === "task_session"
        ? getSessionDetailPath(run.value.runId, item.targetId)
        : activeSessionLink.value ?? inspectPath();
    case "resume":
      return getWorkspacePath("overview", run.value.runId);
    case "inspect":
    default:
      return inspectPath();
  }
}

function riskHeadlineLabel(level: WorkspaceProjectionRiskLevel | "none"): string {
  if (level === "none") {
    return copy("无高风险", "No high risk");
  }
  return riskLabel(level);
}

function pendingMessageSourceLabel(source: string): string {
  switch (source) {
    case "approval_requested":
      return copy("审批消息", "Approval message");
    case "task_blocked":
      return copy("阻塞消息", "Blocked message");
    case "task_failed":
      return copy("失败消息", "Failure message");
    case "validation_failed":
      return copy("验证消息", "Validation message");
    default:
      return copy("Agent 消息", "Agent message");
  }
}

function controlActionLink(action: WorkspaceProjectionControlAction): string | undefined {
  switch (action.actionId) {
    case "review_approval":
      return approvalPath(action.targetId);
    case "requeue":
    case "cancel":
      return getTaskDetailPath(run.value.runId, action.targetId);
    case "interact":
    case "interrupt":
      return action.scope === "task_session"
        ? getSessionDetailPath(run.value.runId, action.targetId)
        : activeSessionLink.value ?? inspectPath();
    default:
      return undefined;
  }
}

function controlActionRouted(action: WorkspaceProjectionControlAction): boolean {
  return Boolean(controlActionLink(action));
}

async function triggerAction(action: WorkspaceProjectionControlAction) {
  if (action.actionId === "resume" && action.enabled && !mutating.value) {
    await resumeRun();
  }
}
</script>

<template>
  <section class="workspace-page-stack workspace-v3">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ t("sections.workspace") }}</p>
        <h1>{{ copy("Workspace 总控台", "Workspace Control") }}</h1>
      </div>
      <p>
        {{
          copy(
            "Workspace 页面现在只承载 run 总控、焦点 task、活动 session、动作队列、依赖摘要、阻塞风险与消息入口。",
            "The Workspace page now only carries run control, the focus task, active session, action queue, dependency summary, risk pressure, and message entry.",
          )
        }}
      </p>
    </div>

    <div class="section-actions approvals-page__actions">
      <button class="ghost-button" type="button" :disabled="loading" @click="refresh">{{ t("actions.refresh") }}</button>
      <RouterLink class="ghost-link" :to="inspectPath()">{{ t("actions.openInspect") }}</RouterLink>
    </div>

    <div v-if="error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ error }}</p>
    </div>

    <section class="status-bar workspace-hero">
      <div class="workspace-v3-hero">
        <div>
          <p class="section-eyebrow">{{ t("sections.runWorkspace") }}</p>
          <h1>{{ run.goal }}</h1>
          <p class="workspace-hero__lead">{{ run.stage }}</p>
        </div>

        <div class="workspace-hero__meta">
          <span class="status-pill" :data-status="run.status">{{ statusLabel(run.status) }}</span>
          <button
            v-if="run.canResume"
            class="primary-button"
            type="button"
            :disabled="loading || mutating"
            @click="resumeRun"
          >
            {{ mutating ? t("actions.resuming") : t("actions.resumeRun") }}
          </button>
        </div>
      </div>

      <div class="workspace-summary-grid workspace-v3-summary-grid">
        <article class="summary-card">
          <span>{{ copy("任务总数", "Total tasks") }}</span>
          <strong>{{ run.totalTaskCount }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.activeTasks") }}</span>
          <strong>{{ run.activeTaskCount }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.activeSessions") }}</span>
          <strong>{{ run.activeSessionCount }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.approvals") }}</span>
          <strong>{{ run.pendingApprovalCount }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.blocked") }}</span>
          <strong>{{ run.blockedTaskCount }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ copy("已完成", "Completed") }}</span>
          <strong>{{ run.completedTaskCount }}</strong>
        </article>
      </div>
    </section>

    <div class="workspace-v3-primary-grid">
      <section class="panel-card workspace-v3-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("焦点任务", "Focus task") }}</p>
            <h2>{{ focusTask?.title ?? copy("当前没有可聚焦的任务。", "No focus task is currently selected.") }}</h2>
          </div>
          <div v-if="focusTask" class="lane-panel__badges">
            <span class="status-pill" :data-status="focusTask.status">{{ statusLabel(focusTask.status) }}</span>
            <span class="risk-pill" :data-risk="focusTask.riskLevel">{{ riskLabel(focusTask.riskLevel) }}</span>
          </div>
        </div>

        <template v-if="focusTask">
          <div class="focus-panel__status-block">
            <strong class="focus-panel__status">{{ focusTask.statusReason }}</strong>
            <p class="panel-card__body">
              {{ copy("焦点 task 来自主 workspace projection，不再依赖旧的 lane 分栏。", "The focus task now comes directly from the workspace projection instead of the old lane tabs.") }}
            </p>
          </div>

          <div class="workspace-v3-meta-grid">
            <div class="summary-card">
              <span>{{ t("fields.owner") }}</span>
              <strong>{{ focusTask.ownerLabel }}</strong>
            </div>
            <div class="summary-card">
              <span>{{ t("fields.lastActivity") }}</span>
              <strong>{{ focusTask.lastActivityAt }}</strong>
            </div>
            <div class="summary-card">
              <span>{{ copy("上游依赖", "Upstream deps") }}</span>
              <strong>{{ focusTask.dependsOn.length }}</strong>
            </div>
            <div class="summary-card">
              <span>{{ copy("下游任务", "Downstream tasks") }}</span>
              <strong>{{ focusTask.downstreamTaskIds.length }}</strong>
            </div>
          </div>

          <div class="focus-panel__footer">
            <p>{{ dependencySummary.summary }}</p>
            <RouterLink v-if="focusTaskLink" class="primary-link" :to="focusTaskLink">{{ copy("打开任务详情", "Open task detail") }}</RouterLink>
          </div>
        </template>

        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ copy("当前没有可聚焦的任务。", "No focus task is currently selected.") }}</p>
        </div>
      </section>

      <section class="panel-card workspace-v3-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("活动会话", "Active session") }}</p>
            <h2>{{ activeSession?.taskTitle ?? copy("当前没有活动 session。", "No active session is currently visible.") }}</h2>
          </div>
          <span v-if="activeSession" class="status-pill" :data-status="activeSession.status">{{ statusLabel(activeSession.status) }}</span>
        </div>

        <template v-if="activeSession">
          <div class="workspace-v3-meta-grid">
            <div class="summary-card">
              <span>{{ t("fields.agent") }}</span>
              <strong>{{ activeSession.agentId }}</strong>
            </div>
            <div class="summary-card">
              <span>{{ t("fields.approvals") }}</span>
              <strong>{{ activeSession.pendingApprovalCount }}</strong>
            </div>
            <div class="summary-card">
              <span>{{ t("fields.lastActivity") }}</span>
              <strong>{{ activeSession.lastActivityAt }}</strong>
            </div>
            <div class="summary-card">
              <span>{{ copy("来源模式", "Source mode") }}</span>
              <strong>{{ activeSession.sourceMode }}</strong>
            </div>
          </div>

          <div class="focus-panel__status-block">
            <strong class="focus-panel__status">{{ activeSession.statusReason }}</strong>
            <p class="panel-card__body">
              {{ copy("terminal preview 现在只作为会话级摘要，并跳转到真实 session detail 页继续查看消息和工具调用。", "Terminal preview is now only a session summary, with a real session detail page for messages and tool calls.") }}
            </p>
          </div>

          <div class="terminal workspace-v3-terminal">
            <div class="terminal__toolbar">
              <span class="terminal__dot"></span>
              <span class="terminal__dot"></span>
              <span class="terminal__dot"></span>
              <span>{{ copy("活动会话", "Active session") }}</span>
            </div>
            <pre class="terminal__body">{{ activeSession.terminalPreview.join("\n") }}</pre>
          </div>

          <div class="focus-panel__footer">
            <p>
              {{ copy("活动 session 现在直接落到真实 session detail 路由；如果底层还没有 sessionId，就临时回落到 task detail。", "The active session now routes directly to a real session detail view, and only falls back to task detail when the backend has not exposed a sessionId yet.") }}
            </p>
            <RouterLink v-if="activeSessionLink" class="ghost-link" :to="activeSessionLink">{{ copy("打开会话详情", "Open session detail") }}</RouterLink>
          </div>
        </template>

        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ copy("当前没有活动 session。", "No active session is currently visible.") }}</p>
        </div>
      </section>
    </div>

    <div class="workspace-v3-support-grid">
      <section class="panel-card workspace-v3-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ t("sections.actionQueue") }}</p>
            <h2>{{ t("sections.pendingForYou") }}</h2>
          </div>
          <span class="panel-chip">{{ actionQueue.length }}</span>
        </div>

        <p class="panel-card__body">
          {{ copy("动作队列直接消费 workspace projection，把审批、阻塞和消息注意项汇总到同一入口。", "The action queue now consumes the workspace projection directly and merges approvals, blockers, and message attention into one entry point.") }}
        </p>

        <div v-if="actionQueue.length > 0" class="action-queue-panel__list">
          <article
            v-for="item in actionQueue"
            :key="item.id"
            class="approval-card action-queue-card--secondary"
            :data-risk="actionRisk(item.tone)"
          >
            <div class="action-queue-card__topline">
              <span class="approval-card__lane">{{ actionQueueKindLabel(item) }}</span>
              <span class="flow-pill">{{ item.targetType }}</span>
            </div>
            <strong>{{ item.title }}</strong>
            <p>{{ item.summary }}</p>
            <RouterLink class="ghost-link action-queue-card__link" :to="queueActionTo(item)">
              {{ queueActionLabel(item) }}
            </RouterLink>
          </article>
        </div>

        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ t("workspacePage.actionQueueEmpty") }}</p>
        </div>
      </section>

      <section class="panel-card workspace-v3-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("依赖摘要", "Dependency summary") }}</p>
            <h2>{{ copy("焦点任务依赖压力", "Focus-task dependency pressure") }}</h2>
          </div>
        </div>

        <p class="panel-card__body">{{ dependencySummary.summary }}</p>

        <div class="workspace-v3-meta-grid">
          <div class="summary-card">
            <span>{{ copy("上游未完成", "Upstream pending") }}</span>
            <strong>{{ dependencySummary.upstreamPendingCount }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ copy("上游阻塞", "Upstream blocked") }}</span>
            <strong>{{ dependencySummary.upstreamBlockedCount }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ copy("下游就绪", "Downstream ready") }}</span>
            <strong>{{ dependencySummary.downstreamReadyCount }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ copy("下游等待", "Downstream waiting") }}</span>
            <strong>{{ dependencySummary.downstreamWaitingCount }}</strong>
          </div>
        </div>
      </section>

      <section class="panel-card workspace-v3-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("风险摘要", "Risk summary") }}</p>
            <h2>{{ copy("阻塞与风险", "Blockers and risk") }}</h2>
          </div>
          <span class="risk-pill" :data-risk="riskSummary.highestRiskLevel === 'none' ? 'low' : riskSummary.highestRiskLevel">
            {{ riskHeadlineLabel(riskSummary.highestRiskLevel) }}
          </span>
        </div>

        <div class="workspace-v3-meta-grid">
          <div class="summary-card">
            <span>{{ t("fields.approvals") }}</span>
            <strong>{{ riskSummary.pendingApprovalCount }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ t("fields.blocked") }}</span>
            <strong>{{ riskSummary.blockedTaskCount }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ copy("失败任务", "Failed tasks") }}</span>
            <strong>{{ riskSummary.failedTaskCount }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ copy("预警", "Warnings") }}</span>
            <strong>{{ riskSummary.warningCount }}</strong>
          </div>
        </div>

        <div v-if="riskSummary.headlines.length > 0" class="health-panel__list">
          <article v-for="headline in riskSummary.headlines" :key="headline" class="health-panel__item">
            <span class="health-panel__marker"></span>
            <p>{{ headline }}</p>
          </article>
        </div>

        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ t("workspacePage.healthEmpty") }}</p>
        </div>
      </section>

      <section class="panel-card workspace-v3-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("消息入口", "Message inbox") }}</p>
            <h2>{{ copy("待处理消息", "Pending messages") }}</h2>
          </div>
          <span class="panel-chip">{{ pendingMessages.unreadMessageCount }}</span>
        </div>

        <p class="panel-card__body">{{ pendingMessages.summary }}</p>

        <div class="workspace-v3-meta-grid">
          <div class="summary-card">
            <span>{{ copy("待处理线程", "Pending threads") }}</span>
            <strong>{{ pendingMessages.pendingThreadCount }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ copy("未读消息", "Unread messages") }}</span>
            <strong>{{ pendingMessages.unreadMessageCount }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ t("fields.lastActivity") }}</span>
            <strong>{{ pendingMessages.latestMessageAt ?? "-" }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ copy("来源模式", "Source mode") }}</span>
            <strong>{{ pendingMessages.sourceMode }}</strong>
          </div>
        </div>

        <div v-if="pendingMessages.items.length > 0" class="workspace-v3-message-list">
          <article v-for="item in pendingMessages.items" :key="item.id" class="approval-card action-queue-card--secondary">
            <div class="action-queue-card__topline">
              <span class="approval-card__lane">{{ pendingMessageSourceLabel(item.source) }}</span>
              <span class="flow-pill">{{ item.timestamp }}</span>
            </div>
            <strong>{{ item.title }}</strong>
            <p>{{ item.summary }}</p>
            <RouterLink class="ghost-link action-queue-card__link" :to="inspectPath()">
              {{ copy("查看消息", "Open messages") }}
            </RouterLink>
          </article>
        </div>

        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ copy("当前没有需要人工查看的消息。", "There is no message that currently needs manual review.") }}</p>
        </div>
      </section>

      <section class="panel-card workspace-v3-card workspace-v3-card--wide">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("控制动作", "Control actions") }}</p>
            <h2>{{ copy("当前可见控制动作", "Visible control actions") }}</h2>
          </div>
        </div>

        <div v-if="controlActions.length > 0" class="workspace-v3-control-list">
          <article v-for="action in controlActions" :key="action.actionId" class="approval-card workspace-v3-control-item">
            <div class="handoff-card__topline">
              <div>
                <span class="approval-card__lane">{{ action.scope }}</span>
                <strong>{{ action.label }}</strong>
              </div>
              <span class="status-pill" :data-status="action.enabled ? 'running' : 'paused'">
                {{ action.enabled ? copy("可用", "Available") : copy("未启用", "Disabled") }}
              </span>
            </div>
            <p>{{ action.reason }}</p>
            <div class="run-card__actions">
              <button
                v-if="action.actionId === 'resume'"
                class="primary-button"
                type="button"
                :disabled="!action.enabled || mutating"
                @click="triggerAction(action)"
              >
                {{ mutating ? t("actions.resuming") : action.label }}
              </button>
              <RouterLink
                v-else-if="controlActionRouted(action) && controlActionLink(action)"
                class="ghost-link"
                :to="controlActionLink(action)!"
              >
                {{ action.label }}
              </RouterLink>
              <button v-else class="ghost-button" type="button" disabled>
                {{ action.label }}
              </button>
              <span class="workspace-v3-action-note">
                {{
                  controlActionRouted(action)
                    ? copy("该动作现在会落到对应的 task 或 session detail 页面。", "This action now lands on the corresponding task or session detail page.")
                    : copy("动作契约已冻结，但执行链路尚未全部落地。", "The action contract is frozen, but the execution chain is not fully implemented yet.")
                }}
              </span>
            </div>
          </article>
        </div>

        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ copy("当前没有可展示的控制动作。", "No control action is available to show.") }}</p>
        </div>
      </section>
    </div>
  </section>
</template>
