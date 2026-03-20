<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";

import {
  useConsoleSettings,
  type ApprovalFilter,
  type ConsoleSettings,
  type InspectDefaultRunSource,
  type RunOpenTarget,
} from "../composables/useConsoleSettings";
const { defaultConsoleSettings, limits, saveConsoleSettings, settings } = useConsoleSettings();

const form = ref<ConsoleSettings>(cloneSettings(settings.value));
const flashMessage = ref("");

const hasChanges = computed(
  () => JSON.stringify(form.value) !== JSON.stringify(settings.value),
);

const summaryCards = computed(() => [
  {
    id: "run-default",
    label: "运行默认参数",
    value: `${form.value.runDefaultCli} · ${
      form.value.runAutoResume ? "自动启动" : "仅创建"
    }`,
  },
  {
    id: "run-open-target",
    label: "创建后跳转",
    value:
      form.value.runOpenTarget === "session"
        ? "会话详情"
        : "工作空间总览",
  },
  {
    id: "run-outside-write-policy",
    label: "允许工作区外写入",
    value: form.value.runAllowOutsideWorkspaceWrites
      ? "允许"
      : "禁止",
  },
  {
    id: "approval-filter",
    label: "审批默认筛选",
    value: approvalFilterLabel(form.value.approvalsDefaultFilter),
  },
  {
    id: "approval-refresh",
    label: "审批自动刷新",
    value: autoRefreshLabel(form.value.approvalsAutoRefreshSec),
  },
  {
    id: "inspect-run",
    label: "审计默认 run",
    value:
      form.value.inspectDefaultRunSource === "remembered"
        ? "上次查看"
        : "最新运行",
  },
  {
    id: "inspect-refresh",
    label: "审计自动刷新",
    value: autoRefreshLabel(form.value.inspectAutoRefreshSec),
  },
  {
    id: "workspace-refresh",
    label: "Workspace 轮询",
    value: `${form.value.workspaceAutoRefreshSec}s`,
  },
]);


function cloneSettings(value: ConsoleSettings): ConsoleSettings {
  return { ...value };
}

function clampInt(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  const rounded = Math.round(value);
  return Math.max(minimum, Math.min(maximum, rounded));
}

function normalizeForm(input: ConsoleSettings): ConsoleSettings {
  return {
    runDefaultCli: input.runDefaultCli,
    runAutoResume: input.runAutoResume,
    runAllowOutsideWorkspaceWrites: input.runAllowOutsideWorkspaceWrites,
    runOpenTarget: input.runOpenTarget,
    approvalsDefaultFilter: input.approvalsDefaultFilter,
    approvalsFetchLimit: clampInt(
      input.approvalsFetchLimit,
      limits.approvalLimitMin,
      limits.approvalLimitMax,
    ),
    approvalsAutoRefreshSec: clampInt(
      input.approvalsAutoRefreshSec,
      limits.autoRefreshMinSec,
      limits.autoRefreshMaxSec,
    ),
    inspectDefaultRunSource: input.inspectDefaultRunSource,
    inspectAutoRefreshSec: clampInt(
      input.inspectAutoRefreshSec,
      limits.autoRefreshMinSec,
      limits.autoRefreshMaxSec,
    ),
    workspaceAutoRefreshSec: clampInt(
      input.workspaceAutoRefreshSec,
      limits.workspaceRefreshMinSec,
      limits.workspaceRefreshMaxSec,
    ),
  };
}

function autoRefreshLabel(seconds: number): string {
  return seconds > 0 ? `${seconds}s` : "关闭";
}

function approvalFilterLabel(value: ApprovalFilter): string {
  switch (value) {
    case "all":
      return "全部";
    case "approved":
      return "已批准";
    case "rejected":
      return "已拒绝";
    default:
      return "待审批";
  }
}

function runOpenTargetLabel(value: RunOpenTarget): string {
  return value === "session"
    ? "会话详情（减少点击）"
    : "工作空间总览";
}

function inspectDefaultRunLabel(value: InspectDefaultRunSource): string {
  return value === "remembered"
    ? "上次查看的 run"
    : "最新 run";
}

function saveForm() {
  const normalized = normalizeForm(form.value);
  saveConsoleSettings(normalized);
  form.value = cloneSettings(settings.value);
  flashMessage.value = "设置已保存，所有关联页面会按新参数生效。";
}

function resetDraft() {
  form.value = cloneSettings(settings.value);
  flashMessage.value = "已恢复到当前保存值。";
}

function restoreDefaults() {
  form.value = cloneSettings(defaultConsoleSettings);
  flashMessage.value = "已加载默认值，点击保存后才会生效。";
}
</script>

