<script setup lang="ts">
import { computed } from "vue";
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
  <div class="legacy-scope">
    <div class="app-shell">
      <div class="app-shell__backdrop app-shell__backdrop--left"></div>
      <div class="app-shell__backdrop app-shell__backdrop--right"></div>

      <div class="app-shell__layout">
        <div class="app-shell__main">
          <header class="app-toolbar">
            <button
              class="icon-button app-toolbar__menu"
              type="button"
              :aria-label="t('nav.runs')"
              :title="t('nav.runs')"
              @click="goToTaskPool"
            >
              <svg
                class="app-toolbar__home-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
                aria-hidden="true"
              >
                <path d="M3.5 10.2 12 3.5l8.5 6.7" />
                <path d="M5.5 9.8V20h13V9.8" />
                <path d="M9.4 20v-5.1h5.2V20" />
              </svg>
            </button>

            <div class="app-toolbar__context">
              <strong>{{ toolbarTitle }}</strong>
              <span v-if="activeRunId" class="panel-chip app-toolbar__run-chip">run {{ activeRunId }}</span>
            </div>

            <div class="app-toolbar__controls">
              <button
                class="icon-button theme-toggle"
                type="button"
                :aria-label="t('controls.themeToggle')"
                :title="isDark ? t('controls.themeDark') : t('controls.themeLight')"
                @click="toggleTheme"
              >
                <svg
                  v-if="isDark"
                  class="theme-toggle__icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                  aria-hidden="true"
                >
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
                </svg>
                <svg
                  v-else
                  class="theme-toggle__icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="4.2" />
                  <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
                </svg>
                <span class="theme-toggle__label">{{ isDark ? t("controls.themeDark") : t("controls.themeLight") }}</span>
              </button>

              <button
                class="icon-button app-toolbar__settings"
                :class="{ 'app-toolbar__settings--active': isSettingsRoute }"
                type="button"
                :aria-label="t('nav.settings')"
                :title="t('nav.settings')"
                @click="goToSettings"
              >
                <svg
                  class="app-toolbar__settings-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="3.2" />
                  <path d="M19.2 12a7.2 7.2 0 0 0-.1-1.2l2-1.5-1.8-3.1-2.4 1a7.4 7.4 0 0 0-2-1.2l-.4-2.6h-3.6l-.4 2.6a7.4 7.4 0 0 0-2 1.2l-2.4-1-1.8 3.1 2 1.5A7.2 7.2 0 0 0 4.8 12c0 .4 0 .8.1 1.2l-2 1.5 1.8 3.1 2.4-1a7.4 7.4 0 0 0 2 1.2l.4 2.6h3.6l.4-2.6a7.4 7.4 0 0 0 2-1.2l2.4 1 1.8-3.1-2-1.5c.1-.4.1-.8.1-1.2Z" />
                </svg>
              </button>
            </div>
          </header>

          <main class="app-content" :class="{ 'app-content--wide': isWideContentRoute }">
            <RouterView />
          </main>
        </div>
      </div>
    </div>
  </div>
</template>
