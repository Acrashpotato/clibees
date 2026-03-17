<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";

import { createRun, deleteRun as deleteRunRequest, listRuns, resumeRun, type SelectedCli } from "../api";
import { useConsoleSettings } from "../composables/useConsoleSettings";
import { usePreferences } from "../composables/usePreferences";
import type { RunSummaryView } from "../types";
import { getRunApprovalsPath, getRunInspectPath, getRunTaskBoardPath, getRunWorkspacePath } from "../workspace";

const route = useRoute();
const router = useRouter();
const { isZh } = usePreferences();
const { settings } = useConsoleSettings();

const runs = ref<RunSummaryView[]>([]);
const selectedRunId = ref("");
const runSearchQuery = ref("");
const loading = ref(false);
const error = ref("");
const resuming = ref(false);
const deletingRunId = ref("");
const copying = ref(false);
const createExpanded = ref(false);
const creating = ref(false);
const createError = ref("");

const createGoalInput = ref("");
const selectedCli = ref<SelectedCli>(settings.value.runDefaultCli);
const autoResume = ref(settings.value.runAutoResume);
const cliOptions: ReadonlyArray<SelectedCli> = ["codex", "codefree", "claude"];
const isRunsNewRoute = computed(() => route.name === "runs-new");
const routeParamRunId = computed(() =>
  typeof route.params.runId === "string" ? route.params.runId : undefined,
);
const routeQueryRunId = computed(() =>
  typeof route.query.runId === "string" ? route.query.runId : undefined,
);
const scopedRouteRunId = computed(() => routeParamRunId.value ?? routeQueryRunId.value);

type SubmenuLeaf = "manager" | "workerpoll" | "workspace" | "tasks" | "approvals" | "inspect";
const submenuLeafByName: Partial<Record<string, SubmenuLeaf>> = {
  "run-manager": "manager",
  "run-workerpoll": "workerpoll",
  "run-workspace": "workspace",
  "run-task-board": "tasks",
  "run-approvals": "approvals",
  "run-inspect": "inspect",
};
const activeSubmenuLeaf = computed<SubmenuLeaf | undefined>(() => {
  const routeName = typeof route.name === "string" ? route.name : "";
  return submenuLeafByName[routeName];
});
const isSubmenuRoute = computed(() => Boolean(activeSubmenuLeaf.value));

const sortedRuns = computed(() =>
  [...runs.value].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
);

const filteredRuns = computed(() => {
  const keyword = runSearchQuery.value.trim().toLowerCase();
  if (!keyword) {
    return sortedRuns.value;
  }

  return sortedRuns.value.filter((run) =>
    [run.goal, run.runId, run.summary, run.stage, run.status]
      .some((field) => field.toLowerCase().includes(keyword)),
  );
});

const selectedRun = computed(() => {
  const preferredRunId = routeParamRunId.value ?? selectedRunId.value;
  return filteredRuns.value.find((run) => run.runId === preferredRunId) ?? filteredRuns.value[0];
});

