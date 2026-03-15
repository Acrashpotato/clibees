<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { getSessionDetailProjection } from "../api";
import { usePreferences } from "../composables/usePreferences";
import {
  createEmptySessionDetailProjection,
  type SessionDetailApprovalItemView,
  type SessionDetailProjectionView,
} from "../detail-projection";
import {
  getTaskDetailPath,
  getWorkspacePath,
} from "../workspace";

const route = useRoute();
const { isZh, riskLabel, statusLabel, validationLabel, t } = usePreferences();

const runId = computed(() => (typeof route.params.runId === "string" ? route.params.runId : ""));
const sessionId = computed(() => (typeof route.params.sessionId === "string" ? route.params.sessionId : ""));
const projection = ref<SessionDetailProjectionView>(
  createEmptySessionDetailProjection(runId.value, sessionId.value),
);
const loading = ref(false);
const error = ref("");
let pollHandle: ReturnType<typeof setInterval> | undefined;

function copy(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

function stopPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = undefined;
  }
}

function startPolling() {
  stopPolling();

  if (!runId.value || !sessionId.value) {
    return;
  }

  if (projection.value.overview.status === "completed" || projection.value.overview.status === "failed") {
    return;
  }

  pollHandle = setInterval(() => {
    void loadProjection(false);
  }, 2000);
}

async function loadProjection(showLoading = true) {
  if (!runId.value || !sessionId.value) {
    error.value = copy("缺少 runId 或 sessionId，无法打开会话详情。", "Missing runId or sessionId, so session detail cannot be opened.");
    projection.value = createEmptySessionDetailProjection(runId.value || "workspace", sessionId.value || "session");
    stopPolling();
    return;
  }

  if (showLoading) {
    loading.value = true;
  }

  try {
    error.value = "";
    projection.value = await getSessionDetailProjection(runId.value, sessionId.value);
    startPolling();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
    stopPolling();
  } finally {
    loading.value = false;
  }
}

watch(
  () => `${runId.value}::${sessionId.value}`,
  () => {
    void loadProjection();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopPolling();
});

const overview = computed(() => projection.value.overview);
const summaryCards = computed(() => [
  {
    id: "agent",
    label: t("fields.agent"),
    value: overview.value.agentId,
  },
  {
    id: "owner",
    label: t("fields.owner"),
    value: overview.value.ownerLabel,
  },
  {
    id: "approvals",
    label: t("fields.approvals"),
    value: String(overview.value.pendingApprovalCount),
  },
  {
    id: "activity",
    label: t("fields.lastActivity"),
    value: overview.value.lastActivityAt || "-",
  },
  {
    id: "source",
    label: copy("来源模式", "Source mode"),
    value: sourceModeLabel(overview.value.sourceMode),
  },
  {
    id: "transcript",
    label: copy("转录路径", "Transcript path"),
    value: overview.value.transcriptPath ?? "-",
  },
]);

function sourceModeLabel(sourceMode: string): string {
  switch (sourceMode) {
    case "task_session":
      return copy("真实 taskSession", "Persisted taskSession");
    case "run_event_backfill":
      return copy("事件回填", "Event backfill");
    case "session_message":
      return copy("会话消息", "Session message");
    case "run_event_agent_message":
      return copy("Agent 事件消息", "Agent event message");
    case "tool_call":
      return copy("工具调用", "Tool call");
    case "artifact_record":
      return copy("产物记录", "Artifact record");
    case "invocation_event_backfill":
      return copy("调用计划回填", "Invocation backfill");
    case "approval_request":
      return copy("审批请求", "Approval request");
    case "inspection_approval":
      return copy("审批快照", "Approval snapshot");
    case "validation_record":
      return copy("验证记录", "Validation record");
    case "transcript_stream":
      return copy("转录流", "Transcript stream");
    case "agent_message_backfill":
      return copy("消息回填", "Message backfill");
    default:
      return copy("状态回填", "Status backfill");
  }
}

function approvalStateLabel(item: SessionDetailApprovalItemView): string {
  switch (item.state) {
    case "pending":
      return copy("待决", "Pending");
    case "approved":
      return copy("已批准", "Approved");
    default:
      return copy("已拒绝", "Rejected");
  }
}

function taskLink(): string {
  return getTaskDetailPath(projection.value.runId, overview.value.taskId);
}

function workspaceLink(): string {
  return getWorkspacePath("overview", projection.value.runId);
}
</script>

