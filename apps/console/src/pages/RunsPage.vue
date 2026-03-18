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
  copy,
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
            :placeholder="copy('搜索任务（runId / 目标）', 'Search tasks (runId / goal)')"
          />
          <button
            class="ghost-button runs-list-pane__create-trigger"
            type="button"
            :title="copy('新建任务', 'Create task')"
            @click="toggleCreatePanel"
          >
            {{ copy("新建", "New") }}
          </button>
        </div>

        <div v-if="loading" class="runs-list-pane__state">{{ copy("加载中...", "Loading...") }}</div>
        <div v-else-if="filteredRuns.length === 0" class="runs-list-pane__state">
          {{ copy("没有匹配的任务。", "No matching tasks.") }}
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
                :aria-label="copy('删除该任务及资源', 'Delete this task and resources')"
                :title="copy('删除该任务及资源', 'Delete this task and resources')"
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
        <template v-if="selectedRun">
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
                {{ resuming ? copy("恢复中...", "Resuming...") : copy("恢复任务", "Resume task") }}
              </button>
              <button
                v-if="isSubmenuRoute"
                class="icon-button runs-detail-header__back"
                type="button"
                :aria-label="copy('返回菜单', 'Back to menu')"
                :title="copy('返回菜单', 'Back to menu')"
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
                {{ copying ? copy("已复制", "Copied") : copy("复制 ID", "Copy ID") }}
              </button>
            </div>
          </header>

          <nav class="runs-submenu-bar" :aria-label="copy('运行二级入口', 'Run submenu shortcuts')">
            <RouterLink
              class="runs-submenu-button"
              :class="{ 'runs-submenu-button--active': !isSubmenuRoute || activeSubmenuLeaf === 'manager' }"
              :to="buildRunSubmenuPath(selectedRun.runId, 'manager')"
            >
              {{ copy("总管", "Manager") }}
            </RouterLink>
            <RouterLink
              class="runs-submenu-button"
              :class="{ 'runs-submenu-button--active': activeSubmenuLeaf === 'workerpoll' }"
              :to="buildRunSubmenuPath(selectedRun.runId, 'workerpoll')"
            >
              {{ copy("工位池", "Worker pool") }}
            </RouterLink>
            <RouterLink
              class="runs-submenu-button"
              :class="{ 'runs-submenu-button--active': activeSubmenuLeaf === 'workspace' }"
              :to="getRunWorkspacePath(selectedRun.runId)"
            >
              {{ copy("工作台", "Workspace") }}
            </RouterLink>
            <RouterLink
              class="runs-submenu-button"
              :class="{ 'runs-submenu-button--active': activeSubmenuLeaf === 'tasks' }"
              :to="getRunTaskBoardPath(selectedRun.runId)"
            >
              {{ copy("执行车道", "Execution lanes") }}
            </RouterLink>
            <RouterLink
              class="runs-submenu-button"
              :class="{ 'runs-submenu-button--active': activeSubmenuLeaf === 'approvals' }"
              :to="getRunApprovalsPath(selectedRun.runId)"
            >
              {{ copy("审批", "Approvals") }}
            </RouterLink>
            <RouterLink
              class="runs-submenu-button"
              :class="{ 'runs-submenu-button--active': activeSubmenuLeaf === 'inspect' }"
              :to="getRunInspectPath(selectedRun.runId)"
            >
              {{ copy("审计", "Inspect") }}
            </RouterLink>
          </nav>

          <section v-if="isSubmenuRoute" class="runs-submenu-shell">
            <RouterView />
          </section>

          <template v-else>
            <ManagerPage :run-id-override="selectedRun.runId" />

            <section class="workspace-summary-grid runs-summary-grid">
              <article class="summary-card">
                <span>{{ copy("阶段", "Stage") }}</span>
                <strong>{{ selectedRun.stage }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ copy("活跃任务", "Active tasks") }}</span>
                <strong>{{ selectedRun.activeTaskCount }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ copy("活跃会话", "Active sessions") }}</span>
                <strong>{{ selectedRun.activeSessionCount }}</strong>
              </article>
              <article class="summary-card">
                <span>{{ copy("待审批", "Pending approvals") }}</span>
                <strong>{{ selectedRun.pendingApprovalCount }}</strong>
              </article>
            </section>

            <article class="panel-card runs-summary-card">
              <p class="section-eyebrow">{{ copy("最近动态", "Latest activity") }}</p>
              <p class="panel-card__body">{{ selectedRun.summary }}</p>
            </article>
          </template>
        </template>

        <div v-else class="panel-card__empty-state">
          <p class="panel-card__body">{{ copy("请先在左侧选择一个任务查看详情。", "Select a task on the left to view details.") }}</p>
        </div>

        <article v-if="createExpanded" class="panel-card runs-create-card">
          <header class="runs-create-card__header">
            <h2>{{ copy("新建任务", "Create task") }}</h2>
            <button class="ghost-button" type="button" @click="toggleCreatePanel">
              {{ copy("关闭", "Close") }}
            </button>
          </header>

          <textarea
            v-model="createGoalInput"
            class="text-input text-input--textarea"
            rows="3"
            :placeholder="copy('输入该任务的目标...', 'Describe the goal for this task...')"
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
              <span>{{ copy("创建后自动启动", "Auto start after create") }}</span>
            </label>
          </div>

          <p v-if="createError" class="form-error">{{ createError }}</p>
          <button class="primary-button" type="button" :disabled="creating" @click="createNewRun">
            {{ creating ? copy("创建中...", "Creating...") : copy("创建任务", "Create task") }}
          </button>
        </article>
      </main>
    </div>
  </section>
</template>

