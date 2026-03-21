<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NTag } from "naive-ui";
import { useRoute } from "vue-router";

import { getWorkerpollProjection } from "../api";
import { useChunkedRender } from "../composables/useChunkedRender";
import {
  createEmptyWorkerpollProjection,
  type WorkerpollProjectionView,
  type WorkerpollTaskItem,
} from "../workerpoll-projection";

const route = useRoute();

const runId = computed(() =>
  typeof route.params.runId === "string" ? route.params.runId : "",
);
const projection = ref<WorkerpollProjectionView>(createEmptyWorkerpollProjection());
const loading = ref(false);
const error = ref("");

const unmatchedTasks = computed(() =>
  projection.value.tasks.filter(
    (task) => task.matchStatus !== "matched" && !task.isManagerTask,
  ),
);
const excludedManagerTaskCount = computed(
  () => projection.value.summary.excludedManagerTaskCount,
);
const {
  visibleItems: visibleWorkers,
  hasMore: hasMoreWorkers,
  loadMore: loadMoreWorkers,
} = useChunkedRender(computed(() => projection.value.workers), {
  initialSize: 30,
  step: 30,
});
const {
  visibleItems: visibleUnmatchedTasks,
  hasMore: hasMoreUnmatchedTasks,
  loadMore: loadMoreUnmatchedTasks,
} = useChunkedRender(unmatchedTasks, {
  initialSize: 30,
  step: 30,
});

const summaryCards = computed(() => [
  {
    id: "workers",
    label: "员工数量",
    value: String(projection.value.summary.workerCount),
  },
  {
    id: "dynamic",
    label: "动态员工",
    value: String(projection.value.summary.dynamicWorkerCount),
  },
  {
    id: "tasks",
    label: "任务数量",
    value: String(projection.value.summary.taskCount),
  },
  {
    id: "uncovered",
    label: "未覆盖任务",
    value: String(projection.value.summary.uncoveredTaskCount),
  },
]);

function matchLabel(task: WorkerpollTaskItem): string {
  switch (task.matchStatus) {
    case "matched":
      return "匹配";
    case "mismatched":
      return "不匹配";
    case "capability_gap":
      return "能力缺口";
    default:
      return "未分配";
  }
}

function matchPill(task: WorkerpollTaskItem): "completed" | "awaiting_approval" | "failed" {
  if (task.matchStatus === "matched") {
    return "completed";
  }
  if (task.matchStatus === "unassigned") {
    return "awaiting_approval";
  }
  return "failed";
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

async function loadProjection(targetRunId: string): Promise<void> {
  if (!targetRunId) {
    projection.value = createEmptyWorkerpollProjection();
    error.value = "缺少 runId，无法打开工位池页面。";
    return;
  }

  loading.value = true;
  try {
    projection.value = await getWorkerpollProjection(targetRunId);
    error.value = "";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
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
  <section class="workspace-page-stack workerpoll-page">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ "员工调度" }}</p>
        <h1>{{ "员工匹配看板" }}</h1>
      </div>
      <div class="workerpoll-toolbar">
        <span class="flow-pill">run {{ runId || "-" }}</span>
        <n-button
          quaternary
          :disabled="loading || !runId"
          @click="runId && loadProjection(runId)"
        >
          {{ "刷新" }}
        </n-button>
      </div>
    </div>

    <p v-if="error" class="form-error">{{ error }}</p>

    <section class="status-bar workspace-hero">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "运行摘要" }}</p>
          <h2>{{ projection.run.goal }}</h2>
        </div>
        <div class="section-actions">
          <n-tag :type="statusTagType(projection.run.status)">{{ projection.run.status }}</n-tag>
          <span class="flow-pill">{{ projection.generatedAt || "-" }}</span>
        </div>
      </div>

      <div class="workspace-summary-grid">
        <article v-for="card in summaryCards" :key="card.id" class="summary-card">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </article>
      </div>
    </section>

    <section class="workerpoll-grid">
      <article class="panel-card workerpoll-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "员工清单" }}</p>
            <h2>{{ "可用员工能力" }}</h2>
          </div>
          <span class="panel-chip">{{ projection.workers.length }}</span>
        </div>

        <div v-if="projection.workers.length > 0" class="workerpoll-list">
          <article v-for="worker in visibleWorkers" :key="worker.agentId" class="run-card">
            <div class="run-card__header">
              <strong>{{ worker.agentId }}</strong>
              <span class="flow-pill">{{ worker.source }}</span>
            </div>
            <div class="run-card__stats">
              <span>{{ "角色" }} {{ worker.profileIds.join(", ") || "-" }}</span>
              <span>{{ "能力" }} {{ worker.capabilities.join(", ") || "-" }}</span>
              <span v-if="worker.command">{{ worker.command }}</span>
            </div>
          </article>
          <n-button v-if="hasMoreWorkers" quaternary size="small" @click="loadMoreWorkers">
            {{ "加载更多员工" }}
          </n-button>
        </div>
        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ "当前无员工数据。" }}</p>
        </div>
      </article>

      <article class="panel-card workerpoll-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "任务匹配" }}</p>
            <h2>{{ "未匹配任务" }}</h2>
          </div>
          <span class="panel-chip">{{ unmatchedTasks.length }}</span>
        </div>
        <p v-if="excludedManagerTaskCount > 0" class="panel-card__body">
          {{ `已排除管理任务 ${excludedManagerTaskCount} 条` }}
        </p>

        <div v-if="unmatchedTasks.length > 0" class="workerpoll-list">
          <article v-for="task in visibleUnmatchedTasks" :key="task.taskId" class="run-card">
            <div class="run-card__header">
              <strong>{{ task.title }}</strong>
              <span class="status-pill" :data-status="matchPill(task)">{{ matchLabel(task) }}</span>
            </div>
            <div class="run-card__stats">
              <span>{{ "需求" }} {{ task.requiredCapabilities.join(", ") || "-" }}</span>
              <span>{{ "分配" }} {{ task.assignedAgent ?? "-" }}</span>
              <span>{{ "候选" }} {{ task.compatibleWorkers.join(", ") || "-" }}</span>
            </div>
          </article>
          <n-button v-if="hasMoreUnmatchedTasks" quaternary size="small" @click="loadMoreUnmatchedTasks">
            {{ "加载更多未匹配任务" }}
          </n-button>
        </div>
        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">
            {{ "当前所有任务均已匹配。" }}
          </p>
        </div>
      </article>
    </section>
  </section>
</template>
