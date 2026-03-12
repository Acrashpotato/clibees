<script setup lang="ts">
import { computed } from "vue";

import ActionQueuePanel from "../components/ActionQueuePanel.vue";
import FocusLanePanel from "../components/FocusLanePanel.vue";
import HandoffRail from "../components/HandoffRail.vue";
import HealthPanel from "../components/HealthPanel.vue";
import RunStatusBar from "../components/RunStatusBar.vue";
import WorkspaceSectionShell from "../components/WorkspaceSectionShell.vue";
import { usePreferences } from "../composables/usePreferences";
import { useWorkspaceView } from "../composables/useWorkspaceView";
import { getLaneConsolePath, getWorkspacePath } from "../workspace";

const { t } = usePreferences();
const { actionQueue, error, focusLane, loading, mutating, resolvedRunId, resumeRun, workspace } = useWorkspaceView();

const focusActionTo = computed(() => {
  const leadItem = actionQueue.value[0];

  if (leadItem?.actionTo) {
    return leadItem.actionTo;
  }

  if (leadItem?.laneId) {
    return getLaneConsolePath(workspace.value.runId, leadItem.laneId);
  }

  return getLaneConsolePath(workspace.value.runId, focusLane.value?.laneId);
});

const focusActionLabel = computed(() =>
  actionQueue.value.length > 0 ? t("actions.handleDecision") : t("actions.openLane")
);
</script>

<template>
  <WorkspaceSectionShell :workspace="workspace" :run-scope-id="resolvedRunId" current="overview">
    <div class="workspace-page-stack">
      <div class="workspace-page-header">
        <div>
          <p class="section-eyebrow">{{ t("sections.overview") }}</p>
          <h1>{{ t("workspacePage.overviewTitle") }}</h1>
        </div>
        <p>{{ t("workspacePage.overviewDescription") }}</p>
      </div>

      <div v-if="error" class="panel-card__empty-state">
        <p class="panel-card__body">{{ error }}</p>
      </div>

      <RunStatusBar :workspace="workspace" :loading="loading" :mutating="mutating" @resume="resumeRun" />

      <div class="workspace-overview-grid workspace-overview-grid--priority">
        <FocusLanePanel
          v-if="focusLane"
          :lane="focusLane"
          :run-id="workspace.runId"
          :title="focusLane.role"
          :description="t('workspacePage.focusDescriptionShort')"
          :primary-action-label="focusActionLabel"
          :primary-action-to="focusActionTo"
          variant="hero"
        />
        <ActionQueuePanel
          :items="actionQueue"
          :run-id="workspace.runId"
          :description="t('workspacePage.actionQueueDescription')"
          :empty-action-label="t('actions.continueFocus')"
          :empty-action-to="getWorkspacePath('focus', workspace.runId)"
        />
      </div>

      <div class="workspace-support-grid">
        <HandoffRail
          :handoffs="workspace.handoffs"
          :description="t('workspacePage.handoffsDescription')"
          :empty-action-label="t('actions.continueFocus')"
          :empty-action-to="getWorkspacePath('focus', workspace.runId)"
        />
        <HealthPanel
          :issues="workspace.issues"
          :description="t('workspacePage.healthDescription')"
          :empty-action-label="t('actions.reviewFlow')"
          :empty-action-to="getWorkspacePath('handoffs', workspace.runId)"
        />
      </div>
    </div>
  </WorkspaceSectionShell>
</template>

