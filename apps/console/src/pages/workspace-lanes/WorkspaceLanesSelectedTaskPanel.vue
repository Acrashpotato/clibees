<script setup lang="ts">
import { NButton, NCard, NEmpty, NTag } from "naive-ui";
import { RouterLink } from "vue-router";

import type {
  TaskBoardProjectionRiskLevel,
  TaskBoardProjectionStatus,
  TaskBoardTaskNode,
} from "../../task-board-projection";

const props = defineProps<{
  currentTaskId?: string;
  selectedTask?: TaskBoardTaskNode;
  selectedTaskOrdinal: number;
  orderedTaskCount: number;
  hasPreviousTask: boolean;
  hasNextTask: boolean;
  statusLabel: (status: TaskBoardProjectionStatus) => string;
  riskLabel: (riskLevel: TaskBoardProjectionRiskLevel) => string;
  taskPath: (taskId: string) => string | undefined;
  sessionTitle: (task: TaskBoardTaskNode) => string;
  sessionRelation: (task: TaskBoardTaskNode) => string;
  sourceModeLabel: (sourceMode: TaskBoardTaskNode["retry"]["sourceMode"] | NonNullable<TaskBoardTaskNode["activeSession"]>["sourceMode"]) => string;
  retrySummary: (task: TaskBoardTaskNode) => string;
  showPreviousTask: () => void;
  showNextTask: () => void;
}>();

