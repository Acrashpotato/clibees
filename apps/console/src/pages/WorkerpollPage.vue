<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { getWorkerpollProjection } from "../api";
import {
  createEmptyWorkerpollProjection,
  type WorkerpollProjectionView,
  type WorkerpollTaskItem,
} from "../workerpoll-projection";
import { usePreferences } from "../composables/usePreferences";

const route = useRoute();
const { isZh } = usePreferences();

const runId = computed(() =>
  typeof route.params.runId === "string" ? route.params.runId : "",
);
const projection = ref<WorkerpollProjectionView>(createEmptyWorkerpollProjection());
const loading = ref(false);
const error = ref("");

const riskTasks = computed(() =>
  projection.value.tasks.filter((task) => task.matchStatus !== "matched"),
);

const summaryCards = computed(() => [
  {
    id: "workers",
    label: copy("员工数量", "Workers"),
    value: String(projection.value.summary.workerCount),
  },
  {
    id: "dynamic",
    label: copy("动态员工", "Dynamic workers"),
    value: String(projection.value.summary.dynamicWorkerCount),
  },
  {
    id: "tasks",
    label: copy("任务数量", "Tasks"),
    value: String(projection.value.summary.taskCount),
  },
  {
    id: "uncovered",
    label: copy("未覆盖任务", "Uncovered tasks"),
    value: String(projection.value.summary.uncoveredTaskCount),
  },
]);

function copy(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

function matchLabel(task: WorkerpollTaskItem): string {
  switch (task.matchStatus) {
    case "matched":
      return copy("匹配", "Matched");
    case "mismatched":
      return copy("不匹配", "Mismatched");
    case "capability_gap":
      return copy("能力缺口", "Capability gap");
    default:
      return copy("未分配", "Unassigned");
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

async function loadProjection(targetRunId: string): Promise<void> {
  if (!targetRunId) {
    projection.value = createEmptyWorkerpollProjection();
    error.value = copy("缺少 runId，无法打开工位池页面。", "Missing runId, so workerpoll page cannot be opened.");
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
        <p class="section-eyebrow">{{ copy("员工调度", "Workerpool") }}</p>
        <h1>{{ copy("员工匹配看板", "Worker matching board") }}</h1>
      </div>
      <div class="workerpoll-toolbar">
        <span class="flow-pill">run {{ runId || "-" }}</span>
        <button
          class="ghost-button"
          type="button"
          :disabled="loading || !runId"
          @click="runId && loadProjection(runId)"
        >
          {{ copy("刷新", "Refresh") }}
        </button>
      </div>
    </div>

    <p v-if="error" class="form-error">{{ error }}</p>

    <section class="status-bar workspace-hero">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ copy("运行摘要", "Run summary") }}</p>
          <h2>{{ projection.run.goal }}</h2>
        </div>
        <div class="section-actions">
          <span class="status-pill" :data-status="projection.run.status">{{ projection.run.status }}</span>
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
            <p class="section-eyebrow">{{ copy("员工清单", "Workers") }}</p>
            <h2>{{ copy("可用员工能力", "Worker capabilities") }}</h2>
          </div>
          <span class="panel-chip">{{ projection.workers.length }}</span>
        </div>

        <div v-if="projection.workers.length > 0" class="workerpoll-list">
          <article v-for="worker in projection.workers" :key="worker.agentId" class="run-card">
            <div class="run-card__header">
              <strong>{{ worker.agentId }}</strong>
              <span class="flow-pill">{{ worker.source }}</span>
            </div>
            <div class="run-card__stats">
              <span>{{ copy("角色", "Role") }} {{ worker.profileIds.join(", ") || "-" }}</span>
              <span>{{ copy("能力", "Capabilities") }} {{ worker.capabilities.join(", ") || "-" }}</span>
              <span v-if="worker.command">{{ worker.command }}</span>
            </div>
          </article>
        </div>
        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ copy("当前无员工数据。", "No worker data yet.") }}</p>
        </div>
      </article>

      <article class="panel-card workerpoll-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("任务匹配", "Task matching") }}</p>
            <h2>{{ copy("高风险 / 缺口任务", "Risk and gap tasks") }}</h2>
          </div>
          <span class="panel-chip">{{ riskTasks.length }}</span>
        </div>

        <div v-if="riskTasks.length > 0" class="workerpoll-list">
          <article v-for="task in riskTasks" :key="task.taskId" class="run-card">
            <div class="run-card__header">
              <strong>{{ task.title }}</strong>
              <span class="status-pill" :data-status="matchPill(task)">{{ matchLabel(task) }}</span>
            </div>
            <div class="run-card__stats">
              <span>{{ copy("需求", "Need") }} {{ task.requiredCapabilities.join(", ") || "-" }}</span>
              <span>{{ copy("分配", "Assigned") }} {{ task.assignedAgent ?? "-" }}</span>
              <span>{{ copy("候选", "Candidates") }} {{ task.compatibleWorkers.join(", ") || "-" }}</span>
            </div>
          </article>
        </div>
        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">
            {{ copy("当前所有任务均已匹配。", "All tasks are matched in the current projection.") }}
          </p>
        </div>
      </article>
    </section>
  </section>
</template>
