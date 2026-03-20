<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
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
  getRunWorkspacePath,
  getRunTaskBoardPath,
  getRunApprovalsPath,
  getRunInspectPath,
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
</script>

<template>
  <section class="workspace-page-stack runs-page">
    <p v-if="error" class="form-error">{{ error }}</p>

    <div class="runs-layout panel-card">
      <aside class="runs-list-pane">
        <div class="runs-list-pane__search">
          <input
            v-model="runSearchQuery"
            class="text-input"
            type="text"
            :placeholder="'搜索任务（runId / 目标）'"
          />
          <button
            class="ghost-button runs-list-pane__create-trigger"
            type="button"
            :title="'新建任务'"
            @click="toggleCreatePanel"
          >
            {{ "新建" }}
          </button>
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
              <button
                class="icon-button runs-list-item__delete"
                type="button"
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
              </button>
            </span>
          </div>
        </div>
      </aside>

      <main class="runs-detail-pane" :class="{ 'runs-detail-pane--submenu': isSubmenuRoute }">
        <article v-if="createExpanded" class="panel-card runs-create-card">
          <header class="runs-create-card__header">
            <h2>{{ "新建任务" }}</h2>
            <button class="ghost-button" type="button" @click="toggleCreatePanel">
              {{ "关闭" }}
            </button>
          </header>

          <textarea
            v-model="createGoalInput"
            class="text-input text-input--textarea"
            rows="3"
            :placeholder="'输入该任务的目标...'"
          ></textarea>

          <div class="runs-create-card__controls">
            <label class="runs-create-card__field">
              <span class="form-label">CLI</span>
              <select v-model="selectedCli">
                <option v-for="cli in cliOptions" :key="cli" :value="cli">{{ cli }}</option>
              </select>
            </label>
            <label class="runs-create-card__checkbox">
              <input v-model="autoResume" type="checkbox" />
              <span>{{ "创建后自动启动" }}</span>
            </label>
          </div>

          <p v-if="createError" class="form-error">{{ createError }}</p>
          <button class="primary-button" type="button" :disabled="creating" @click="createNewRun">
            {{ creating ? "创建中..." : "创建任务" }}
          </button>
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
              <span class="status-pill" :data-status="statusTone(selectedRun.status)">{{ selectedRun.status }}</span>
              <button class="ghost-button" type="button" :disabled="resuming" @click="resumeSelectedRun">
                {{ resuming ? "恢复中..." : "恢复任务" }}
              </button>
              <button
                v-if="isSubmenuRoute"
                class="icon-button runs-detail-header__back"
                type="button"
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
              </button>
              <button v-else class="ghost-button" type="button" @click="copyRunId">
                {{ copying ? "已复制" : "复制 ID" }}
              </button>
            </div>
          </header>

          <nav class="runs-submenu-bar" :aria-label="'运行二级入口'">
            <RouterLink
              class="runs-submenu-button"
              :class="{ 'runs-submenu-button--active': !isSubmenuRoute || activeSubmenuLeaf === 'manager' }"
              :to="buildRunSubmenuPath(selectedRun.runId, 'manager')"
            >
              {{ "总管" }}
            </RouterLink>
            <RouterLink
              class="runs-submenu-button"
              :class="{ 'runs-submenu-button--active': activeSubmenuLeaf === 'workerpoll' }"
              :to="buildRunSubmenuPath(selectedRun.runId, 'workerpoll')"
            >
              {{ "工位池" }}
            </RouterLink>
            <RouterLink
              class="runs-submenu-button"
              :class="{ 'runs-submenu-button--active': activeSubmenuLeaf === 'workspace' }"
              :to="getRunWorkspacePath(selectedRun.runId)"
            >
              {{ "工作台" }}
            </RouterLink>
            <RouterLink
              class="runs-submenu-button"
              :class="{ 'runs-submenu-button--active': activeSubmenuLeaf === 'tasks' }"
              :to="getRunTaskBoardPath(selectedRun.runId)"
            >
              {{ "执行车道" }}
            </RouterLink>
            <RouterLink
              class="runs-submenu-button"
              :class="{ 'runs-submenu-button--active': activeSubmenuLeaf === 'approvals' }"
              :to="getRunApprovalsPath(selectedRun.runId)"
            >
              {{ "审批" }}
            </RouterLink>
            <RouterLink
              class="runs-submenu-button"
              :class="{ 'runs-submenu-button--active': activeSubmenuLeaf === 'inspect' }"
              :to="getRunInspectPath(selectedRun.runId)"
            >
              {{ "审计" }}
            </RouterLink>
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

