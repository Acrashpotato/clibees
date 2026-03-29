<script setup lang="ts">
import {
  ElForm,
  ElFormItem,
  ElInputNumber,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElSelect,
  ElSwitch,
} from "element-plus";
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import {
  useConsoleSettings,
  type ApprovalFilter,
  type ConsoleSettings,
  type InspectDefaultRunSource,
  type RunOpenTarget,
} from "../composables/useConsoleSettings";
import MultiAgentSettingsSection from "./settings/MultiAgentSettingsSection.vue";
import SettingsShell from "./settings/SettingsShell.vue";
import {
  getSettingsSectionIdFromRouteName,
  getSettingsSectionMeta,
  getSettingsSectionPath,
  settingsSections,
  type SettingsSectionId,
} from "./settings/settings-sections";
import { useSettingsSectionNavigation } from "./settings/useSettingsSectionNavigation";

const route = useRoute();
const router = useRouter();
const { limits, saveConsoleSettings, settings } = useConsoleSettings();

const runSectionMeta = getSettingsSectionMeta("run");
const approvalsSectionMeta = getSettingsSectionMeta("approvals");
const inspectSectionMeta = getSettingsSectionMeta("inspect");
const workspaceSectionMeta = getSettingsSectionMeta("workspace");
const orderedSectionIds = settingsSections.map((section) => section.id);

const form = ref<ConsoleSettings>(cloneSettings(settings.value));
const pendingScrollBehavior = shallowRef<ScrollBehavior>("auto");
const syncingForm = shallowRef(false);

const activeRouteSection = computed<SettingsSectionId>(() => {
  const routeName = typeof route.name === "string" ? route.name : "";
  return getSettingsSectionIdFromRouteName(routeName);
});

const {
  currentSection,
  scrollToSection,
  setSectionElement,
} = useSettingsSectionNavigation(orderedSectionIds);

const activeSection = computed<SettingsSectionId>(() => currentSection.value ?? activeRouteSection.value);
const normalizedForm = computed<ConsoleSettings>(() => normalizeForm(form.value));