function statusTagType(status: TaskBoardProjectionStatus): "default" | "info" | "success" | "warning" | "error" {
  switch (status) {
    case "running":
      return "info";
    case "completed":
      return "success";
    case "awaiting_approval":
    case "blocked":
      return "warning";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

function riskTagType(riskLevel: TaskBoardProjectionRiskLevel): "default" | "warning" | "error" {
  switch (riskLevel) {
    case "high":
      return "error";
    case "medium":
      return "warning";
    default:
      return "default";
  }
}
</script>

<template>
  <n-card class="panel-card task-board-selected" size="small">
    <div class="panel-card__header">
      <div>
        <p class="section-eyebrow">{{ "任务详情分区" }}</p>
        <h2>{{ props.selectedTask?.title ?? "当前未选择任务" }}</h2>
      </div>
      <div class="task-board-node-rail__controls">
        <n-button quaternary size="small" :disabled="!props.hasPreviousTask" @click="props.showPreviousTask">
          {{ "上一个" }}
        </n-button>
        <span class="flow-pill">{{ props.selectedTaskOrdinal }} / {{ props.orderedTaskCount }}</span>
        <n-button quaternary size="small" :disabled="!props.hasNextTask" @click="props.showNextTask">
          {{ "下一个" }}
        </n-button>
      </div>
    </div>

    <article
      v-if="props.selectedTask"
      class="task-node-card task-board-node-detail task-board-node-detail--panel"
      :data-current="props.selectedTask.taskId === props.currentTaskId"
      :data-status="props.selectedTask.status"
    >
      <div class="task-node-card__top">
        <div>
          <p class="lane-panel__eyebrow">{{ props.selectedTask.taskId }}</p>
          <h3>{{ props.selectedTask.title }}</h3>
        </div>
        <div class="lane-panel__badges">
          <n-tag :type="statusTagType(props.selectedTask.status)" size="small">
            {{ props.statusLabel(props.selectedTask.status) }}
          </n-tag>
          <n-tag :type="riskTagType(props.selectedTask.riskLevel)" size="small">
            {{ props.riskLabel(props.selectedTask.riskLevel) }}
          </n-tag>
        </div>
      </div>

      <div class="task-node-card__meta">
        <div class="summary-card">
          <span>{{ "负责人" }}</span>
          <strong>{{ props.selectedTask.ownerLabel }}</strong>
        </div>
        <div class="summary-card">
          <span>{{ "任务类型" }}</span>
          <strong>{{ props.selectedTask.kind }}</strong>
        </div>
        <div class="summary-card">
          <span>{{ "最后活动" }}</span>
          <strong>{{ props.selectedTask.latestActivityAt }}</strong>
        </div>
        <div class="summary-card">
          <span>{{ "下游任务" }}</span>
          <strong>{{ props.selectedTask.downstreamTaskIds.length }}</strong>
        </div>
      </div>

      <section class="task-node-card__section">
        <strong>{{ props.selectedTask.statusReason }}</strong>
        <p class="panel-card__body">{{ props.selectedTask.latestActivitySummary }}</p>
        <p v-if="props.selectedTask.waitingReason" class="task-node-card__reason">{{ props.selectedTask.waitingReason }}</p>
      </section>

      <section class="task-node-card__section">
        <div class="task-node-card__section-header">
          <strong>{{ "依赖关系" }}</strong>
          <span class="flow-pill">{{ "深度" }} {{ props.selectedTask.depth }}</span>
        </div>
        <div class="task-node-card__list">
          <span v-if="props.selectedTask.dependsOn.length === 0" class="task-node-card__pill">
            {{ "无上游依赖" }}
          </span>
          <span
            v-for="dependencyId in props.selectedTask.dependsOn"
            :key="dependencyId"
            class="task-node-card__pill"
          >
            {{ "依赖" }} {{ dependencyId }}
          </span>
        </div>
        <div class="task-node-card__list">
          <span v-if="props.selectedTask.downstreamTaskIds.length === 0" class="task-node-card__pill">
            {{ "无下游任务" }}
          </span>
          <span
            v-for="downstreamTaskId in props.selectedTask.downstreamTaskIds"
            :key="downstreamTaskId"
            class="task-node-card__pill"
          >
            {{ "下游" }} {{ downstreamTaskId }}
          </span>
        </div>
      </section>

      <section class="task-node-card__section">
        <div class="task-node-card__section-header">
          <strong>{{ "任务与会话" }}</strong>
          <span class="flow-pill">{{ props.sessionTitle(props.selectedTask) }}</span>
        </div>
        <template v-if="props.selectedTask.activeSession">
          <div class="task-node-card__meta">
            <div class="summary-card">
              <span>{{ "代理" }}</span>
              <strong>{{ props.selectedTask.activeSession.agentId }}</strong>
            </div>
            <div class="summary-card">
              <span>{{ "审批" }}</span>
              <strong>{{ props.selectedTask.activeSession.pendingApprovalCount }}</strong>
            </div>
            <div class="summary-card">
              <span>{{ "最后活动" }}</span>
              <strong>{{ props.selectedTask.activeSession.lastActivityAt }}</strong>
            </div>
            <div class="summary-card">
              <span>{{ "会话来源" }}</span>
              <strong>{{ props.sourceModeLabel(props.selectedTask.activeSession.sourceMode) }}</strong>
            </div>
          </div>
        </template>
        <p class="panel-card__body">{{ props.sessionRelation(props.selectedTask) }}</p>
      </section>

      <section class="task-node-card__section">
        <div class="task-node-card__section-header">
          <strong>{{ "重试与重排队" }}</strong>
          <span class="flow-pill">{{ props.sourceModeLabel(props.selectedTask.retry.sourceMode) }}</span>
        </div>
        <div class="task-node-card__meta">
          <div class="summary-card">
            <span>{{ "已尝试次数" }}</span>
            <strong>{{ props.selectedTask.retry.attempts ?? "-" }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ "最大尝试次数" }}</span>
            <strong>{{ props.selectedTask.retry.maxAttempts }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ "可重试" }}</span>
            <strong>{{ props.selectedTask.retry.retryable ? "是" : "否" }}</strong>
          </div>
          <div class="summary-card">
            <span>{{ "建议重排队" }}</span>
            <strong>{{ props.selectedTask.retry.requeueRecommended ? "建议" : "否" }}</strong>
          </div>
        </div>
        <p class="panel-card__body">{{ props.retrySummary(props.selectedTask) }}</p>
        <p v-if="props.selectedTask.retry.lastFailureAt" class="task-node-card__reason">
          {{ "最近失败时间" }}: {{ props.selectedTask.retry.lastFailureAt }}
        </p>
      </section>

      <div class="task-node-card__footer">
        <RouterLink v-if="props.taskPath(props.selectedTask.taskId)" class="ghost-link" :to="props.taskPath(props.selectedTask.taskId)!">
          {{ "打开任务/会话入口" }}
        </RouterLink>
      </div>
    </article>

    <n-empty
      v-else
      class="panel-card__empty-state"
      :description="'请先在图谱分区选择一个任务。'"
      size="small"
    />
  </n-card>
</template>
