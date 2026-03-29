<script setup lang="ts">
import type { RunSummaryView } from "../../types";

defineProps<{
  run: RunSummaryView;
  copying: boolean;
  resuming: boolean;
  statusTone: (status: RunSummaryView["status"]) => "running" | "awaiting_approval" | "paused" | "completed" | "failed";
}>();

defineEmits<{
  resume: [];
  copy: [];
}>();

function statusLabel(status: RunSummaryView["status"]): string {
  switch (status) {
    case "awaiting_approval":
      return "待审批";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "running":
      return "运行中";
    default:
      return "已暂停";
  }
}
</script>

<template>
  <section class="run-overview-hero panel-card">
    <div class="run-overview-hero__main">
      <div>
        <p class="section-eyebrow">当前任务</p>
        <h2>{{ run.name }}</h2>
        <p>{{ run.goal }}</p>
        <p>{{ run.runId }} · {{ run.stage }}</p>
      </div>
      <span class="status-pill" :data-status="statusTone(run.status)">{{ statusLabel(run.status) }}</span>
    </div>

    <div class="run-overview-hero__meta">
      <article class="summary-card">
        <span>最近更新时间</span>
        <strong>{{ run.updatedAt }}</strong>
      </article>
      <article class="summary-card">
        <span>阶段摘要</span>
        <strong>{{ run.summary }}</strong>
      </article>
    </div>

    <div class="run-overview-hero__actions">
      <button class="ghost-link" type="button" :disabled="resuming" @click="$emit('resume')">
        {{ resuming ? "恢复中..." : "恢复任务" }}
      </button>
      <button class="primary-link" type="button" @click="$emit('copy')">
        {{ copying ? "已复制" : "复制 ID" }}
      </button>
    </div>
  </section>
</template>
