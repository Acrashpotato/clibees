<script setup lang="ts">
import { computed } from "vue";
import {
  NButton,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NSpace,
  NTag,
  NText,
} from "naive-ui";
import { RouterView, useRoute, useRouter } from "vue-router";

import { usePreferences } from "./composables/usePreferences";
import { isWideContentRoute as resolveWideContentRoute, resolveToolbarLabelKey } from "./route-meta";

const route = useRoute();
const router = useRouter();
const { isDark, t, toggleTheme } = usePreferences();

const isWideContentRoute = computed(() => resolveWideContentRoute(route.path));
const toolbarLabelKey = computed(() => resolveToolbarLabelKey(route.path));
const toolbarTitle = computed(() =>
  toolbarLabelKey.value === "nav.runs" ? "CLI自动任务编排" : t(toolbarLabelKey.value),
);
const isSettingsRoute = computed(() => route.path === "/settings" || route.path.startsWith("/settings/"));
const routeRunId = computed(() =>
  typeof route.params.runId === "string" ? route.params.runId : undefined,
);
const activeRunId = computed(() => routeRunId.value);

async function goToTaskPool(): Promise<void> {
  await router.push("/runs");
}

async function goToSettings(): Promise<void> {
  if (isSettingsRoute.value) {
    return;
  }
  await router.push("/settings");
}
</script>

<template>
  <n-layout class="app-shell">
    <n-layout-header bordered class="app-toolbar app-toolbar--naive">
      <div class="app-toolbar__naive-row">
        <n-space align="center" :size="12">
          <n-button
            class="app-toolbar__menu"
            quaternary
            circle
            type="primary"
            :aria-label="t('nav.runs')"
            :title="t('nav.runs')"
            @click="goToTaskPool"
          >
            <span class="app-toolbar__icon-text">主页</span>
          </n-button>

          <div class="app-toolbar__context">
            <n-text class="app-toolbar__title" strong>{{ toolbarTitle }}</n-text>
            <n-tag v-if="activeRunId" type="info" size="small" round>run {{ activeRunId }}</n-tag>
          </div>
        </n-space>

        <n-space align="center" :size="8">
          <n-button
            class="theme-toggle"
            quaternary
            :aria-label="t('controls.themeToggle')"
            :title="isDark ? t('controls.themeDark') : t('controls.themeLight')"
            @click="toggleTheme"
          >
            {{ isDark ? t("controls.themeDark") : t("controls.themeLight") }}
          </n-button>

          <n-button
            class="app-toolbar__settings"
            secondary
            :type="isSettingsRoute ? 'primary' : 'default'"
            :aria-label="t('nav.settings')"
            :title="t('nav.settings')"
            @click="goToSettings"
          >
            {{ t("nav.settings") }}
          </n-button>
        </n-space>
      </div>
    </n-layout-header>

    <n-layout-content class="app-shell__content">
      <main class="app-content" :class="{ 'app-content--wide': isWideContentRoute }">
        <RouterView />
      </main>
    </n-layout-content>
  </n-layout>
</template>
