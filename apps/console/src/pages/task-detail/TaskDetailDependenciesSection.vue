<script setup lang="ts">
import { NButton, NCard, NTag } from "naive-ui";
import { RouterLink } from "vue-router";

import type { TaskDetailDependencyItemView } from "../../detail-projection";

defineProps<{
  visibleUpstream: readonly TaskDetailDependencyItemView[];
  hasMoreUpstream: boolean;
  loadMoreUpstream: () => void;
  visibleDownstream: readonly TaskDetailDependencyItemView[];
  hasMoreDownstream: boolean;
  loadMoreDownstream: () => void;
  statusLabel: (status: TaskDetailDependencyItemView["status"]) => string;
  statusTagType: (status: string) => "default" | "info" | "success" | "warning" | "error";
  taskLink: (item: TaskDetailDependencyItemView) => string;
}>();
</script>

<template>
  <n-card class="panel-card detail-card" size="small">
    <div class="panel-card__header">
      <div>
        <p class="section-eyebrow">{{ "依赖关系" }}</p>
        <h2>{{ "上游与下游任务" }}</h2>
      </div>
    </div>

    <div class="detail-split">
      <article class="detail-subcard">
        <strong>{{ "上游依赖" }}</strong>
        <div v-if="visibleUpstream.length > 0" class="detail-stack detail-stack--tight">
          <article v-for="item in visibleUpstream" :key="item.taskId" class="approval-card detail-item-card">
            <div class="detail-item-card__top">
              <div>
                <span class="approval-card__lane">{{ item.taskId }}</span>
                <strong>{{ item.title }}</strong>
              </div>
              <n-tag :type="statusTagType(item.status)" size="small">{{ statusLabel(item.status) }}</n-tag>
            </div>
            <p>{{ item.statusReason }}</p>
            <RouterLink class="ghost-link detail-item-card__link" :to="taskLink(item)">
              {{ "打开任务详情" }}
            </RouterLink>
          </article>
          <n-button v-if="hasMoreUpstream" quaternary size="small" @click="loadMoreUpstream">
            {{ "加载更多上游依赖" }}
          </n-button>
        </div>
        <p v-else class="panel-card__body">{{ "这个任务没有上游依赖。" }}</p>
      </article>

      <article class="detail-subcard">
        <strong>{{ "下游影响" }}</strong>
        <div v-if="visibleDownstream.length > 0" class="detail-stack detail-stack--tight">
          <article v-for="item in visibleDownstream" :key="item.taskId" class="approval-card detail-item-card">
            <div class="detail-item-card__top">
              <div>
                <span class="approval-card__lane">{{ item.taskId }}</span>
                <strong>{{ item.title }}</strong>
              </div>
              <n-tag :type="statusTagType(item.status)" size="small">{{ statusLabel(item.status) }}</n-tag>
            </div>
            <p>{{ item.statusReason }}</p>
            <RouterLink class="ghost-link detail-item-card__link" :to="taskLink(item)">
              {{ "打开任务详情" }}
            </RouterLink>
          </article>
          <n-button v-if="hasMoreDownstream" quaternary size="small" @click="loadMoreDownstream">
            {{ "加载更多下游任务" }}
          </n-button>
        </div>
        <p v-else class="panel-card__body">{{ "这个任务当前没有下游任务。" }}</p>
      </article>
    </div>
  </n-card>
</template>
