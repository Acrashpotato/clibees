<script setup lang="ts">
import { computed } from "vue";
import { NButton, NCheckbox, NInput, NSelect, NTabPane, NTabs, NTag } from "naive-ui";
import { RouterView } from "vue-router";

import ManagerPage from "./ManagerPage.vue";
import { useRunsPageController } from "./runs/useRunsPageController";

const {
  route,
  router,
  runs,
  selectedRunId,
  runSearchQuery,
  loading,
  error,
  resuming,
  deletingRunId,
  copying,
  createExpanded,
  creating,
  createError,
  createGoalInput,
  selectedCli,
  autoResume,
  cliOptions,
  isRunsNewRoute,
  routeParamRunId,
  routeQueryRunId,
  scopedRouteRunId,
  submenuLeafByName,
  activeSubmenuLeaf,
  isSubmenuRoute,
  sortedRuns,
  filteredRuns,
  selectedRun,
  syncRunQuery,
  ensureSelection,
  buildRunSubmenuPath,
  selectRun,
  employeeInitial,
  statusTone,
  loadRuns,
  resumeSelectedRun,
  copyRunId,
  deleteTaskResources,
  backToSubmenuHub,
  toggleCreatePanel,
  resetCreateForm,
  createNewRun,
} = useRunsPageController();

type RunsSubmenuTab = "manager" | "workerpoll" | "workspace" | "tasks" | "approvals" | "inspect";

const runSubmenuTabs = [
  {
    name: "manager" as const,
    label: "总管",
  },
  {
    name: "workerpoll" as const,
    label: "工位池",
  },
  {
    name: "workspace" as const,
    label: "工作台",
  },
  {
    name: "tasks" as const,
    label: "执行车道",
  },
  {
    name: "approvals" as const,
    label: "审批",
  },
  {
    name: "inspect" as const,
    label: "审计",
  },
] satisfies ReadonlyArray<{
  name: RunsSubmenuTab;
  label: string;
}>;

const cliSelectOptions = computed(() =>
  cliOptions.map((cli) => ({
    label: cli,
    value: cli,
  })),
);

const activeRunsSubmenuTab = computed<RunsSubmenuTab>(() => activeSubmenuLeaf.value ?? "manager");

function switchRunSubmenu(nextTab: string): void {
  if (!selectedRun.value) {
    return;
  }

  const nextLeaf = runSubmenuTabs.find((tab) => tab.name === nextTab)?.name;
  if (!nextLeaf) {
    return;
  }

  const nextPath = buildRunSubmenuPath(selectedRun.value.runId, nextLeaf);
  if (route.fullPath === nextPath) {
    return;
  }

  void router.push(nextPath);
}
</script>

