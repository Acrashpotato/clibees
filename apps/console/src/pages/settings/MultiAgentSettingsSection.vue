<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";

import {
  cleanupMultiAgentData,
  getMultiAgentSummary,
  type MultiAgentCleanupResponse,
  type MultiAgentSummaryView,
} from "../../multi-agent-api";
import { useNaiveDiscrete } from "../../ui/naive/discrete";

const { dialog } = useNaiveDiscrete();
const loading = shallowRef(false);
const actionLoading = shallowRef(false);
const errorMessage = shallowRef("");
const actionMessage = shallowRef("");
const summary = ref<MultiAgentSummaryView | null>(null);
const keepRunId = shallowRef("");

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
      return;
    }

    if (keepRunId.value && !nextSummary.runs.items.some((run) => run.runId === keepRunId.value)) {
      keepRunId.value = nextSummary.runs.items[0]?.runId ?? "";
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function buildCleanupMessage(result: MultiAgentCleanupResponse): string {
  const removedRuns = result.removedRunIds.length;
  const removedMemory = result.memory.removed;
  return `已清理：删除 ${removedRuns} 个 run，Memory 删除 ${removedMemory} 条。`;
}

function confirmAction(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const resolveOnce = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    dialog.warning({
      title,
      content,
      positiveText: "继续",
      negativeText: "取消",
      onPositiveClick: () => resolveOnce(true),
      onNegativeClick: () => resolveOnce(false),
      onClose: () => resolveOnce(false),
    });
  });
}

async function cleanupRuns(alsoClearMemory: boolean): Promise<void> {
  if (!selectedRunExists.value) {
    actionMessage.value = "请先选择一个需要保留的 run。";
    return;
  }

  const confirmed = await confirmAction(
    "确认清理 run 数据",
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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    actionLoading.value = false;
  }
}

async function clearMemoryOnly(): Promise<void> {
  const confirmed = await confirmAction(
    "确认清理 memory",
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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    actionLoading.value = false;
  }
}

onMounted(() => {
  void refreshSummary();
});
</script>

<template>
  <div class="settings-page__section-stack settings-page__section-stack--wide">
    <section class="panel-card settings-form-section settings-page__stack-item settings-page__stack-item--summary">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">多代理管理</p>
          <h2>Run 与 Memory 数据管理</h2>
          <p class="settings-section-description">查看 .multi-agent 占用情况，并管理需要保留的数据。</p>
        </div>
        <button class="ghost-link" type="button" :disabled="loading || actionLoading" @click="refreshSummary">
          {{ loading ? "刷新中..." : "刷新数据" }}
        </button>
      </div>

      <div class="settings-summary-grid">
        <article v-for="card in summaryCards" :key="card.id" class="summary-card">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </article>
      </div>

      <div class="settings-info-list">
        <p class="form-hint">{{ "state 根目录：" }} {{ summary?.stateRootDir ?? "-" }}</p>
        <p class="form-hint">{{ "memory 根目录：" }} {{ summary?.memoryRootDir ?? "-" }}</p>
        <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
        <p v-if="actionMessage" class="section-eyebrow">{{ actionMessage }}</p>
      </div>
    </section>

    <section class="panel-card settings-form-section settings-page__stack-item settings-page__stack-item--selection">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">保留策略</p>
          <h2>选择需要保留的 run</h2>
          <p class="settings-section-description">清理 run 时，会保留你当前选择的 run 目录。</p>
        </div>
      </div>

      <div v-if="hasRuns" class="multi-agent-run-list">
        <label v-for="run in summary?.runs.items ?? []" :key="run.runId" class="multi-agent-run-item">
          <input v-model="keepRunId" type="radio" name="keep-run-id" :value="run.runId" />
          <div>
            <strong>{{ run.runId }}</strong>
            <p class="form-hint">{{ "更新时间：" }} {{ formatTime(run.updatedAt) }}</p>
            <p class="form-hint">{{ "占用：" }} {{ formatBytes(run.totalBytes) }}</p>
          </div>
        </label>
      </div>
      <p v-else class="form-hint">当前没有 run 目录。</p>
    </section>

    <section class="panel-card settings-form-section settings-page__stack-item settings-page__stack-item--actions">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">危险操作</p>
          <h2>清理多代理数据</h2>
          <p class="settings-section-description">这些操作不可恢复，执行前请确认保留对象已经选择正确。</p>
        </div>
      </div>

      <div class="settings-actions settings-actions--wrap">
        <button class="primary-link" type="button" :disabled="actionLoading || !selectedRunExists" @click="cleanupRuns(false)">
          {{ actionLoading ? "处理中..." : "仅保留选中 run" }}
        </button>
        <button class="ghost-link" type="button" :disabled="actionLoading || !selectedRunExists" @click="cleanupRuns(true)">
          保留选中 run + 清理 memory
        </button>
        <button class="ghost-link" type="button" :disabled="actionLoading" @click="clearMemoryOnly">
          仅清空 memory
        </button>
      </div>
    </section>
  </div>
</template>
