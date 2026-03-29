<script setup lang="ts">
import { NButton, NCard, NEmpty, NTag } from "naive-ui";
import { RouterLink } from "vue-router";

import type { TaskDetailProjectionView } from "../../detail-projection";

defineProps<{
  sessionCount: number;
  visibleSessions: readonly TaskDetailProjectionView["sessions"][number][];
  hasMoreSessions: boolean;
  loadMoreSessions: () => void;
  statusLabel: (status: TaskDetailProjectionView["sessions"][number]["status"]) => string;
  statusTagType: (status: string) => "default" | "info" | "success" | "warning" | "error";
  sessionSourceLabel: (sourceMode: TaskDetailProjectionView["sessions"][number]["sourceMode"]) => string;
  sessionLink: (sessionId?: string) => string | undefined;
}>();
</script>

<template>
  <n-card class="panel-card detail-card" size="small">
    <div class="panel-card__header">
      <div>
        <p class="section-eyebrow">{{ "执行会话" }}</p>
        <h2>{{ "任务绑定的会话视图" }}</h2>
      </div>
      <n-tag size="small" round>{{ sessionCount }}</n-tag>
    </div>

    <div v-if="visibleSessions.length > 0" class="detail-stack">
      <article
        v-for="session in visibleSessions"
        :key="session.sessionId ?? session.label"
        class="approval-card detail-item-card"
      >
        <div class="detail-item-card__top">
          <div>
            <span class="approval-card__lane">{{ session.label }}</span>
            <strong>{{ session.agentId }}</strong>
          </div>
          <n-tag :type="statusTagType(session.status)" size="small">{{ statusLabel(session.status) }}</n-tag>
        </div>
        <p class="panel-card__body">{{ sessionSourceLabel(session.sourceMode) }}</p>
        <p>{{ session.latestActivitySummary }}</p>
        <RouterLink v-if="sessionLink(session.sessionId)" class="ghost-link detail-item-card__link" :to="sessionLink(session.sessionId)!">
          {{ "打开会话详情" }}
        </RouterLink>
      </article>
      <n-button v-if="hasMoreSessions" quaternary size="small" @click="loadMoreSessions">
        {{ "加载更多会话" }}
      </n-button>
    </div>
    <n-empty
      v-else
      class="panel-card__empty-state"
      :description="'当前没有可回放的会话窗口。'"
      size="small"
    />
  </n-card>
</template>