<template>
  <section class="workspace-page-stack detail-page">
    <div class="workspace-page-header detail-page__header">
      <div>
        <p class="section-eyebrow">{{ copy("会话详情", "Session detail") }}</p>
        <h1>{{ overview.taskTitle }}</h1>
      </div>
      <p>
        {{
          copy(
            "详情页现在只以真实 session 为入口，承载消息流、工具调用、审批、验证和 terminal preview。",
            "The detail page now enters through a real session and carries the message stream, tool calls, approvals, validation, and terminal preview.",
          )
        }}
      </p>
    </div>

    <div class="section-actions approvals-page__actions">
      <button class="ghost-button" type="button" :disabled="loading" @click="loadProjection(false)">
        {{ t("actions.refresh") }}
      </button>
      <RouterLink class="ghost-link" :to="taskLink()">{{ copy("返回任务详情", "Back to task detail") }}</RouterLink>
      <RouterLink class="ghost-link" :to="workspaceLink()">{{ t("actions.backToWorkspace") }}</RouterLink>
    </div>

    <div v-if="error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ error }}</p>
    </div>

    <section class="status-bar workspace-hero detail-hero">
      <div class="detail-hero__top">
        <div>
          <p class="section-eyebrow">{{ overview.sessionId }}</p>
          <h1>{{ overview.taskKind }} · {{ overview.taskId }}</h1>
          <p class="workspace-hero__lead">{{ overview.statusReason }}</p>
        </div>
        <div class="lane-panel__badges">
          <span class="status-pill" :data-status="overview.status">{{ statusLabel(overview.status) }}</span>
          <span class="flow-pill">{{ sourceModeLabel(overview.sourceMode) }}</span>
        </div>
      </div>

      <div class="workspace-summary-grid detail-summary-grid">
        <article v-for="card in summaryCards" :key="card.id" class="summary-card">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </article>
      </div>
    </section>

    <div v-if="loading && !error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ copy("正在加载会话详情。", "Loading session detail.") }}</p>
    </div>

    <div class="detail-grid detail-grid--primary">
      <section class="panel-card detail-card detail-card--wide">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("消息流", "Messages") }}</p>
            <h2>{{ copy("会话消息时间线", "Session message timeline") }}</h2>
          </div>
          <span class="panel-chip">{{ projection.messages.length }}</span>
        </div>

        <div v-if="projection.messages.length > 0" class="detail-stack">
          <article v-for="message in projection.messages" :key="message.messageId" class="approval-card detail-item-card">
            <div class="detail-item-card__top">
              <div>
                <span class="approval-card__lane">{{ message.senderLabel }}</span>
                <strong>{{ message.timestamp }}</strong>
              </div>
              <span class="flow-pill">{{ message.stream }}</span>
            </div>
            <p class="panel-card__body">{{ sourceModeLabel(message.sourceMode) }}</p>
            <pre class="detail-pre">{{ message.text }}</pre>
          </article>
        </div>
        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ copy("当前没有可展示的消息流。", "No message stream is available to display.") }}</p>
        </div>
      </section>

      <section class="panel-card detail-card detail-card--wide">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">Terminal</p>
            <h2>{{ copy("会话终端预览", "Session terminal preview") }}</h2>
          </div>
          <span class="panel-chip">{{ sourceModeLabel(projection.terminalPreview.sourceMode) }}</span>
        </div>

        <div class="terminal workspace-v3-terminal">
          <div class="terminal__toolbar">
            <span class="terminal__dot"></span>
            <span class="terminal__dot"></span>
            <span class="terminal__dot"></span>
            <span>{{ overview.sessionId }}</span>
          </div>
          <pre class="terminal__body">{{ projection.terminalPreview.lines.join("\n") }}</pre>
        </div>
      </section>
    </div>

    <div class="detail-grid detail-grid--support">
      <section class="panel-card detail-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("工具调用", "Tool calls") }}</p>
            <h2>{{ copy("调用与结果", "Invocations and results") }}</h2>
          </div>
          <span class="panel-chip">{{ projection.toolCalls.length }}</span>
        </div>

        <div v-if="projection.toolCalls.length > 0" class="detail-stack">
          <article v-for="tool in projection.toolCalls" :key="tool.toolCallId" class="approval-card detail-item-card">
            <div class="detail-item-card__top">
              <div>
                <span class="approval-card__lane">{{ tool.label }}</span>
                <strong>{{ tool.command }}</strong>
              </div>
              <span class="status-pill" :data-status="tool.status === 'completed' ? 'completed' : tool.status === 'failed' ? 'failed' : 'running'">
                {{ tool.status }}
              </span>
            </div>
            <p class="panel-card__body" v-if="tool.args.length > 0">{{ tool.args.join(" ") }}</p>
            <p class="panel-card__body" v-if="tool.cwd">cwd: {{ tool.cwd }}</p>
            <p>{{ tool.summary }}</p>
            <p class="panel-card__body">{{ sourceModeLabel(tool.sourceMode) }}</p>
          </article>
        </div>
        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ copy("当前没有可展示的工具调用。", "No tool calls are available to display.") }}</p>
        </div>
      </section>

      <section class="panel-card detail-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ t("sections.approvals") }}</p>
            <h2>{{ copy("会话审批记录", "Session approvals") }}</h2>
          </div>
          <span class="panel-chip">{{ projection.approvals.length }}</span>
        </div>

        <div v-if="projection.approvals.length > 0" class="detail-stack">
          <article v-for="approval in projection.approvals" :key="approval.requestId" class="approval-card detail-item-card" :data-risk="approval.riskLevel === 'none' ? 'low' : approval.riskLevel">
            <div class="detail-item-card__top">
              <div>
                <span class="approval-card__lane">{{ approval.requestId }}</span>
                <strong>{{ approvalStateLabel(approval) }}</strong>
              </div>
              <span class="risk-pill" :data-risk="approval.riskLevel === 'none' ? 'low' : approval.riskLevel">
                {{ approval.riskLevel === "none" ? copy("无", "None") : riskLabel(approval.riskLevel) }}
              </span>
            </div>
            <p>{{ approval.summary }}</p>
            <p class="panel-card__body">{{ sourceModeLabel(approval.sourceMode) }}</p>
            <p class="panel-card__body" v-if="approval.requestedAt">{{ copy("请求时间", "Requested") }}: {{ approval.requestedAt }}</p>
            <p class="panel-card__body" v-if="approval.decidedAt">{{ copy("决策时间", "Decided") }}: {{ approval.decidedAt }}</p>
          </article>
        </div>
        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ copy("当前没有会话级审批记录。", "No session-level approvals are available.") }}</p>
        </div>
      </section>

      <section class="panel-card detail-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("验证摘要", "Validation") }}</p>
            <h2>{{ copy("会话验证状态", "Session validation state") }}</h2>
          </div>
          <span class="status-pill" :data-status="projection.validation.state === 'fail' ? 'failed' : projection.validation.state === 'pass' ? 'completed' : 'awaiting_approval'">
            {{ validationLabel(projection.validation.state) }}
          </span>
        </div>

        <div class="detail-stack">
          <div class="focus-panel__status-block">
            <strong class="focus-panel__status">{{ projection.validation.summary }}</strong>
            <p class="panel-card__body">{{ sourceModeLabel(projection.validation.sourceMode) }}</p>
          </div>
          <ul v-if="projection.validation.details.length > 0" class="health-list">
            <li v-for="detail in projection.validation.details" :key="detail">{{ detail }}</li>
          </ul>
          <p v-if="projection.validation.updatedAt" class="panel-card__body">
            {{ copy("更新时间", "Updated") }}: {{ projection.validation.updatedAt }}
          </p>
        </div>
      </section>

      <section class="panel-card detail-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("产物摘要", "Artifacts") }}</p>
            <h2>{{ copy("会话产物", "Session artifacts") }}</h2>
          </div>
          <span class="panel-chip">{{ projection.artifacts.totalCount }}</span>
        </div>

        <div v-if="projection.artifacts.items.length > 0" class="detail-stack">
          <article v-for="artifact in projection.artifacts.items" :key="artifact.artifactId" class="approval-card detail-item-card">
            <div class="detail-item-card__top">
              <div>
                <span class="approval-card__lane">{{ artifact.kind }}</span>
                <strong>{{ artifact.summary }}</strong>
              </div>
              <span class="flow-pill">{{ artifact.createdAt }}</span>
            </div>
            <p class="panel-card__body">{{ artifact.uri }}</p>
          </article>
        </div>
        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ copy("当前没有会话级产物。", "No session artifacts are available yet.") }}</p>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.detail-page,
.detail-hero,
.detail-card,
.detail-stack,
.detail-grid {
  display: grid;
  gap: 16px;
}

.detail-page__header,
.detail-hero__top,
.detail-item-card__top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}

.detail-summary-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.detail-grid--primary,
.detail-grid--support {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
}

.detail-card--wide {
  grid-column: 1 / -1;
}

.detail-item-card {
  display: grid;
  gap: 10px;
}

.detail-pre {
  margin: 0;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
  white-space: pre-wrap;
  line-height: 1.6;
}

@media (max-width: 1240px) {
  .detail-summary-grid,
  .detail-grid--primary,
  .detail-grid--support {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .detail-page__header,
  .detail-hero__top,
  .detail-item-card__top {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