const cliSelectOptions = [
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

function scheduleScroll(sectionId: SettingsSectionId, behavior: ScrollBehavior): void {
  void nextTick(() => {
    const runScroll = () => {
      scrollToSection(sectionId, behavior);
    };

    if (typeof window === "undefined") {
      runScroll();
      return;
    }

    window.requestAnimationFrame(runScroll);
  });
}

async function navigateSection(sectionId: SettingsSectionId): Promise<void> {
  if (sectionId === activeRouteSection.value) {
    scheduleScroll(sectionId, "smooth");
    return;
  }

  pendingScrollBehavior.value = "smooth";
  await router.push(getSettingsSectionPath(sectionId));
}

watch(
  activeRouteSection,
  (sectionId) => {
    const behavior = pendingScrollBehavior.value;
    pendingScrollBehavior.value = "auto";
    scheduleScroll(sectionId, behavior);
  },
  { immediate: true, flush: "post" },
);

watch(
  normalizedForm,
  (normalizedValue) => {
    if (syncingForm.value) {
      return;
    }

    const currentSettings = normalizeForm(settings.value);
    if (JSON.stringify(normalizedValue) === JSON.stringify(currentSettings)) {
      return;
    }

    syncingForm.value = true;
    saveConsoleSettings(cloneSettings(normalizedValue));
    form.value = cloneSettings(normalizedValue);
    syncingForm.value = false;
  },
  { deep: true },
);

watch(
  settings,
  (nextSettings) => {
    if (syncingForm.value) {
      return;
    }

    const normalizedSettings = normalizeForm(nextSettings);
    if (JSON.stringify(form.value) === JSON.stringify(normalizedSettings)) {
      return;
    }

    form.value = cloneSettings(normalizedSettings);
  },
  { deep: true },
);
</script>

<template>
  <SettingsShell :active-section="activeSection" @navigate-section="navigateSection">
    <div ref="settingsScrollContainer" class="settings-scroll-panel">
      <div class="settings-page">
        <section
          :ref="setSectionElement('run')"
          class="panel-card settings-form-section settings-page__section"
        >
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ runSectionMeta.eyebrow }}</p>
              <h2>{{ runSectionMeta.title }}</h2>
              <p class="settings-section-description">{{ runSectionMeta.description }}</p>
            </div>
          </div>

          <ElForm label-position="top" class="settings-form">
            <ElFormItem label="默认 CLI">
              <ElSelect v-model="form.runDefaultCli">
                <ElOption
                  v-for="option in cliSelectOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </ElSelect>
            </ElFormItem>

            <div class="settings-switch-grid">
              <label class="settings-switch-card">
                <span class="form-label">创建后自动启动 CLI</span>
                <ElSwitch v-model="form.runAutoResume" />
              </label>
              <label class="settings-switch-card">
                <span class="form-label">允许工作区外写入</span>
                <ElSwitch v-model="form.runAllowOutsideWorkspaceWrites" />
              </label>
            </div>

            <ElFormItem class="settings-form__wide-field" label="创建完成后默认打开">
              <ElRadioGroup v-model="form.runOpenTarget" class="settings-radio-grid settings-choice-grid">
                <ElRadio v-for="item in runOpenTargetOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </ElRadio>
              </ElRadioGroup>
            </ElFormItem>
          </ElForm>
        </section>

        <section
          :ref="setSectionElement('approvals')"
          class="panel-card settings-form-section settings-page__section"
        >
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ approvalsSectionMeta.eyebrow }}</p>
              <h2>{{ approvalsSectionMeta.title }}</h2>
              <p class="settings-section-description">{{ approvalsSectionMeta.description }}</p>
            </div>
          </div>

          <ElForm label-position="top" class="settings-form settings-form__compact-grid">
            <ElFormItem label="默认筛选">
              <ElSelect v-model="form.approvalsDefaultFilter">
                <ElOption
                  v-for="item in approvalFilterOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="请求条数上限">
              <ElInputNumber
                v-model="form.approvalsFetchLimit"
                :min="limits.approvalLimitMin"
                :max="limits.approvalLimitMax"
                :step="10"
              />
            </ElFormItem>
            <ElFormItem label="自动刷新（秒，0=关闭）">
              <ElInputNumber
                v-model="form.approvalsAutoRefreshSec"
                :min="limits.autoRefreshMinSec"
                :max="limits.autoRefreshMaxSec"
                :step="5"
              />
            </ElFormItem>
          </ElForm>
        </section>

        <section
          :ref="setSectionElement('inspect')"
          class="panel-card settings-form-section settings-page__section"
        >
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ inspectSectionMeta.eyebrow }}</p>
              <h2>{{ inspectSectionMeta.title }}</h2>
              <p class="settings-section-description">{{ inspectSectionMeta.description }}</p>
            </div>
          </div>

          <ElForm label-position="top" class="settings-form settings-form__compact-grid">
            <ElFormItem class="settings-form__wide-field" label="默认 run 选择策略">
              <ElRadioGroup v-model="form.inspectDefaultRunSource" class="settings-radio-grid settings-choice-grid">
                <ElRadio v-for="item in inspectSourceOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </ElRadio>
              </ElRadioGroup>
            </ElFormItem>
            <ElFormItem label="自动刷新（秒，0=关闭）">
              <ElInputNumber
                v-model="form.inspectAutoRefreshSec"
                :min="limits.autoRefreshMinSec"
                :max="limits.autoRefreshMaxSec"
                :step="5"
              />
            </ElFormItem>
          </ElForm>
        </section>

        <section
          :ref="setSectionElement('workspace')"
          class="panel-card settings-form-section settings-page__section"
        >
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ workspaceSectionMeta.eyebrow }}</p>
              <h2>{{ workspaceSectionMeta.title }}</h2>
              <p class="settings-section-description">{{ workspaceSectionMeta.description }}</p>
            </div>
          </div>

          <ElForm label-position="top" class="settings-form settings-form__compact-grid">
            <ElFormItem label="自动刷新间隔（秒）">
              <ElInputNumber
                v-model="form.workspaceAutoRefreshSec"
                :min="limits.workspaceRefreshMinSec"
                :max="limits.workspaceRefreshMaxSec"
                :step="1"
              />
            </ElFormItem>
          </ElForm>
        </section>

        <section
          :ref="setSectionElement('multi-agent')"
          class="settings-page__section settings-page__section--full"
        >
          <MultiAgentSettingsSection />
        </section>
      </div>
    </div>
  </SettingsShell>
</template>
