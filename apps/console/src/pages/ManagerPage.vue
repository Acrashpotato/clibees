<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { getManagerChatProjection, interactSession } from "../api";
import {
  createEmptyManagerChatProjection,
  type ManagerChatProjectionView,
} from "../manager-projection";

const props = defineProps<{
  runIdOverride?: string;
}>();

const route = useRoute();

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


async function loadProjection(targetRunId: string): Promise<void> {
  if (!targetRunId) {
    projection.value = createEmptyManagerChatProjection();
    error.value = "缺少 runId，无法打开总管页面。";
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
    error.value = "当前 run 未建立总管会话。";
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
      return "你";
    case "manager":
      return "总管";
    case "worker":
      return "员工";
    case "system":
      return "系统";
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
        <p class="section-eyebrow">{{ "总管面板" }}</p>
        <h1>{{ "总管-员工协作" }}</h1>
      </div>
      <div class="manager-toolbar">
        <span class="flow-pill">run {{ runId || "-" }}</span>
        <button class="ghost-button" type="button" :disabled="loading || !runId" @click="runId && loadProjection(runId)">
          {{ "刷新" }}
        </button>
      </div>
    </header>

    <p v-if="error" class="manager-error">{{ error }}</p>

    <section class="manager-layout">
      <article class="panel-card manager-chat-panel">
        <header class="manager-chat-panel__header">
          <h2>{{ "总管对话时间线" }}</h2>
          <span class="status-pill" :data-status="projection.run.status">
            {{ projection.run.status }}
          </span>
        </header>

        <div class="manager-chat-panel__timeline">
          <p v-if="loading">{{ "加载中..." }}</p>
          <p v-else-if="projection.timeline.length === 0">
            {{ "暂无消息。" }}
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
            :placeholder="'给总管发送新指令...'"
          ></textarea>
          <button class="primary-button" type="button" :disabled="sending || !messageInput.trim()" @click="sendMessage">
            {{ sending ? "发送中..." : "发送并触发执行" }}
          </button>
        </div>
      </article>

      <aside class="manager-side">
        <article class="panel-card manager-side-card">
          <h2>{{ "员工执行队列" }}</h2>
          <div v-if="projection.workerQueue.length === 0" class="panel-card__empty-state">
            <p>{{ "当前没有员工任务。" }}</p>
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
          <h2>{{ "待审批" }}</h2>
          <div v-if="projection.pendingApprovals.length === 0" class="panel-card__empty-state">
            <p>{{ "无待审批项。" }}</p>
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

