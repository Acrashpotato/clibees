<script setup lang="ts">
import "@xterm/xterm/css/xterm.css";
import { computed, onBeforeUnmount, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { getSessionDetailProjection } from "../api";
import { useArtifactPreview } from "../composables/useArtifactPreview";
import { useEntityProjection } from "../composables/useEntityProjection";
import { usePreferences } from "../composables/usePreferences";
import {
  createEmptySessionDetailProjection,
  type SessionDetailApprovalItemView,
  type SessionDetailProjectionView,
} from "../detail-projection";
import SessionSupportPanels from "./session-detail/comp/SessionSupportPanels.vue";
import { useLiveSessionTerminal } from "./session-detail/comp/useLiveSessionTerminal";
import { getRunWorkspacePath, getTaskDetailPath } from "../workspace";

const route = useRoute();
const { isZh, riskLabel, statusLabel, validationLabel, t } = usePreferences();

const runId = computed(() => (typeof route.params.runId === "string" ? route.params.runId : ""));
const sessionId = computed(() => (typeof route.params.sessionId === "string" ? route.params.sessionId : ""));
const initialPromptFromRoute = computed(() =>
  typeof route.query.initialPrompt === "string" ? route.query.initialPrompt : "",
);

function copy(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

const {
  artifactPreviewById,
  artifactPreviewErrorById,
  artifactPreviewLoadingId,
  isArtifactExpanded,
  toggleArtifactPreview,
  resetArtifactPreview,
} = useArtifactPreview(() => runId.value);

const { projection, loading, error, loadProjection, stopPolling } = useEntityProjection<
  SessionDetailProjectionView,
  SessionDetailProjectionView["overview"]["status"]
>({
  getRunId: () => runId.value,
  getEntityId: () => sessionId.value,
  createEmptyProjection: createEmptySessionDetailProjection,
  fetchProjection: (nextRunId, nextSessionId) =>
    getSessionDetailProjection(nextRunId, nextSessionId),
  getProjectionStatus: (data) => data.overview.status,
  isTerminalStatus: (status) => status === "completed" || status === "failed",
  getMissingParamMessage: () =>
    copy(
      "缺少 runId 或 sessionId，无法打开会话详情。",
      "Missing runId or sessionId, so session detail cannot be opened.",
    ),
  emptyRunId: "workspace",
  emptyEntityId: "session",
});

const {
  liveTerminalMount,
  liveTerminalStatus,
  liveTerminalError,
  liveTerminalConnecting,
  liveTerminalAutoConnectKey,
  chatInput,
  liveWorkspaceTimeline,
  connectLiveTerminal,
  disconnectLiveTerminal,
  sendChatInput,
  onChatInputKeydown,
  liveStatusLabel,
  resetForContext,
  dispose,
} = useLiveSessionTerminal({
  getRunId: () => runId.value,
  getSessionId: () => sessionId.value,
  getAgentMessages: () => projection.value.messages,
  copy,
});

watch(
  () => `${runId.value}::${sessionId.value}::${initialPromptFromRoute.value}`,
  () => {
    const currentKey = `${runId.value}::${sessionId.value}::${initialPromptFromRoute.value}`;
    resetForContext(initialPromptFromRoute.value);
    resetArtifactPreview();

    void (async () => {
      await loadProjection();
      if (`${runId.value}::${sessionId.value}::${initialPromptFromRoute.value}` !== currentKey || error.value) {
        return;
      }
      if (liveTerminalAutoConnectKey.value === currentKey) {
        return;
      }
      liveTerminalAutoConnectKey.value = currentKey;
      await connectLiveTerminal();
    })();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopPolling();
  dispose();
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
  return getRunWorkspacePath(projection.value.runId);
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
            "详情页以真实 session 为入口，直接展示 CLI 实时工作窗口和 Agent 事件流。",
            "The detail page enters from a real session and shows the live CLI workspace with agent events.",
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
            <p class="section-eyebrow">CLI Workspace</p>
            <h2>{{ copy("实时 CLI 工作窗口", "Live CLI workspace") }}</h2>
          </div>
          <div class="detail-terminal-actions">
            <span class="panel-chip">{{ liveStatusLabel() }}</span>
            <button class="ghost-button" type="button" :disabled="liveTerminalConnecting" @click="connectLiveTerminal">
              {{ liveTerminalConnecting ? copy("连接中...", "Connecting...") : copy("启动实时终端", "Start live terminal") }}
            </button>
            <button
              class="ghost-button"
              type="button"
              :disabled="liveTerminalStatus !== 'connected' && liveTerminalStatus !== 'connecting'"
              @click="disconnectLiveTerminal"
            >
              {{ copy("断开", "Disconnect") }}
            </button>
          </div>
        </div>

        <div class="live-workspace">
          <div class="live-workspace__terminal">
            <div class="terminal workspace-v3-terminal">
              <div class="terminal__toolbar">
                <span class="terminal__dot"></span>
                <span class="terminal__dot"></span>
                <span class="terminal__dot"></span>
                <span>{{ overview.sessionId }}</span>
              </div>
              <div ref="liveTerminalMount" class="live-terminal-host"></div>
            </div>

            <p v-if="liveTerminalError" class="form-error">{{ liveTerminalError }}</p>

            <div class="chat-composer">
              <textarea
                v-model="chatInput"
                class="text-input text-input--textarea"
                rows="3"
                :placeholder="copy('输入消息，回车发送（Shift+Enter 换行）', 'Type a message. Press Enter to send (Shift+Enter for newline).')"
                @keydown="onChatInputKeydown"
              ></textarea>
              <div class="chat-composer__actions">
                <button
                  class="primary-button"
                  type="button"
                  :disabled="liveTerminalStatus !== 'connected' || chatInput.trim().length === 0"
                  @click="sendChatInput"
                >
                  {{ copy("发送到会话", "Send to session") }}
                </button>
                <span class="form-hint">
                  {{
                    liveTerminalStatus === "connected"
                      ? copy("消息会实时写入当前 CLI 终端。", "Messages are sent to the live CLI terminal.")
                      : copy("先连接实时终端，再发送消息。", "Connect the live terminal before sending messages.")
                  }}
                </span>
              </div>
            </div>
          </div>

          <section class="live-workspace__events">
            <div class="live-workspace__events-header">
              <div>
                <p class="section-eyebrow">{{ copy("Agent 事件消息", "Agent event messages") }}</p>
                <h3>{{ copy("正在做的事情", "What the CLI worker is doing") }}</h3>
              </div>
              <span class="panel-chip">{{ liveWorkspaceTimeline.length }}</span>
            </div>

            <div v-if="liveWorkspaceTimeline.length > 0" class="live-workspace__events-list">
              <article
                v-for="message in liveWorkspaceTimeline"
                :key="message.id"
                class="approval-card detail-item-card chat-item"
                :data-role="message.role"
              >
                <div class="detail-item-card__top chat-item__meta">
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
              <p class="panel-card__body">{{ copy("当前没有可展示的事件消息。", "No event messages are available to display.") }}</p>
            </div>
          </section>
        </div>
      </section>
    </div>

    <SessionSupportPanels
      :projection="projection"
      :copy="copy"
      :t="t"
      :risk-label="riskLabel"
      :validation-label="validationLabel"
      :source-mode-label="sourceModeLabel"
      :approval-state-label="approvalStateLabel"
      :is-artifact-expanded="isArtifactExpanded"
      :toggle-artifact-preview="toggleArtifactPreview"
      :artifact-preview-loading-id="artifactPreviewLoadingId"
      :artifact-preview-error-by-id="artifactPreviewErrorById"
      :artifact-preview-by-id="artifactPreviewById"
    />
  </section>
</template>
