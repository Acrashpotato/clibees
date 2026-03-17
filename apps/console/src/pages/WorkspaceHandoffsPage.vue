<script setup lang="ts">
import { computed } from "vue";

import HandoffRail from "../components/HandoffRail.vue";
import WorkspaceSectionShell from "../components/WorkspaceSectionShell.vue";
import { usePreferences } from "../composables/usePreferences";
import { useWorkspaceView } from "../composables/useWorkspaceView";
import type { ArtifactSummary } from "../types";
import { getRunWorkspacePath } from "../workspace";

const { t } = usePreferences();
const { resolvedRunId, workspace } = useWorkspaceView();

const handoffStats = computed<ArtifactSummary[]>(() => [
  {
    label: t("fields.delivered"),
    value: String(workspace.value.handoffs.filter((handoff) => handoff.status === "delivered").length).padStart(2, "0")
  },
  {
    label: t("fields.inFlight"),
    value: String(workspace.value.handoffs.filter((handoff) => handoff.status === "in_progress").length).padStart(2, "0")
  },
  {
    label: t("fields.queued"),
    value: String(workspace.value.handoffs.filter((handoff) => handoff.status === "queued").length).padStart(2, "0")
  }
]);
</script>

<template>
  <WorkspaceSectionShell :workspace="workspace" :run-scope-id="resolvedRunId" current="handoffs">
    <div class="workspace-page-stack">
      <div class="workspace-page-header">
        <div>
          <p class="section-eyebrow">{{ t("sections.collaboration") }}</p>
          <h1>{{ t("workspacePage.handoffsTitle") }}</h1>
        </div>
        <p>{{ t("workspacePage.handoffsDescription") }}</p>
      </div>

      <HandoffRail
        :handoffs="workspace.handoffs"
        :summary-items="handoffStats"
        :description="t('workspacePage.handoffsDescription')"
        :empty-action-label="t('actions.continueFocus')"
        :empty-action-to="getRunWorkspacePath(workspace.runId)"
      />
    </div>
  </WorkspaceSectionShell>
</template>