function copy(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

function syncRunQuery(runId: string | undefined): void {
  if (routeParamRunId.value) {
    return;
  }

  const currentRunId = typeof route.query.runId === "string" ? route.query.runId : undefined;
  if (currentRunId === runId) {
    return;
  }
  const nextQuery = { ...route.query };
  if (runId) {
    nextQuery.runId = runId;
  } else {
    delete nextQuery.runId;
  }
  void router.replace({ query: nextQuery });
}

function ensureSelection(): void {
  if (filteredRuns.value.length === 0) {
    selectedRunId.value = "";
    syncRunQuery(undefined);
    return;
  }
  if (filteredRuns.value.some((run) => run.runId === selectedRunId.value)) {
    return;
  }
  const routeMatch = scopedRouteRunId.value
    ? filteredRuns.value.find((run) => run.runId === scopedRouteRunId.value)
    : undefined;
  const nextId = routeMatch?.runId ?? filteredRuns.value[0]!.runId;
  selectedRunId.value = nextId;
  syncRunQuery(nextId);
}

function buildRunSubmenuPath(runId: string, leaf: SubmenuLeaf): string {
  return `/runs/${encodeURIComponent(runId)}/${leaf}`;
}

function selectRun(runId: string): void {
  selectedRunId.value = runId;
  if (activeSubmenuLeaf.value) {
    void router.push(buildRunSubmenuPath(runId, activeSubmenuLeaf.value));
    return;
  }
  syncRunQuery(runId);
}

function employeeInitial(run: RunSummaryView): string {
  const compact = run.goal.replace(/\s+/g, "").trim();
  if (compact.length > 0) {
    return compact.slice(0, 1).toUpperCase();
  }
  return run.runId.slice(-2).toUpperCase();
}

function statusTone(
  status: RunSummaryView["status"],
): "running" | "awaiting_approval" | "paused" | "completed" | "failed" {
  switch (status) {
    case "running":
      return "running";
    case "awaiting_approval":
      return "awaiting_approval";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "paused";
  }
}

async function loadRuns(): Promise<void> {
  loading.value = true;
  try {
    runs.value = await listRuns();
    ensureSelection();
    error.value = "";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function resumeSelectedRun(): Promise<void> {
  if (!selectedRun.value) {
    return;
  }
  resuming.value = true;
  try {
    await resumeRun(selectedRun.value.runId);
    await loadRuns();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    resuming.value = false;
  }
}

async function copyRunId(): Promise<void> {
  if (!selectedRun.value || typeof navigator === "undefined") {
    return;
  }
  copying.value = true;
  try {
    await navigator.clipboard.writeText(selectedRun.value.runId);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    setTimeout(() => {
      copying.value = false;
    }, 700);
  }
}

async function deleteTaskResources(run: RunSummaryView): Promise<void> {
  if (deletingRunId.value) {
    return;
  }

  if (typeof window !== "undefined") {
    const confirmed = window.confirm(
      copy(
        `确认删除任务 ${run.runId} 及其所有相关资源吗？此操作不可恢复。`,
        `Delete task ${run.runId} and all related resources? This cannot be undone.`,
      ),
    );
    if (!confirmed) {
      return;
    }
  }

  deletingRunId.value = run.runId;
  try {
    await deleteRunRequest(run.runId);
    if (selectedRunId.value === run.runId) {
      selectedRunId.value = "";
    }
    await loadRuns();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    deletingRunId.value = "";
  }
}

async function backToSubmenuHub(): Promise<void> {
  const runId = selectedRun.value?.runId ?? scopedRouteRunId.value;
  await router.push({
    name: "runs",
    query: runId ? { runId } : {},
  });
}

function toggleCreatePanel(): void {
  createError.value = "";

  if (!isRunsNewRoute.value) {
    void router.replace({
      name: "runs-new",
      query: route.query,
    });
  } else {
    void router.replace({
      name: "runs",
      query: route.query,
    });
  }
}

function resetCreateForm(): void {
  createGoalInput.value = "";
  selectedCli.value = settings.value.runDefaultCli;
  autoResume.value = settings.value.runAutoResume;
  createError.value = "";
}

async function createNewRun(): Promise<void> {
  const goal = createGoalInput.value.trim();
  if (!goal) {
    createError.value = copy("请输入任务目标。", "Enter a task goal.");
    return;
  }

  creating.value = true;
  try {
    createError.value = "";
    const created = await createRun({
      goal,
      cli: selectedCli.value,
      autoResume: autoResume.value,
      allowOutsideWorkspaceWrites: settings.value.runAllowOutsideWorkspaceWrites,
    });
    resetCreateForm();
    createExpanded.value = false;
    await loadRuns();
    const matched = runs.value.find((run) => run.runId === created.runId);
    if (matched) {
      selectRun(matched.runId);
    }
    if (isRunsNewRoute.value) {
      void router.replace({
        name: "runs",
        query: {
          ...route.query,
          runId: created.runId,
        },
      });
    }
  } catch (caught) {
    createError.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    creating.value = false;
  }
}

watch(
  () => isRunsNewRoute.value,
  (isRunsNew) => {
    createExpanded.value = isRunsNew;
    if (isRunsNew) {
      createError.value = "";
    }
  },
  { immediate: true },
);

watch(
  () => scopedRouteRunId.value,
  (routeRunId) => {
    if (typeof routeRunId !== "string") {
      return;
    }
    if (filteredRuns.value.some((run) => run.runId === routeRunId)) {
      selectedRunId.value = routeRunId;
    }
  },
  { immediate: true },
);

watch(
  () => filteredRuns.value,
  () => {
    ensureSelection();
  },
  { immediate: true },
);

onMounted(() => {
  resetCreateForm();
  void loadRuns();
});
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

          <section v-if="isSubmenuRoute" class="runs-submenu-shell">
            <RouterView />
          </section>

          <template v-else>
            <section class="runs-link-grid">
              <RouterLink class="runs-link-card" :to="`/runs/${encodeURIComponent(selectedRun.runId)}/manager`">
                <strong>{{ copy("总管", "Manager") }}</strong>
                <span>{{ copy("查看总管时间线与派工队列", "Open manager timeline and delegation queue") }}</span>
              </RouterLink>

              <RouterLink class="runs-link-card" :to="`/runs/${encodeURIComponent(selectedRun.runId)}/workerpoll`">
                <strong>{{ copy("工位池", "Worker pool") }}</strong>
                <span>{{ copy("查看工位池状态与资源分配", "Review worker pool status and allocations") }}</span>
              </RouterLink>

              <RouterLink class="runs-link-card" :to="getRunWorkspacePath(selectedRun.runId)">
                <strong>{{ copy("工作台", "Workspace") }}</strong>
                <span>{{ copy("进入运行工作台与上下文", "Open workspace and context") }}</span>
              </RouterLink>

              <RouterLink class="runs-link-card" :to="getRunTaskBoardPath(selectedRun.runId)">
                <strong>{{ copy("执行车道", "Execution lanes") }}</strong>
                <span>{{ copy("进入任务与会话执行车道", "Open task and session execution lanes") }}</span>
              </RouterLink>

              <RouterLink class="runs-link-card" :to="getRunApprovalsPath(selectedRun.runId)">
                <strong>{{ copy("审批", "Approvals") }}</strong>
                <span>{{ copy("查看该运行待审批动作", "Review pending approval actions") }}</span>
              </RouterLink>

              <RouterLink class="runs-link-card" :to="getRunInspectPath(selectedRun.runId)">
                <strong>{{ copy("审计", "Inspect") }}</strong>
                <span>{{ copy("查看时间线与产物审计", "Inspect timeline and artifacts") }}</span>
              </RouterLink>
            </section>

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

