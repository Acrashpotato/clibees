<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import { usePreferences } from "../composables/usePreferences";
import type { WorkspaceView } from "../types";
import { getWorkspacePath, type WorkspaceSectionKey } from "../workspace";

const props = defineProps<{
  workspace: WorkspaceView;
  current: WorkspaceSectionKey;
  runScopeId?: string;
}>();

const { t } = usePreferences();

const navItems = computed(() => [
  { key: "overview" as const, to: getWorkspacePath("overview", props.runScopeId), label: t("workspaceNav.overview") },
  { key: "lanes" as const, to: getWorkspacePath("lanes", props.runScopeId), label: t("workspaceNav.lanes") },
  { key: "handoffs" as const, to: getWorkspacePath("handoffs", props.runScopeId), label: t("workspaceNav.handoffs") },
  { key: "focus" as const, to: getWorkspacePath("focus", props.runScopeId), label: t("workspaceNav.focus") }
]);
</script>

<template>
  <section class="workspace-section-shell">
    <div class="workspace-section-shell__nav panel-card">
      <div class="workspace-section-shell__scope">
        <div class="workspace-section-shell__identity">
          <p class="section-eyebrow">{{ t("sections.workspace") }}</p>
          <h2>{{ workspace.runId }}</h2>
        </div>

        <p class="workspace-section-shell__summary">{{ workspace.stage }}</p>
      </div>

      <nav class="workspace-tabs">
        <RouterLink
          v-for="item in navItems"
          :key="item.key"
          :to="item.to"
          class="workspace-tabs__link"
          :class="{ 'workspace-tabs__link--active': item.key === current }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
    </div>

    <div class="workspace-section-shell__content">
      <slot />
    </div>
  </section>
</template>