<template>
  <section class="workspace-page-stack settings-page">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ "设置" }}</p>
        <h1>{{ "操作效率配置" }}</h1>
      </div>
      <p>
        {{
          "这些配置都直接关联已有页面行为，用于减少重复操作：运行创建默认参数、审批页筛选/刷新、审计页默认 run 和自动刷新、Workspace 轮询频率。"
        }}
      </p>
    </div>

    <section class="panel-card settings-entry-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">.multi-agent</p>
          <h2>{{ "运行数据管理" }}</h2>
        </div>
        <RouterLink class="primary-link" to="/settings/multi-agent">
          {{ "打开管理页" }}
        </RouterLink>
      </div>
      <p class="form-hint">
        {{
          "查看 .multi-agent/state 和 .multi-agent/memory 占用，并执行保留 run / 清理 memory 操作。"
        }}
      </p>
    </section>

    <section class="panel-card settings-snapshot">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ "当前草稿" }}</p>
          <h2>{{ "生效配置快照" }}</h2>
        </div>
        <span class="panel-chip">{{ hasChanges ? "未保存" : "已同步" }}</span>
      </div>
      <div class="settings-summary-grid">
        <article v-for="card in summaryCards" :key="card.id" class="summary-card">
          <span>{{ card.label }}</span>
          <strong :title="card.value">{{ card.value }}</strong>
        </article>
      </div>
    </section>

    <div class="settings-grid">
      <section class="panel-card settings-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "运行创建" }}</p>
            <h2>{{ "减少创建时重复选择" }}</h2>
          </div>
        </div>

        <label class="settings-field">
          <span class="form-label">{{ "默认 CLI" }}</span>
          <select v-model="form.runDefaultCli" class="text-input">
            <option value="codex">codex</option>
            <option value="codefree">codefree</option>
            <option value="claude">claude</option>
          </select>
        </label>

        <label class="settings-toggle-row">
          <input v-model="form.runAutoResume" type="checkbox" />
          <span>{{ "创建后自动启动 CLI" }}</span>
        </label>

        <label class="settings-toggle-row">
          <input v-model="form.runAllowOutsideWorkspaceWrites" type="checkbox" />
          <span>
            {{
              "允许新建 run 写入工作区外路径（allowOutsideWorkspaceWrites）"
            }}
          </span>
        </label>

        <label class="settings-field">
          <span class="form-label">{{ "创建完成后默认打开" }}</span>
          <select v-model="form.runOpenTarget" class="text-input">
            <option value="session">{{ runOpenTargetLabel("session") }}</option>
            <option value="workspace">{{ runOpenTargetLabel("workspace") }}</option>
          </select>
          <span class="form-hint">
            {{
              "会影响 Runs 页创建成功后的自动跳转目标。"
            }}
          </span>
        </label>
      </section>

      <section class="panel-card settings-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "审批页" }}</p>
            <h2>{{ "减少筛选与刷新操作" }}</h2>
          </div>
        </div>

        <label class="settings-field">
          <span class="form-label">{{ "默认筛选" }}</span>
          <select v-model="form.approvalsDefaultFilter" class="text-input">
            <option value="pending">{{ approvalFilterLabel("pending") }}</option>
            <option value="all">{{ approvalFilterLabel("all") }}</option>
            <option value="approved">{{ approvalFilterLabel("approved") }}</option>
            <option value="rejected">{{ approvalFilterLabel("rejected") }}</option>
          </select>
        </label>

        <label class="settings-field">
          <span class="form-label">{{ "请求条数上限" }}</span>
          <input
            v-model.number="form.approvalsFetchLimit"
            class="text-input"
            type="number"
            :min="limits.approvalLimitMin"
            :max="limits.approvalLimitMax"
            step="10"
          />
        </label>

        <label class="settings-field">
          <span class="form-label">{{ "自动刷新（秒，0=关闭）" }}</span>
          <input
            v-model.number="form.approvalsAutoRefreshSec"
            class="text-input"
            type="number"
            :min="limits.autoRefreshMinSec"
            :max="limits.autoRefreshMaxSec"
            step="5"
          />
        </label>
      </section>

      <section class="panel-card settings-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "审计页" }}</p>
            <h2>{{ "降低 run 选择成本" }}</h2>
          </div>
        </div>

        <label class="settings-field">
          <span class="form-label">{{ "默认 run 选择策略" }}</span>
          <select v-model="form.inspectDefaultRunSource" class="text-input">
            <option value="remembered">{{ inspectDefaultRunLabel("remembered") }}</option>
            <option value="latest">{{ inspectDefaultRunLabel("latest") }}</option>
          </select>
          <span class="form-hint">
            {{
              "当 URL 未指定 runId 时生效。"
            }}
          </span>
        </label>

        <label class="settings-field">
          <span class="form-label">{{ "自动刷新（秒，0=关闭）" }}</span>
          <input
            v-model.number="form.inspectAutoRefreshSec"
            class="text-input"
            type="number"
            :min="limits.autoRefreshMinSec"
            :max="limits.autoRefreshMaxSec"
            step="5"
          />
        </label>
      </section>

      <section class="panel-card settings-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">Workspace</p>
            <h2>{{ "轮询频率" }}</h2>
          </div>
        </div>

        <label class="settings-field">
          <span class="form-label">{{ "自动刷新间隔（秒）" }}</span>
          <input
            v-model.number="form.workspaceAutoRefreshSec"
            class="text-input"
            type="number"
            :min="limits.workspaceRefreshMinSec"
            :max="limits.workspaceRefreshMaxSec"
            step="1"
          />
          <span class="form-hint">
            {{
              "影响 Workspace 页面 projection 轮询间隔。"
            }}
          </span>
        </label>
      </section>
    </div>

    <section class="panel-card settings-actions-card">
      <div class="settings-actions">
        <button class="primary-button" type="button" :disabled="!hasChanges" @click="saveForm">
          {{ "保存设置" }}
        </button>
        <button class="ghost-button" type="button" :disabled="!hasChanges" @click="resetDraft">
          {{ "撤销修改" }}
        </button>
        <button class="ghost-button" type="button" @click="restoreDefaults">
          {{ "恢复默认" }}
        </button>
      </div>
      <p class="form-hint settings-feedback">
        {{
          flashMessage ||
            "修改后点击“保存设置”才会应用到 Runs / Approvals / Inspect / Workspace 页面。"
        }}
      </p>
    </section>
  </section>
</template>