<template>
  <section class="workspace-page-stack runs-page">
    <p v-if="error" class="form-error">{{ error }}</p>

    <div class="runs-layout panel-card">
      <aside class="runs-list-pane">
        <div class="runs-list-pane__search">
          <n-input
            v-model:value="runSearchQuery"
            class="runs-list-pane__search-input"
            :placeholder="'搜索任务（runId / 目标）'"
            clearable
          />
          <n-button
            class="runs-list-pane__create-trigger"
            quaternary
            size="small"
            :title="'新建任务'"
            @click="toggleCreatePanel"
          >
            {{ "新建" }}
          </n-button>
        </div>

        <div v-if="loading" class="runs-list-pane__state">{{ "加载中..." }}</div>
        <div v-else-if="filteredRuns.length === 0" class="runs-list-pane__state">
          {{ "没有匹配的任务。" }}
        </div>

        <div v-else class="runs-list">
          <div
            v-for="run in filteredRuns"
            :key="run.runId"
            class="runs-list-item"
            role="button"
            tabindex="0"
            :data-active="selectedRun?.runId === run.runId"
            @click="selectRun(run.runId)"
            @keydown.enter.prevent="selectRun(run.runId)"
            @keydown.space.prevent="selectRun(run.runId)"
          >
            <span class="runs-list-item__identity">
              <span class="runs-list-item__avatar" :data-status="statusTone(run.status)">
                {{ employeeInitial(run) }}
              </span>
              <i class="runs-list-item__status-dot" :data-status="statusTone(run.status)"></i>
            </span>
            <span class="runs-list-item__main">
              <strong>{{ run.goal }}</strong>
              <span>{{ run.summary }}</span>
            </span>
            <span class="runs-list-item__meta">
              <small>{{ run.updatedAt }}</small>
              <n-button
                class="runs-list-item__delete"
                quaternary
                circle
                size="small"
                :disabled="deletingRunId === run.runId"
                :aria-label="'删除该任务及资源'"
                :title="'删除该任务及资源'"
                @click.stop="deleteTaskResources(run)"
              >
                <svg
                  class="runs-list-item__delete-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                  aria-hidden="true"
                >
                  <path d="M4 7h16" />
                  <path d="M9 7V5.6c0-.9.7-1.6 1.6-1.6h2.8c.9 0 1.6.7 1.6 1.6V7" />
                  <path d="M7.4 7l.8 11.4c.1.9.8 1.6 1.7 1.6h4.2c.9 0 1.6-.7 1.7-1.6L16.6 7" />
                  <path d="M10 11v5" />
                  <path d="M14 11v5" />
                </svg>
              </n-button>
            </span>
          </div>
        </div>
      </aside>

      <main class="runs-detail-pane" :class="{ 'runs-detail-pane--submenu': isSubmenuRoute }">
        <article v-if="createExpanded" class="panel-card runs-create-card">
          <header class="runs-create-card__header">
            <h2>{{ "新建任务" }}</h2>
            <n-button quaternary @click="toggleCreatePanel">
              {{ "关闭" }}
            </n-button>
          </header>

          <n-input
            v-model:value="createGoalInput"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            :placeholder="'输入该任务的目标...'"
          />

          <div class="runs-create-card__controls">
            <label class="runs-create-card__field">
              <span class="form-label">CLI</span>
              <n-select
                v-model:value="selectedCli"
                :options="cliSelectOptions"
              />
            </label>
            <label class="runs-create-card__checkbox">
              <n-checkbox v-model:checked="autoResume">
                {{ "创建后自动启动" }}
              </n-checkbox>
            </label>
          </div>

          <p v-if="createError" class="form-error">{{ createError }}</p>
          <n-button type="primary" :disabled="creating" @click="createNewRun">
            {{ creating ? "创建中..." : "创建任务" }}
          </n-button>
        </article>

        <template v-else-if="selectedRun">
          <header class="runs-detail-header">
            <div class="runs-detail-header__identity">
              <span class="runs-detail-header__avatar" :data-status="statusTone(selectedRun.status)">
                {{ employeeInitial(selectedRun) }}
              </span>
              <div>
                <h2>{{ selectedRun.goal }}</h2>
                <p>{{ selectedRun.runId }}</p>
              </div>
            </div>

            <div class="runs-detail-header__actions">
              <n-tag :type="statusTone(selectedRun.status) === 'failed' ? 'error' : statusTone(selectedRun.status) === 'completed' ? 'success' : statusTone(selectedRun.status) === 'awaiting_approval' ? 'warning' : 'info'">
                {{ selectedRun.status }}
              </n-tag>
              <n-button quaternary :disabled="resuming" @click="resumeSelectedRun">
                {{ resuming ? "恢复中..." : "恢复任务" }}
              </n-button>
              <n-button
                v-if="isSubmenuRoute"
                class="runs-detail-header__back"
                quaternary
                circle
                :aria-label="'返回菜单'"
                :title="'返回菜单'"
                @click="backToSubmenuHub"
              >
                <svg
                  class="runs-detail-header__back-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                  aria-hidden="true"
                >
                  <path d="M15 5 8 12l7 7" />
                </svg>
              </n-button>
              <n-button v-else quaternary @click="copyRunId">
                {{ copying ? "已复制" : "复制 ID" }}
              </n-button>
            </div>
          </header>

          <nav class="runs-submenu-bar" :aria-label="'运行二级入口'">
            <n-tabs
              class="runs-submenu-tabs"
              type="segment"
              animated
              :value="activeRunsSubmenuTab"
              :default-value="'manager'"
              @update:value="switchRunSubmenu"
            >
              <n-tab-pane
                v-for="tab in runSubmenuTabs"
                :key="tab.name"
                :name="tab.name"
                :tab="tab.label"
              />
            </n-tabs>
          </nav>

          <section v-if="isSubmenuRoute" class="runs-submenu-shell">
            <RouterView />
          </section>

          <template v-else>
            <ManagerPage :run-id-override="selectedRun.runId" />

            <section class="workspace-summary-grid runs-summary-grid">
              <article class="summary-card">
                <span>{{ "阶段" }}</span>
                <strong>{{ selectedRun.stage }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ "活跃任务" }}</span>
                <strong>{{ selectedRun.activeTaskCount }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ "活跃会话" }}</span>
                <strong>{{ selectedRun.activeSessionCount }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ "待审批" }}</span>
                <strong>{{ selectedRun.pendingApprovalCount }}</strong>
              </article>
            </section>

            <article class="panel-card runs-summary-card">
              <p class="section-eyebrow">{{ "最近动态" }}</p>
              <p class="panel-card__body">{{ selectedRun.summary }}</p>
            </article>
          </template>
        </template>

        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ "请先在左侧选择一个任务查看详情。" }}</p>
        </div>
      </main>
    </div>
  </section>
</template>
