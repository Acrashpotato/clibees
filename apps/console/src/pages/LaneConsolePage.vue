<script setup lang="ts">
import { ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { getWorkspaceProjection } from "../api";
import { usePreferences } from "../composables/usePreferences";
import {
  getRunWorkspacePath,
  getSessionDetailPath,
  getTaskDetailPath,
} from "../workspace";

const route = useRoute();
const router = useRouter();
const { isZh, t } = usePreferences();

const loading = ref(false);
const error = ref("");
const targetPath = ref("");

function copy(zh: string, en: string): string {
  return isZh.value ? zh : en;
}

async function resolveLegacyRoute() {
  const runId = typeof route.params.runId === "string" ? route.params.runId : "";
  const laneId = typeof route.params.laneId === "string" && route.params.laneId.length > 0
    ? route.params.laneId
    : undefined;

  if (!runId) {
    error.value = copy("缺少 runId，无法解析旧 lane 路由。", "Missing runId, so the legacy lane route cannot be resolved.");
    return;
  }

  loading.value = true;
  error.value = "";
  targetPath.value = "";

  try {
    if (laneId) {
      targetPath.value = getTaskDetailPath(runId, laneId);
    } else {
      const workspace = await getWorkspaceProjection(runId);
      if (workspace.activeSession?.sessionId) {
        targetPath.value = getSessionDetailPath(runId, workspace.activeSession.sessionId);
      } else if (workspace.focusTask?.taskId) {
        targetPath.value = getTaskDetailPath(runId, workspace.focusTask.taskId);
      } else {
        throw new Error(
          copy(
            "当前 run 还没有可映射的 task 或 session 入口。",
            "The current run does not expose a task or session entry that can receive the legacy route.",
          ),
        );
      }
    }

    await router.replace(targetPath.value);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

watch(
  () => route.fullPath,
  () => {
    void resolveLegacyRoute();
  },
  { immediate: true },
);
</script>

<template>
  <section class="workspace-page-stack">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">{{ copy("兼容路由", "Compatibility route") }}</p>
        <h1>{{ copy("旧 lane 路由正在收敛", "Legacy lane route is converging") }}</h1>
      </div>
      <p>
        {{
          copy(
            "显式 laneId 一律按 taskId 兼容映射；空的 lane 入口优先跳到活动 session，否则回落到当前 focus task。",
            "An explicit laneId now maps to taskId, while an empty legacy lane entry prefers the active session and otherwise falls back to the current focus task.",
          )
        }}
      </p>
    </div>

    <section class="panel-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ copy("路由解析", "Route resolution") }}</p>
          <h2>{{ loading ? copy("正在跳转到真实详情页", "Redirecting to the real detail page") : copy("旧路由解析完成", "Legacy route resolution complete") }}</h2>
        </div>
      </div>

      <p v-if="loading" class="panel-card__body">{{ copy("正在查询当前 run 的 detail 入口。", "Resolving the detail entry for the current run.") }}</p>
      <p v-else-if="targetPath" class="panel-card__body">{{ targetPath }}</p>
      <p v-else-if="error" class="panel-card__body">{{ error }}</p>
      <p v-else class="panel-card__body">{{ copy("等待跳转。", "Waiting for redirect.") }}</p>

      <div class="run-card__actions">
        <RouterLink class="ghost-link" :to="getRunWorkspacePath(typeof route.params.runId === 'string' ? route.params.runId : undefined)">
          {{ t("actions.backToWorkspace") }}
        </RouterLink>
      </div>
    </section>
  </section>
</template>
