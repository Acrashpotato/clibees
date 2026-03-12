<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";

import { usePreferences } from "./composables/usePreferences";
import type { Locale } from "./i18n";

const route = useRoute();
const { isDark, locale, setLocale, t, toggleTheme } = usePreferences();
const isSidebarOpen = ref(false);

const navItems = [
  { to: "/workspace", labelKey: "nav.workspace" },
  { to: "/runs", labelKey: "nav.runs" },
  { to: "/approvals", labelKey: "nav.approvals" },
  { to: "/inspect", labelKey: "nav.inspect" },
  { to: "/settings", labelKey: "nav.settings" }
] as const;

const localeOptions: Array<{ value: Locale; labelKey: string }> = [
  { value: "zh-CN", labelKey: "controls.localeChinese" },
  { value: "en", labelKey: "controls.localeEnglish" }
];

const toolbarLabelKey = computed(() => {
  if (route.path === "/workspace" || route.path.startsWith("/workspace/")) {
    return "nav.workspace";
  }

  if (/^\/runs\/[^/]+\/workspace(?:\/.*)?$/.test(route.path)) {
    return "nav.workspace";
  }

  if (/^\/runs\/[^/]+\/lanes(?:\/.*)?$/.test(route.path)) {
    return "sections.laneConsole";
  }

  if (route.path === "/runs" || route.path.startsWith("/runs/")) {
    return "nav.runs";
  }

  if (route.path === "/approvals" || route.path.startsWith("/approvals/")) {
    return "nav.approvals";
  }

  if (route.path === "/inspect" || route.path.startsWith("/inspect/")) {
    return "nav.inspect";
  }

  return "nav.settings";
});

function isNavActive(target: string) {
  if (target === "/workspace") {
    return (
      route.path === "/workspace" ||
      route.path.startsWith("/workspace/") ||
      /^\/runs\/[^/]+\/(workspace(?:\/.*)?|lanes(?:\/.*)?)$/.test(route.path)
    );
  }

  return route.path === target || route.path.startsWith(`${target}/`);
}

function toggleSidebar() {
  isSidebarOpen.value = !isSidebarOpen.value;
}

function closeSidebar() {
  isSidebarOpen.value = false;
}

function onLocaleChange(event: Event) {
  const nextLocale = (event.target as HTMLSelectElement).value;

  if (nextLocale === "zh-CN" || nextLocale === "en") {
    setLocale(nextLocale);
  }
}

watch(
  () => route.fullPath,
  () => {
    closeSidebar();
  }
);
</script>

<template>
  <div class="app-shell">
    <div class="app-shell__backdrop app-shell__backdrop--left"></div>
    <div class="app-shell__backdrop app-shell__backdrop--right"></div>

    <div class="app-shell__layout">
      <button
        class="app-shell__drawer-backdrop"
        :class="{ 'app-shell__drawer-backdrop--open': isSidebarOpen }"
        :aria-hidden="!isSidebarOpen"
        tabindex="-1"
        type="button"
        @click="closeSidebar"
      ></button>

      <aside class="app-sidebar" :class="{ 'app-sidebar--open': isSidebarOpen }">
        <div class="app-sidebar__inner">
          <div class="app-sidebar__header">
            <div>
              <p class="app-sidebar__brand">{{ t("app.brand") }}</p>
              <h1>{{ t("app.subtitle") }}</h1>
            </div>

            <button
              class="icon-button app-sidebar__close"
              type="button"
              :aria-label="t('controls.closeMenu')"
              @click="closeSidebar"
            >
              <span aria-hidden="true">X</span>
            </button>
          </div>

          <nav class="app-sidebar__nav">
            <RouterLink
              v-for="item in navItems"
              :key="item.to"
              :to="item.to"
              class="app-sidebar__link"
              :class="{ 'app-sidebar__link--active': isNavActive(item.to) }"
              @click="closeSidebar"
            >
              {{ t(item.labelKey) }}
            </RouterLink>
          </nav>
        </div>
      </aside>

      <div class="app-shell__main">
        <header class="app-toolbar">
          <button
            class="icon-button app-toolbar__menu"
            type="button"
            :aria-label="t('controls.openMenu')"
            @click="toggleSidebar"
          >
            <span class="app-toolbar__menu-lines" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </span>
          </button>

          <div class="app-toolbar__context">
            <p class="section-eyebrow">{{ t("app.brand") }}</p>
            <strong>{{ t(toolbarLabelKey) }}</strong>
          </div>

          <div class="app-toolbar__controls">
            <label class="toolbar-select">
              <span class="toolbar-select__label">{{ t("controls.language") }}</span>
              <select :value="locale" @change="onLocaleChange">
                <option v-for="option in localeOptions" :key="option.value" :value="option.value">
                  {{ t(option.labelKey) }}
                </option>
              </select>
            </label>

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
            </button>
          </div>
        </header>

        <main class="app-content">
          <RouterView />
        </main>
      </div>
    </div>
  </div>
</template>
