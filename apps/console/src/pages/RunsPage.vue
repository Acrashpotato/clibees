<script setup lang="ts">
import { RouterView } from "vue-router";

import CreateRunDialog from "./runs/CreateRunDialog.vue";
import LargeCreateRunEmptyState from "./runs/LargeCreateRunEmptyState.vue";
import RunOverviewHero from "./runs/RunOverviewHero.vue";
import { useRunsPageController } from "./runs/useRunsPageController";

type RunsSubmenuTab = "manager" | "workerpoll" | "workspace" | "tasks" | "approvals" | "inspect";

const {
  route,
  router,
  filteredRuns,
  selectedRun,
  loading,
  error,
  createExpanded,
  createNameInput,
  createGoalInput,
  selectedCli,
  autoResume,
  creating,
  createError,
  cliOptions,
  activeSubmenuLeaf,
  buildRunSubmenuPath,
  statusTone,
  resuming,
  copying,
  resumeSelectedRun,
  copyRunId,
  toggleCreatePanel,
  createNewRun,
} = useRunsPageController();

function updateCreateExpanded(value: boolean): void {
  if (!value && route.name === "runs-new") {
    void router.replace({
      name: "runs",
      query: route.query,
    });
    return;
  }
  createExpanded.value = value;
}

function updateCreateNameInput(value: string): void {
  createNameInput.value = value;
}

function updateCreateGoalInput(value: string): void {
  createGoalInput.value = value;
}

function updateSelectedCli(value: string): void {
  selectedCli.value = value as typeof selectedCli.value;
}

function updateAutoResume(value: boolean): void {
  autoResume.value = value;
}

async function openRunSection(leaf: RunsSubmenuTab): Promise<void> {
  if (!selectedRun.value) {
    return;
  }

  const nextPath = buildRunSubmenuPath(selectedRun.value.runId, leaf);
  if (route.fullPath === nextPath) {
    return;
  }

  await router.push(nextPath);
}

async function openManager(): Promise<void> {
  await openRunSection("manager");
}
</script>

<template>
  <section class="run-center-page workspace-page-stack">
    <CreateRunDialog
      :model-value="createExpanded"
      :create-name-input="createNameInput"
      :create-goal-input="createGoalInput"
      :selected-cli="selectedCli"
      :auto-resume="autoResume"
      :creating="creating"
      :create-error="createError"
      :cli-options="cliOptions"
      @update:model-value="updateCreateExpanded"
      @update:create-name-input="updateCreateNameInput"
      @update:create-goal-input="updateCreateGoalInput"
      @update:selected-cli="updateSelectedCli"
      @update:auto-resume="updateAutoResume"
      @submit="createNewRun"
    />

    <div v-if="error" class="n-alert-bridge n-alert-bridge--error">
      <div class="n-alert-bridge__content">{{ error }}</div>
    </div>

    <LargeCreateRunEmptyState
      v-if="!loading && filteredRuns.length === 0"
      @create="toggleCreatePanel"
    />

    <template v-else-if="selectedRun">
      <RunOverviewHero
        :run="selectedRun"
        :copying="copying"
        :resuming="resuming"
        :status-tone="statusTone"
        @resume="resumeSelectedRun"
        @copy="copyRunId"
      />

      <section v-if="!activeSubmenuLeaf" class="run-center-home panel-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">任务概览</p>
            <h2>{{ selectedRun.name }}</h2>
          </div>
          <div class="run-center-home__actions">
            <button class="ghost-link" type="button" @click="toggleCreatePanel">新建任务</button>
            <button class="primary-link" type="button" @click="openManager">进入总管</button>
          </div>
        </div>

        <p class="panel-card__body">{{ selectedRun.goal }}</p>
        <div class="run-overview-hero__meta">
          <article class="summary-card">
            <span>当前状态</span>
            <strong>{{ selectedRun.stage }}</strong>
          </article>
          <article class="summary-card">
            <span>活跃任务</span>
            <strong>{{ selectedRun.activeTaskCount }}</strong>
          </article>
          <article class="summary-card">
            <span>待审批</span>
            <strong>{{ selectedRun.pendingApprovalCount }}</strong>
          </article>
        </div>
        <p class="panel-card__body">左侧树是唯一主导航。点击任务名称会默认进入总管，展开后可继续切换工位池、工作台、执行车道、审批与审计。</p>
      </section>

      <section v-else class="run-section-content">
        <RouterView />
      </section>
    </template>

    <section v-else class="run-center-home panel-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">运行中心</p>
          <h2>从左侧选择一个任务，或直接新建</h2>
        </div>
        <button class="primary-link" type="button" @click="toggleCreatePanel">新建任务</button>
      </div>
      <p class="panel-card__body">运行中心已经切换为树形导航。任务创建后会在左侧自动展开出总管、工位池、工作台、执行车道、审批、审计六个三级菜单。</p>
    </section>
  </section>
</template>
