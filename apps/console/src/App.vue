<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";

import { listRuns } from "./api";
import RunSidebarTree, { type RunSidebarLeaf, type RunSidebarTaskItem } from "./components/app/RunSidebarTree.vue";
import SettingsEntryButton from "./components/app/SettingsEntryButton.vue";

const RUNS_UPDATED_EVENT = "clibees:runs-updated";

const route = useRoute();
const router = useRouter();

const runs = ref<RunSidebarTaskItem[]>([]);
const loading = ref(false);
const expandedRunIds = ref<string[]>([]);

const routeLeafByName: Partial<Record<string, RunSidebarLeaf>> = {
  "run-manager": "manager",
  "run-workerpoll": "workerpoll",
  "run-workspace": "workspace",
  "run-task-board": "tasks",
  "run-approvals": "approvals",
  "run-inspect": "inspect",
};

const isSettingsRoute = computed(() => route.path.startsWith("/settings"));
const activeRunId = computed(() => {
  if (typeof route.params.runId === "string") {
    return route.params.runId;
  }
  if (typeof route.query.runId === "string") {
    return route.query.runId;
  }
  return undefined;
});
const activeLeaf = computed(() => {
  const routeName = typeof route.name === "string" ? route.name : "";
  return routeLeafByName[routeName];
});
const pageTitle = computed(() => {
  if (isSettingsRoute.value) {
    return "系统设置";
  }
  if (!activeRunId.value) {
    return "运行中心";
  }
  const current = runs.value.find((item) => item.runId === activeRunId.value);
  return current?.name ?? "运行中心";
});

async function loadSidebarRuns(): Promise<void> {
  loading.value = true;
  try {
    const items = await listRuns();
    runs.value = [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } finally {
    loading.value = false;
  }
}

function ensureRunExpanded(runId?: string): void {
  if (!runId) {
    return;
  }
  if (expandedRunIds.value.includes(runId)) {
    return;
  }
  expandedRunIds.value = [...expandedRunIds.value, runId];
}

async function openRoot(): Promise<void> {
  await router.push("/runs");
}

async function openCreate(): Promise<void> {
  await router.push("/runs/new");
}

async function openRunCenter(): Promise<void> {
  await router.push("/runs");
}

async function selectRun(runId: string): Promise<void> {
  ensureRunExpanded(runId);
  await router.push(`/runs/${encodeURIComponent(runId)}/manager`);
}

async function selectLeaf(payload: { runId: string; leaf: RunSidebarLeaf }): Promise<void> {
  ensureRunExpanded(payload.runId);
  await router.push(`/runs/${encodeURIComponent(payload.runId)}/${payload.leaf}`);
}

function expandRun(runId: string): void {
  if (expandedRunIds.value.includes(runId)) {
    return;
  }
  expandedRunIds.value = [...expandedRunIds.value, runId];
}

function collapseRun(runId: string): void {
  expandedRunIds.value = expandedRunIds.value.filter((item) => item !== runId);
}

function handleRunsUpdated(): void {
  void loadSidebarRuns();
}

watch(
  () => activeRunId.value,
  (runId) => {
    ensureRunExpanded(runId);
  },
  { immediate: true },
);

watch(
  () => route.fullPath,
  () => {
    if (isSettingsRoute.value) {
      return;
    }
    void loadSidebarRuns();
  },
  { immediate: true },
);

onMounted(() => {
  void loadSidebarRuns();
  if (typeof window !== "undefined") {
    window.addEventListener(RUNS_UPDATED_EVENT, handleRunsUpdated);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener(RUNS_UPDATED_EVENT, handleRunsUpdated);
  }
});
</script>

<template>
  <div class="app-frame" :class="{ 'app-frame--settings': isSettingsRoute }">
    <template v-if="!isSettingsRoute">
      <RunSidebarTree
        :runs="runs"
        :active-run-id="activeRunId"
        :active-leaf="activeLeaf"
        :expanded-run-ids="expandedRunIds"
        :loading="loading"
        @open-root="openRoot"
        @open-create="openCreate"
        @select-run="selectRun"
        @select-leaf="selectLeaf"
        @expand-run="expandRun"
        @collapse-run="collapseRun"
      />
    </template>

    <section class="app-main">
      <header class="app-topbar">
        <div>
          <h2>{{ pageTitle }}</h2>
        </div>

        <button v-if="isSettingsRoute" class="ghost-link" type="button" @click="openRunCenter">返回运行中心</button>
        <SettingsEntryButton v-if="!isSettingsRoute" />
      </header>

      <main
        class="app-content"
        :class="{ 'app-content--wide': isSettingsRoute, 'app-content--settings': isSettingsRoute }"
      >
        <RouterView />
      </main>
    </section>
  </div>
</template>
