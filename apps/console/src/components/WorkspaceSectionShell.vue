<script setup lang="ts">
import { usePreferences } from "../composables/usePreferences";
import type { WorkspaceView } from "../view-models";

defineProps<{
  workspace: WorkspaceView;
  current?: string;
  runScopeId?: string;
}>();

const { t } = usePreferences();
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
    </div>

    <div class="workspace-section-shell__content">
      <slot />
    </div>
  </section>
</template>
