<script setup lang="ts">
import "@xterm/xterm/css/xterm.css";
import { computed, onBeforeUnmount, watch } from "vue";
import { NAlert, NButton, NCard, NEmpty, NTabPane, NTabs, NTag } from "naive-ui";
import { RouterLink, useRoute, useRouter } from "vue-router";

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
import {
  getRunWorkspacePath,
  getSessionDetailPath,
  getTaskDetailPath,
  type SessionDetailSection,
} from "../workspace";

const route = useRoute();
const router = useRouter();
const { riskLabel, statusLabel, validationLabel, t } = usePreferences();

const runId = computed(() => (typeof route.params.runId === "string" ? route.params.runId : ""));
const sessionId = computed(() => (typeof route.params.sessionId === "string" ? route.params.sessionId : ""));
const initialPromptFromRoute = computed(() =>
  typeof route.query.initialPrompt === "string" ? route.query.initialPrompt : "",
);

const detailTabs = [
  { name: "live" as const, label: "实时窗口" },
  { name: "support" as const, label: "支持视图" },
  { name: "artifacts" as const, label: "会话产物" },
] satisfies ReadonlyArray<{ name: SessionDetailSection; label: string }>;

const routeNameToSection: Partial<Record<string, SessionDetailSection>> = {
  "session-detail-live": "live",
  "session-detail-support": "support",
  "session-detail-artifacts": "artifacts",
};

const activeSection = computed<SessionDetailSection>(() => {
  const routeName = typeof route.name === "string" ? route.name : "";
  return routeNameToSection[routeName] ?? "live";
});

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
  fetchProjection: (nextRunId, nextSessionId) => getSessionDetailProjection(nextRunId, nextSessionId),
  getProjectionStatus: (data) => data.overview.status,
  isTerminalStatus: (status) => status === "completed" || status === "failed",
  getMissingParamMessage: () => "缺少 runId 或 sessionId，无法打开会话详情。",
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
});

const contextKey = computed(
  () => `${runId.value}::${sessionId.value}::${initialPromptFromRoute.value}`,
);

