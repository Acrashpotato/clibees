<script setup lang="ts">
import { computed, ref } from "vue";
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInputNumber,
  NRadio,
  NRadioGroup,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
} from "naive-ui";
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
    value: `${form.value.runDefaultCli} · ${form.value.runAutoResume ? "自动启动" : "仅创建"}`,
  },
  {
    id: "run-open-target",
    label: "创建后跳转",
    value: form.value.runOpenTarget === "session" ? "会话详情" : "工作空间总览",
  },
  {
    id: "run-outside-write-policy",
    label: "允许工作区外写入",
    value: form.value.runAllowOutsideWorkspaceWrites ? "允许" : "禁止",
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
    value: form.value.inspectDefaultRunSource === "remembered" ? "上次查看" : "最新运行",
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

const runCliOptions = [
  { label: "codex", value: "codex" },
  { label: "codefree", value: "codefree" },
  { label: "claude", value: "claude" },
];

const approvalFilterOptions = computed(() => [
  { label: approvalFilterLabel("pending"), value: "pending" },
  { label: approvalFilterLabel("all"), value: "all" },
  { label: approvalFilterLabel("approved"), value: "approved" },
  { label: approvalFilterLabel("rejected"), value: "rejected" },
]);

const runOpenTargetOptions = computed(() => [
  { label: runOpenTargetLabel("session"), value: "session" },
  { label: runOpenTargetLabel("workspace"), value: "workspace" },
]);

const inspectSourceOptions = computed(() => [
  { label: inspectDefaultRunLabel("remembered"), value: "remembered" },
  { label: inspectDefaultRunLabel("latest"), value: "latest" },
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
    approvalsFetchLimit: clampInt(input.approvalsFetchLimit, limits.approvalLimitMin, limits.approvalLimitMax),
    approvalsAutoRefreshSec: clampInt(input.approvalsAutoRefreshSec, limits.autoRefreshMinSec, limits.autoRefreshMaxSec),
    inspectDefaultRunSource: input.inspectDefaultRunSource,
    inspectAutoRefreshSec: clampInt(input.inspectAutoRefreshSec, limits.autoRefreshMinSec, limits.autoRefreshMaxSec),
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
  return value === "session" ? "会话详情（减少点击）" : "工作空间总览";
}

function inspectDefaultRunLabel(value: InspectDefaultRunSource): string {
  return value === "remembered" ? "上次查看的 run" : "最新 run";
}

function updateApprovalsFetchLimit(value: number | null): void {
  form.value.approvalsFetchLimit = clampInt(
    Number(value ?? limits.approvalLimitMin),
    limits.approvalLimitMin,
    limits.approvalLimitMax,
  );
}

function updateApprovalsAutoRefresh(value: number | null): void {
  form.value.approvalsAutoRefreshSec = clampInt(
    Number(value ?? limits.autoRefreshMinSec),
    limits.autoRefreshMinSec,
    limits.autoRefreshMaxSec,
  );
}

function updateInspectAutoRefresh(value: number | null): void {
  form.value.inspectAutoRefreshSec = clampInt(
    Number(value ?? limits.autoRefreshMinSec),
    limits.autoRefreshMinSec,
    limits.autoRefreshMaxSec,
  );
}

function updateWorkspaceAutoRefresh(value: number | null): void {
  form.value.workspaceAutoRefreshSec = clampInt(
    Number(value ?? limits.workspaceRefreshMinSec),
    limits.workspaceRefreshMinSec,
    limits.workspaceRefreshMaxSec,
  );
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
        <n-tag :type="hasChanges ? 'warning' : 'success'" size="small" round>
          {{ hasChanges ? "未保存" : "已同步" }}
        </n-tag>
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

        <n-form class="settings-form" label-placement="top" :show-feedback="false">
          <n-form-item :label="'默认 CLI'" class="settings-field">
            <n-select
              v-model:value="form.runDefaultCli"
              :options="runCliOptions"
            />
          </n-form-item>

          <n-form-item :label="'创建行为'" class="settings-field">
            <n-space vertical>
              <n-switch v-model:value="form.runAutoResume">
                <template #checked>{{ "创建后自动启动 CLI" }}</template>
                <template #unchecked>{{ "创建后手动启动 CLI" }}</template>
              </n-switch>

              <n-switch v-model:value="form.runAllowOutsideWorkspaceWrites">
                <template #checked>{{ "允许工作区外写入" }}</template>
                <template #unchecked>{{ "禁止工作区外写入" }}</template>
              </n-switch>
            </n-space>
          </n-form-item>

          <n-form-item :label="'创建完成后默认打开'" class="settings-field">
            <n-radio-group v-model:value="form.runOpenTarget">
              <n-space vertical>
                <n-radio
                  v-for="item in runOpenTargetOptions"
                  :key="item.value"
                  :value="item.value"
                >
                  {{ item.label }}
                </n-radio>
              </n-space>
            </n-radio-group>
            <p class="form-hint">{{ "会影响 Runs 页创建成功后的自动跳转目标。" }}</p>
          </n-form-item>
        </n-form>
      </section>

      <section class="panel-card settings-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "审批页" }}</p>
            <h2>{{ "减少筛选与刷新操作" }}</h2>
          </div>
        </div>

        <n-form class="settings-form" label-placement="top" :show-feedback="false">
          <n-form-item :label="'默认筛选'" class="settings-field">
            <n-select
              v-model:value="form.approvalsDefaultFilter"
              :options="approvalFilterOptions"
            />
          </n-form-item>

          <n-form-item :label="'请求条数上限'" class="settings-field">
            <n-input-number
              :value="form.approvalsFetchLimit"
              :min="limits.approvalLimitMin"
              :max="limits.approvalLimitMax"
              :step="10"
              @update:value="updateApprovalsFetchLimit"
            />
          </n-form-item>

          <n-form-item :label="'自动刷新（秒，0=关闭）'" class="settings-field">
            <n-input-number
              :value="form.approvalsAutoRefreshSec"
              :min="limits.autoRefreshMinSec"
              :max="limits.autoRefreshMaxSec"
              :step="5"
              @update:value="updateApprovalsAutoRefresh"
            />
          </n-form-item>
        </n-form>
      </section>

      <section class="panel-card settings-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ "审计页" }}</p>
            <h2>{{ "降低 run 选择成本" }}</h2>
          </div>
        </div>

        <n-form class="settings-form" label-placement="top" :show-feedback="false">
          <n-form-item :label="'默认 run 选择策略'" class="settings-field">
            <n-radio-group v-model:value="form.inspectDefaultRunSource">
              <n-space vertical>
                <n-radio
                  v-for="item in inspectSourceOptions"
                  :key="item.value"
                  :value="item.value"
                >
                  {{ item.label }}
                </n-radio>
              </n-space>
            </n-radio-group>
            <p class="form-hint">{{ "当 URL 未指定 runId 时生效。" }}</p>
          </n-form-item>

          <n-form-item :label="'自动刷新（秒，0=关闭）'" class="settings-field">
            <n-input-number
              :value="form.inspectAutoRefreshSec"
              :min="limits.autoRefreshMinSec"
              :max="limits.autoRefreshMaxSec"
              :step="5"
              @update:value="updateInspectAutoRefresh"
            />
          </n-form-item>
        </n-form>
      </section>

      <section class="panel-card settings-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">Workspace</p>
            <h2>{{ "轮询频率" }}</h2>
          </div>
        </div>

        <n-form class="settings-form" label-placement="top" :show-feedback="false">
          <n-form-item :label="'自动刷新间隔（秒）'" class="settings-field">
            <n-input-number
              :value="form.workspaceAutoRefreshSec"
              :min="limits.workspaceRefreshMinSec"
              :max="limits.workspaceRefreshMaxSec"
              :step="1"
              @update:value="updateWorkspaceAutoRefresh"
            />
            <p class="form-hint">{{ "影响 Workspace 页面 projection 轮询间隔。" }}</p>
          </n-form-item>
        </n-form>
      </section>
    </div>

    <section class="panel-card settings-actions-card">
      <div class="settings-actions">
        <n-button type="primary" :disabled="!hasChanges" @click="saveForm">
          {{ "保存设置" }}
        </n-button>
        <n-button quaternary :disabled="!hasChanges" @click="resetDraft">
          {{ "撤销修改" }}
        </n-button>
        <n-button quaternary @click="restoreDefaults">
          {{ "恢复默认" }}
        </n-button>
      </div>
      <n-alert
        class="settings-feedback"
        :type="flashMessage ? 'success' : 'info'"
        :show-icon="false"
      >
        {{
          flashMessage ||
            "修改后点击“保存设置”才会应用到 Runs / Approvals / Inspect / Workspace 页面。"
        }}
      </n-alert>
    </section>
  </section>
</template>
