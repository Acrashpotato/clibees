import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createRun, deleteRun as deleteRunRequest, listRuns, resumeRun, type SelectedCli } from "../../api";
import { useConsoleSettings } from "../../composables/useConsoleSettings";
import { usePreferences } from "../../composables/usePreferences";
import type { RunSummaryView } from "../../types";
import { getRunApprovalsPath, getRunInspectPath, getRunTaskBoardPath, getRunWorkspacePath } from "../../workspace";

export function useRunsPageController() {
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

  return {
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
  };
}

