<script setup lang="ts">
import { NCard, NTag } from "naive-ui";

import type { TaskDetailProjectionView } from "../../detail-projection";

defineProps<{
  overview: TaskDetailProjectionView["overview"];
  validation: TaskDetailProjectionView["validation"];
  latestApproval?: TaskDetailProjectionView["latestApproval"];
  requirementGroups: Array<{
    id: string;
    title: string;
    items: string[];
    empty: string;
  }>;
  validationLabel: (state: TaskDetailProjectionView["validation"]["state"]) => string;
  validationTagType: (state: string) => "warning" | "success" | "error";
  approvalStateLabel: (state: "pending" | "approved" | "rejected") => string;
  sourceModeLabel: (sourceMode: string) => string;
}>();
</script>

<template>
  <div class="detail-grid detail-grid--support">
    <n-card class="panel-card detail-card" size="small">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "任务概况" }}</p>
          <h2>{{ "任务目标与当前判断" }}</h2>
        </div>
        <n-tag size="small">{{ overview.kind }}</n-tag>
      </div>

      <div class="focus-panel__status-block">
        <strong class="focus-panel__status">{{ overview.latestActivitySummary }}</strong>
        <p class="panel-card__body">{{ overview.goal || "当前没有单独的任务 goal 文本。" }}</p>
      </div>

      <div class="detail-stack">
        <article v-for="group in requirementGroups" :key="group.id" class="detail-subcard">
          <strong>{{ group.title }}</strong>
          <ul v-if="group.items.length > 0" class="health-list">
            <li v-for="item in group.items" :key="item">{{ item }}</li>
          </ul>
          <p v-else class="panel-card__body">{{ group.empty }}</p>
        </article>
      </div>
    </n-card>

    <n-card class="panel-card detail-card" size="small">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "验证摘要" }}</p>
          <h2>{{ "当前验证结论" }}</h2>
        </div>
        <n-tag :type="validationTagType(validation.state)" size="small">
          {{ validationLabel(validation.state) }}
        </n-tag>
      </div>

      <div class="detail-stack">
        <div class="focus-panel__status-block">
          <strong class="focus-panel__status">{{ validation.summary }}</strong>
          <p class="panel-card__body">{{ sourceModeLabel(validation.sourceMode) }}</p>
        </div>
        <ul v-if="validation.details.length > 0" class="health-list">
          <li v-for="detail in validation.details" :key="detail">{{ detail }}</li>
        </ul>
        <p v-if="validation.updatedAt" class="panel-card__body">
          {{ "更新时间" }}: {{ validation.updatedAt }}
        </p>
      </div>

      <div v-if="latestApproval" class="detail-stack">
        <div class="detail-chip detail-chip--compact">
          <span>{{ "最近审批" }}</span>
          <strong>{{ approvalStateLabel(latestApproval.state) }}</strong>
        </div>
        <p>{{ latestApproval.summary }}</p>
      </div>
    </n-card>
  </div>
</template>
