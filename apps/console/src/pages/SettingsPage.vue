<script setup lang="ts">
import { computed, ref } from "vue";

import {
  useConsoleSettings,
  type ApprovalFilter,
  type ConsoleSettings,
  type InspectDefaultRunSource,
  type RunOpenTarget,
} from "../composables/useConsoleSettings";
import { usePreferences } from "../composables/usePreferences";

const { isZh } = usePreferences();
const { defaultConsoleSettings, limits, saveConsoleSettings, settings } = useConsoleSettings();

const form = ref<ConsoleSettings>(cloneSettings(settings.value));
const flashMessage = ref("");

const hasChanges = computed(
  () => JSON.stringify(form.value) !== JSON.stringify(settings.value),
);

const summaryCards = computed(() => [
  {
    id: "run-default",
    label: copy("运行默认参数", "Run defaults"),
    value: `${form.value.runDefaultCli} · ${
      form.value.runAutoResume ? copy("自动启动", "Auto start") : copy("仅创建", "Create only")
    }`,
  },
  {
    id: "run-open-target",
    label: copy("创建后跳转", "Post-create open"),
    value:
      form.value.runOpenTarget === "session"
        ? copy("会话详情", "Session detail")
        : copy("工作空间总览", "Workspace overview"),
  },
  {
    id: "run-outside-write-policy",
    label: copy("允许工作区外写入", "Outside workspace writes"),
    value: form.value.runAllowOutsideWorkspaceWrites
      ? copy("允许", "Allowed")
      : copy("禁止", "Blocked"),
  },
  {
    id: "approval-filter",
    label: copy("审批默认筛选", "Approval default filter"),
    value: approvalFilterLabel(form.value.approvalsDefaultFilter),
  },
  {
    id: "approval-refresh",
    label: copy("审批自动刷新", "Approval auto refresh"),
    value: autoRefreshLabel(form.value.approvalsAutoRefreshSec),
  },
  {
    id: "inspect-run",
    label: copy("审计默认 run", "Inspect default run"),
    value:
      form.value.inspectDefaultRunSource === "remembered"
        ? copy("上次查看", "Remembered run")
        : copy("最新运行", "Latest run"),
  },
  {
    id: "inspect-refresh",
    label: copy("审计自动刷新", "Inspect auto refresh"),
    value: autoRefreshLabel(form.value.inspectAutoRefreshSec),
  },
  {
    id: "workspace-refresh",
    label: copy("Workspace 轮询", "Workspace polling"),
    value: `${form.value.workspaceAutoRefreshSec}s`,
  },
]);

function copy(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

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
  return seconds > 0 ? `${seconds}s` : copy("关闭", "Off");
}

function approvalFilterLabel(value: ApprovalFilter): string {
  switch (value) {
    case "all":
      return copy("全部", "All");
    case "approved":
      return copy("已批准", "Approved");
    case "rejected":
      return copy("已拒绝", "Rejected");
    default:
      return copy("待审批", "Pending");
  }
}

function runOpenTargetLabel(value: RunOpenTarget): string {
  return value === "session"
    ? copy("会话详情（减少点击）", "Session detail (fewer clicks)")
    : copy("工作空间总览", "Workspace overview");
}

function inspectDefaultRunLabel(value: InspectDefaultRunSource): string {
  return value === "remembered"
    ? copy("上次查看的 run", "Last viewed run")
    : copy("最新 run", "Latest run");
}

function saveForm() {
  const normalized = normalizeForm(form.value);
  saveConsoleSettings(normalized);
  form.value = cloneSettings(settings.value);
  flashMessage.value = copy("设置已保存，所有关联页面会按新参数生效。", "Settings saved. Linked pages now use the new values.");
}

function resetDraft() {
  form.value = cloneSettings(settings.value);
  flashMessage.value = copy("已恢复到当前保存值。", "Draft reset to saved values.");
}

function restoreDefaults() {
  form.value = cloneSettings(defaultConsoleSettings);
  flashMessage.value = copy("已加载默认值，点击保存后才会生效。", "Defaults loaded. Click Save to apply.");
}
</script>

