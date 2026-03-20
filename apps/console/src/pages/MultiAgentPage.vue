<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";

import {
  cleanupMultiAgentData,
  getMultiAgentSummary,
  type MultiAgentCleanupResponse,
  type MultiAgentSummaryView,
} from "../multi-agent-api";

const loading = ref(false);
const actionLoading = ref(false);
const errorMessage = ref("");
const actionMessage = ref("");
const summary = ref<MultiAgentSummaryView | null>(null);
const keepRunId = ref("");

const hasRuns = computed(() => (summary.value?.runs.items.length ?? 0) > 0);
const selectedRunExists = computed(() =>
  Boolean(summary.value?.runs.items.some((run) => run.runId === keepRunId.value)),
);

const summaryCards = computed(() => [
  {
    id: "runs",
    label: "Run 目录数",
    value: String(summary.value?.runs.totalCount ?? 0),
  },
  {
    id: "runs-size",
    label: "Run 占用",
    value: formatBytes(summary.value?.runs.totalBytes ?? 0),
  },
  {
    id: "memory-records",
    label: "Memory 记录",
    value: String(summary.value?.memory.recordsCount ?? 0),
  },
  {
    id: "memory-size",
    label: "Memory 占用",
    value: formatBytes(summary.value?.memory.totalBytes ?? 0),
  },
]);


function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTime(value: string): string {
  if (!value) {
    return "未知";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

async function refreshSummary(): Promise<void> {
  loading.value = true;
  errorMessage.value = "";

  try {
    const nextSummary = await getMultiAgentSummary();
    summary.value = nextSummary;
    if (!keepRunId.value && nextSummary.runs.items.length > 0) {
      keepRunId.value = nextSummary.runs.items[0]!.runId;
    } else if (keepRunId.value && !nextSummary.runs.items.some((run) => run.runId === keepRunId.value)) {
      keepRunId.value = nextSummary.runs.items[0]?.runId ?? "";
    }
  } catch (caught) {
    errorMessage.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

function buildCleanupMessage(result: MultiAgentCleanupResponse): string {
  const removedRuns = result.removedRunIds.length;
  const removedMemory = result.memory.removed;
  return `已清理：删除 ${removedRuns} 个 run，Memory 删除 ${removedMemory} 条。`;
}

async function cleanupRuns(alsoClearMemory: boolean): Promise<void> {
  if (!selectedRunExists.value) {
    actionMessage.value = "请先选择一个需要保留的 run。";
    return;
  }

  const confirmed = window.confirm(
    alsoClearMemory
      ? "将删除除选中 run 外的全部 run，并清理 memory（仅保留该 run 关联记录）。确认继续？"
      : "将删除除选中 run 外的全部 run。确认继续？",
  );
  if (!confirmed) {
    return;
  }

  actionLoading.value = true;
  actionMessage.value = "";
  errorMessage.value = "";

  try {
    const result = await cleanupMultiAgentData({
      keepRunId: keepRunId.value,
      clearMemory: alsoClearMemory,
    });
    actionMessage.value = buildCleanupMessage(result);
    await refreshSummary();
  } catch (caught) {
    errorMessage.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    actionLoading.value = false;
  }
}

async function clearMemoryOnly(): Promise<void> {
  const confirmed = window.confirm(
    "将清空 memory（不删除 run 目录）。确认继续？",
  );
  if (!confirmed) {
    return;
  }

  actionLoading.value = true;
  actionMessage.value = "";
  errorMessage.value = "";

  try {
    const result = await cleanupMultiAgentData({
      clearMemory: true,
    });
    actionMessage.value = buildCleanupMessage(result);
    await refreshSummary();
  } catch (caught) {
    errorMessage.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    actionLoading.value = false;
  }
}

onMounted(() => {
  void refreshSummary();
});
</script>

<template>
  <section class="workspace-page-stack settings-page multi-agent-page">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">.multi-agent</p>
        <h1>{{ "运行数据管理" }}</h1>
      </div>
      <p>
        {{
          "这里用于管理 .multi-agent/state 和 .multi-agent/memory：查看占用、保留指定 run 清理其余记录，以及清空 memory。"
        }}
      </p>
    </div>

    <section class="panel-card settings-snapshot">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "当前状态" }}</p>
          <h2>{{ "数据占用摘要" }}</h2>
        </div>
        <button class="ghost-button" type="button" :disabled="loading || actionLoading" @click="refreshSummary">
          {{ loading ? "刷新中..." : "刷新" }}
        </button>
      </div>

      <div class="settings-summary-grid">
        <article v-for="card in summaryCards" :key="card.id" class="summary-card">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </article>
      </div>

      <p class="form-hint">{{ "state 根目录：" }} {{ summary?.stateRootDir ?? "-" }}</p>
      <p class="form-hint">{{ "memory 根目录：" }} {{ summary?.memoryRootDir ?? "-" }}</p>
      <p v-if="errorMessage" class="settings-error">{{ errorMessage }}</p>
      <p v-if="actionMessage" class="settings-success">{{ actionMessage }}</p>
    </section>

    <section class="panel-card settings-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "保留策略" }}</p>
          <h2>{{ "选择要保留的 run" }}</h2>
        </div>
      </div>

      <div v-if="hasRuns" class="multi-agent-run-list">
        <label
          v-for="run in summary?.runs.items ?? []"
          :key="run.runId"
          class="multi-agent-run-item"
        >
          <input v-model="keepRunId" type="radio" name="keep-run-id" :value="run.runId" />
          <div>
            <strong>{{ run.runId }}</strong>
            <p class="form-hint">{{ "更新时间：" }} {{ formatTime(run.updatedAt) }}</p>
            <p class="form-hint">{{ "占用：" }} {{ formatBytes(run.totalBytes) }}</p>
          </div>
        </label>
      </div>
      <p v-else class="form-hint">{{ "当前没有 run 目录。" }}</p>
    </section>

    <section class="panel-card settings-actions-card">
      <div class="settings-actions">
        <button
          class="primary-button"
          type="button"
          :disabled="actionLoading || !selectedRunExists"
          @click="cleanupRuns(false)"
        >
          {{ actionLoading ? "处理中..." : "仅保留选中 run" }}
        </button>
        <button
          class="ghost-button"
          type="button"
          :disabled="actionLoading || !selectedRunExists"
          @click="cleanupRuns(true)"
        >
          {{ "保留选中 run + 清理 memory" }}
        </button>
        <button class="ghost-button" type="button" :disabled="actionLoading" @click="clearMemoryOnly">
          {{ "仅清空 memory" }}
        </button>
      </div>
      <p class="form-hint">
        {{
          "清理操作不可恢复，建议先确认保留 run 是否正确。"
        }}
      </p>
      <RouterLink class="ghost-link" to="/settings">
        {{ "返回设置页" }}
      </RouterLink>
    </section>
  </section>
</template>