watch(
  () => contextKey.value,
  () => {
    const currentKey = contextKey.value;
    resetForContext(initialPromptFromRoute.value);
    resetArtifactPreview();

    void (async () => {
      await loadProjection();
      if (contextKey.value !== currentKey || error.value || activeSection.value !== "live") {
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

watch(
  () => [activeSection.value, loading.value, error.value, contextKey.value] as const,
  ([section, isLoading, currentError, currentKey]) => {
    if (section !== "live") {
      disconnectLiveTerminal();
      return;
    }
    if (isLoading || currentError || liveTerminalAutoConnectKey.value === currentKey) {
      return;
    }
    liveTerminalAutoConnectKey.value = currentKey;
    void connectLiveTerminal();
  },
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
    label: "来源模式",
    value: sourceModeLabel(overview.value.sourceMode),
  },
  {
    id: "transcript",
    label: "转录路径",
    value: overview.value.transcriptPath ?? "-",
  },
]);

function sourceModeLabel(sourceMode: string): string {
  switch (sourceMode) {
    case "task_session":
      return "真实 taskSession";
    case "run_event_backfill":
      return "事件回填";
    case "session_message":
      return "会话消息";
    case "run_event_agent_message":
      return "Agent 事件消息";
    case "tool_call":
      return "工具调用";
    case "artifact_record":
      return "产物记录";
    case "invocation_event_backfill":
      return "调用计划回填";
    case "approval_request":
      return "审批请求";
    case "inspection_approval":
      return "审批快照";
    case "validation_record":
      return "验证记录";
    case "transcript_stream":
      return "转录流";
    case "agent_message_backfill":
      return "消息回填";
    default:
      return "状态回填";
  }
}

function approvalStateLabel(item: SessionDetailApprovalItemView): string {
  switch (item.state) {
    case "pending":
      return "待决";
    case "approved":
      return "已批准";
    default:
      return "已拒绝";
  }
}

function statusTagType(status: string): "default" | "info" | "success" | "warning" | "error" {
  switch (status) {
    case "running":
      return "info";
    case "completed":
      return "success";
    case "awaiting_approval":
      return "warning";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function switchSection(nextTab: string): void {
  if (!runId.value || !sessionId.value) {
    return;
  }

  const section = detailTabs.find((tab) => tab.name === nextTab)?.name;
  if (!section || section === activeSection.value) {
    return;
  }

  void router.push(getSessionDetailPath(runId.value, sessionId.value, section));
}

function taskLink(): string {
  return getTaskDetailPath(projection.value.runId, overview.value.taskId, "summary");
}

function workspaceLink(): string {
  return getRunWorkspacePath(projection.value.runId);
}
</script>

<template>
  <section class="workspace-page-stack detail-page">
    <div class="workspace-page-header detail-page__header">
      <div>
        <p class="section-eyebrow">{{ "会话详情" }}</p>
        <h1>{{ overview.taskTitle }}</h1>
      </div>
      <p>
        {{
          "详情页以真实 session 为入口，直接展示 CLI 实时工作窗口和 Agent 事件流。"
        }}
      </p>
    </div>

    <div class="detail-page__body">
      <div class="section-actions approvals-page__actions">
        <n-button quaternary size="small" :disabled="loading" @click="loadProjection(false)">
          {{ t("actions.refresh") }}
        </n-button>
        <RouterLink class="ghost-link" :to="taskLink()">{{ "返回任务详情" }}</RouterLink>
        <RouterLink class="ghost-link" :to="workspaceLink()">{{ t("actions.backToWorkspace") }}</RouterLink>
      </div>

      <n-alert v-if="error" type="error" :show-icon="false">
        {{ error }}
      </n-alert>

      <n-card class="status-bar workspace-hero detail-hero" size="small">
        <div class="detail-hero__top">
          <div>
            <p class="section-eyebrow">{{ overview.sessionId }}</p>
            <h1>{{ overview.taskKind }} · {{ overview.taskId }}</h1>
            <p class="workspace-hero__lead">{{ overview.statusReason }}</p>
          </div>
          <div class="lane-panel__badges">
            <n-tag :type="statusTagType(overview.status)" size="small">{{ statusLabel(overview.status) }}</n-tag>
            <span class="flow-pill">{{ sourceModeLabel(overview.sourceMode) }}</span>
          </div>
        </div>

        <div class="workspace-summary-grid detail-summary-grid">
          <article v-for="card in summaryCards" :key="card.id" class="summary-card">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
          </article>
        </div>
      </n-card>

      <n-tabs type="segment" :value="activeSection" :default-value="'live'" @update:value="switchSection">
        <n-tab-pane v-for="tab in detailTabs" :key="tab.name" :name="tab.name" :tab="tab.label" />
      </n-tabs>

      <n-empty
        v-if="loading && !error"
        class="panel-card__empty-state"
        :description="'正在加载会话详情。'"
        size="small"
      />

      <div v-else-if="activeSection === 'live'" class="detail-grid detail-grid--primary">
        <n-card class="panel-card detail-card detail-card--wide" size="small">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">CLI Workspace</p>
              <h2>{{ "实时 CLI 工作窗口" }}</h2>
            </div>
            <div class="detail-terminal-actions">
              <n-tag size="small" round>{{ liveStatusLabel() }}</n-tag>
              <n-button quaternary size="small" :disabled="liveTerminalConnecting" @click="connectLiveTerminal">
                {{ liveTerminalConnecting ? "连接中..." : "启动实时终端" }}
              </n-button>
              <n-button
                quaternary
                size="small"
                :disabled="liveTerminalStatus !== 'connected' && liveTerminalStatus !== 'connecting'"
                @click="disconnectLiveTerminal"
              >
                {{ "断开" }}
              </n-button>
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
                  :placeholder="'输入消息，回车发送（Shift+Enter 换行）'"
                  @keydown="onChatInputKeydown"
                ></textarea>
                <div class="chat-composer__actions">
                  <n-button
                    type="primary"
                    size="small"
                    :disabled="liveTerminalStatus !== 'connected' || chatInput.trim().length === 0"
                    @click="sendChatInput"
                  >
                    {{ "发送到会话" }}
                  </n-button>
                  <span class="form-hint">
                    {{
                      liveTerminalStatus === "connected"
                        ? "消息会实时写入当前 CLI 终端。"
                        : "先连接实时终端，再发送消息。"
                    }}
                  </span>
                </div>
              </div>
            </div>

            <section class="live-workspace__events">
              <div class="live-workspace__events-header">
                <div>
                  <p class="section-eyebrow">{{ "Agent 事件消息" }}</p>
                  <h3>{{ "正在做的事情" }}</h3>
                </div>
                <n-tag size="small" round>{{ liveWorkspaceTimeline.length }}</n-tag>
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
              <n-empty
                v-else
                class="panel-card__empty-state"
                :description="'当前没有可展示的事件消息。'"
                size="small"
              />
            </section>
          </div>
        </n-card>
      </div>

      <SessionSupportPanels
        v-else
        :projection="projection"
        :section="activeSection === 'artifacts' ? 'artifacts' : 'support'"
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
    </div>
  </section>
</template>