<template>
  <section class="workspace-page-stack settings-page">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ copy("设置", "Settings") }}</p>
        <h1>{{ copy("操作效率配置", "Operator efficiency settings") }}</h1>
      </div>
      <p>
        {{
          copy(
            "这些配置都直接关联已有页面行为，用于减少重复操作：运行创建默认参数、审批页筛选/刷新、审计页默认 run 和自动刷新、Workspace 轮询频率。",
            "Every option on this page now maps to current workflow behavior: run creation defaults, approval filter/refresh, inspect run selection/refresh, and workspace polling interval.",
          )
        }}
      </p>
    </div>

    <section class="panel-card settings-snapshot">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ copy("当前草稿", "Current draft") }}</p>
          <h2>{{ copy("生效配置快照", "Effective configuration snapshot") }}</h2>
        </div>
        <span class="panel-chip">{{ hasChanges ? copy("未保存", "Unsaved") : copy("已同步", "Synced") }}</span>
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
            <p class="section-eyebrow">{{ copy("运行创建", "Run creation") }}</p>
            <h2>{{ copy("减少创建时重复选择", "Reduce repetitive run creation choices") }}</h2>
          </div>
        </div>

        <label class="settings-field">
          <span class="form-label">{{ copy("默认 CLI", "Default CLI") }}</span>
          <select v-model="form.runDefaultCli" class="text-input">
            <option value="codex">codex</option>
            <option value="codefree">codefree</option>
            <option value="claude">claude</option>
          </select>
        </label>

        <label class="settings-toggle-row">
          <input v-model="form.runAutoResume" type="checkbox" />
          <span>{{ copy("创建后自动启动 CLI", "Auto-start CLI right after creation") }}</span>
        </label>

        <label class="settings-toggle-row">
          <input v-model="form.runAllowOutsideWorkspaceWrites" type="checkbox" />
          <span>
            {{
              copy(
                "允许新建 run 写入工作区外路径（allowOutsideWorkspaceWrites）",
                "Allow newly created runs to write outside workspace paths (allowOutsideWorkspaceWrites).",
              )
            }}
          </span>
        </label>

        <label class="settings-field">
          <span class="form-label">{{ copy("创建完成后默认打开", "Open by default after run creation") }}</span>
          <select v-model="form.runOpenTarget" class="text-input">
            <option value="session">{{ runOpenTargetLabel("session") }}</option>
            <option value="workspace">{{ runOpenTargetLabel("workspace") }}</option>
          </select>
          <span class="form-hint">
            {{
              copy(
                "会影响 Runs 页创建成功后的自动跳转目标。",
                "Controls where the Runs page navigates after successful creation.",
              )
            }}
          </span>
        </label>
      </section>

      <section class="panel-card settings-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ copy("审批页", "Approval page") }}</p>
            <h2>{{ copy("减少筛选与刷新操作", "Reduce filter and refresh operations") }}</h2>
          </div>
        </div>

        <label class="settings-field">
          <span class="form-label">{{ copy("默认筛选", "Default filter") }}</span>
          <select v-model="form.approvalsDefaultFilter" class="text-input">
            <option value="pending">{{ approvalFilterLabel("pending") }}</option>
            <option value="all">{{ approvalFilterLabel("all") }}</option>
            <option value="approved">{{ approvalFilterLabel("approved") }}</option>
            <option value="rejected">{{ approvalFilterLabel("rejected") }}</option>
          </select>
        </label>

        <label class="settings-field">
          <span class="form-label">{{ copy("请求条数上限", "Request limit") }}</span>
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
          <span class="form-label">{{ copy("自动刷新（秒，0=关闭）", "Auto refresh (seconds, 0 = off)") }}</span>
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
            <p class="section-eyebrow">{{ copy("审计页", "Inspect page") }}</p>
            <h2>{{ copy("降低 run 选择成本", "Lower run-selection overhead") }}</h2>
          </div>
        </div>

        <label class="settings-field">
          <span class="form-label">{{ copy("默认 run 选择策略", "Default run strategy") }}</span>
          <select v-model="form.inspectDefaultRunSource" class="text-input">
            <option value="remembered">{{ inspectDefaultRunLabel("remembered") }}</option>
            <option value="latest">{{ inspectDefaultRunLabel("latest") }}</option>
          </select>
          <span class="form-hint">
            {{
              copy(
                "当 URL 未指定 runId 时生效。",
                "Applied only when the URL does not include a runId.",
              )
            }}
          </span>
        </label>

        <label class="settings-field">
          <span class="form-label">{{ copy("自动刷新（秒，0=关闭）", "Auto refresh (seconds, 0 = off)") }}</span>
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
            <h2>{{ copy("轮询频率", "Polling interval") }}</h2>
          </div>
        </div>

        <label class="settings-field">
          <span class="form-label">{{ copy("自动刷新间隔（秒）", "Auto refresh interval (seconds)") }}</span>
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
              copy(
                "影响 Workspace 页面 projection 轮询间隔。",
                "Controls projection polling interval on Workspace pages.",
              )
            }}
          </span>
        </label>
      </section>
    </div>

    <section class="panel-card settings-actions-card">
      <div class="settings-actions">
        <button class="primary-button" type="button" :disabled="!hasChanges" @click="saveForm">
          {{ copy("保存设置", "Save settings") }}
        </button>
        <button class="ghost-button" type="button" :disabled="!hasChanges" @click="resetDraft">
          {{ copy("撤销修改", "Discard changes") }}
        </button>
        <button class="ghost-button" type="button" @click="restoreDefaults">
          {{ copy("恢复默认", "Restore defaults") }}
        </button>
      </div>
      <p class="form-hint settings-feedback">
        {{
          flashMessage ||
            copy("修改后点击“保存设置”才会应用到 Runs / Approvals / Inspect / Workspace 页面。", "Changes apply to Runs / Approvals / Inspect / Workspace after Save settings.")
        }}
      </p>
    </section>
  </section>
</template>


