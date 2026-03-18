<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { getManagerChatProjection, interactSession } from "../api";
import {
  createEmptyManagerChatProjection,
  type ManagerChatProjectionView,
} from "../manager-projection";
import { usePreferences } from "../composables/usePreferences";

const props = defineProps<{
  runIdOverride?: string;
}>();

const route = useRoute();
const { isZh } = usePreferences();

const runId = computed(() => {
  if (typeof props.runIdOverride === "string" && props.runIdOverride.length > 0) {
    return props.runIdOverride;
  }
  return typeof route.params.runId === "string" ? route.params.runId : "";
});
const projection = ref<ManagerChatProjectionView>(createEmptyManagerChatProjection());
const loading = ref(false);
const sending = ref(false);
const error = ref("");
const messageInput = ref("");

const managerSessionId = computed(() => projection.value.managerSession?.sessionId);

function copy(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

async function loadProjection(targetRunId: string): Promise<void> {
  if (!targetRunId) {
    projection.value = createEmptyManagerChatProjection();
    error.value = copy("缺少 runId，无法打开总管页面。", "Missing runId, so manager page cannot be opened.");
    return;
  }

  loading.value = true;
  try {
    projection.value = await getManagerChatProjection(targetRunId);
    error.value = "";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function sendMessage(): Promise<void> {
  const targetRunId = runId.value;
  const body = messageInput.value.trim();
  if (!targetRunId || !body) {
    return;
  }
  if (!managerSessionId.value) {
    error.value = copy("当前 run 未建立总管会话。", "Manager session is not available for this run.");
    return;
  }

  sending.value = true;
  try {
    await interactSession(targetRunId, managerSessionId.value, {
      actorId: "console-user",
      body,
      clientRequestId: `manager-ui-${Date.now()}`,
    });
    messageInput.value = "";
    await loadProjection(targetRunId);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    sending.value = false;
  }
}

function messageRoleLabel(role: string): string {
  switch (role) {
    case "user":
      return copy("你", "You");
    case "manager":
      return copy("总管", "Manager");
    case "worker":
      return copy("员工", "Worker");
    case "system":
      return copy("系统", "System");
    default:
      return role;
  }
}

watch(
  () => runId.value,
  (nextRunId) => {
    void loadProjection(nextRunId);
  },
  { immediate: true },
);
</script>

<template>
  <section class="workspace-page-stack">
    <header class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ copy("总管面板", "Manager Desk") }}</p>
        <h1>{{ copy("总管-员工协作", "Manager-worker coordination") }}</h1>
      </div>
      <div class="manager-toolbar">
        <span class="flow-pill">run {{ runId || "-" }}</span>
        <button class="ghost-button" type="button" :disabled="loading || !runId" @click="runId && loadProjection(runId)">
          {{ copy("刷新", "Refresh") }}
        </button>
      </div>
    </header>

    <p v-if="error" class="manager-error">{{ error }}</p>

    <section class="manager-layout">
      <article class="panel-card manager-chat-panel">
        <header class="manager-chat-panel__header">
          <h2>{{ copy("总管对话时间线", "Manager timeline") }}</h2>
          <span class="status-pill" :data-status="projection.run.status">
            {{ projection.run.status }}
          </span>
        </header>

        <div class="manager-chat-panel__timeline">
          <p v-if="loading">{{ copy("加载中...", "Loading...") }}</p>
          <p v-else-if="projection.timeline.length === 0">
            {{ copy("暂无消息。", "No messages yet.") }}
          </p>
          <article
            v-for="message in projection.timeline"
            :key="message.messageId"
            class="manager-message"
            :data-role="message.role"
          >
            <header>
              <strong>{{ messageRoleLabel(message.role) }}</strong>
              <span>{{ message.actorId }}</span>
              <time>{{ message.createdAt }}</time>
            </header>
            <p>{{ message.body }}</p>
          </article>
        </div>

        <div class="manager-chat-panel__composer">
          <textarea
            v-model="messageInput"
            rows="4"
            :placeholder="copy('给总管发送新指令...', 'Send a message to the manager...')"
          ></textarea>
          <button class="primary-button" type="button" :disabled="sending || !messageInput.trim()" @click="sendMessage">
            {{ sending ? copy("发送中...", "Sending...") : copy("发送并触发执行", "Send and trigger run") }}
          </button>
        </div>
      </article>

      <aside class="manager-side">
        <article class="panel-card manager-side-card">
          <h2>{{ copy("员工执行队列", "Worker queue") }}</h2>
          <div v-if="projection.workerQueue.length === 0" class="panel-card__empty-state">
            <p>{{ copy("当前没有员工任务。", "No worker tasks right now.") }}</p>
          </div>
          <div v-else class="manager-queue-list">
            <article v-for="worker in projection.workerQueue" :key="worker.taskId" class="manager-queue-item">
              <header>
                <strong>{{ worker.title }}</strong>
                <span class="status-pill" :data-status="worker.status">{{ worker.status }}</span>
              </header>
              <p>{{ worker.agentId }} · {{ worker.lastActivityAt }}</p>
            </article>
          </div>
        </article>

        <article class="panel-card manager-side-card">
          <h2>{{ copy("待审批", "Pending approvals") }}</h2>
          <div v-if="projection.pendingApprovals.length === 0" class="panel-card__empty-state">
            <p>{{ copy("无待审批项。", "No pending approvals.") }}</p>
          </div>
          <div v-else class="manager-approval-list">
            <article v-for="approval in projection.pendingApprovals" :key="approval.requestId">
              <header>
                <strong>{{ approval.requestId }}</strong>
                <span class="risk-pill" :data-risk="approval.riskLevel">{{ approval.riskLevel }}</span>
              </header>
              <p>{{ approval.summary }}</p>
            </article>
          </div>
        </article>
      </aside>
    </section>
  </section>
</template>

