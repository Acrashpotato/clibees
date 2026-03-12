<script setup lang="ts">
import { computed } from "vue";

import ActionQueuePanel from "../components/ActionQueuePanel.vue";
import FocusLanePanel from "../components/FocusLanePanel.vue";
import HandoffRail from "../components/HandoffRail.vue";
import HealthPanel from "../components/HealthPanel.vue";
import WorkspaceSectionShell from "../components/WorkspaceSectionShell.vue";
import { usePreferences } from "../composables/usePreferences";
import { useWorkspaceView } from "../composables/useWorkspaceView";
import { getLaneConsolePath, getWorkspacePath } from "../workspace";

const { t } = usePreferences();
const { actionQueue, focusLane, resolvedRunId, workspace } = useWorkspaceView();

const focusIssues = computed(() =>
  workspace.value.issues.filter(
    (issue) =>
      issue.toLowerCase().includes(focusLane.value.laneId.toLowerCase()) ||
      issue.toLowerCase().includes(focusLane.value.role.toLowerCase())
  )
);

const focusQueue = computed(() => actionQueue.value.filter((item) => item.laneId === focusLane.value.laneId));
const relatedHandoffs = computed(() =>
  workspace.value.handoffs.filter(
    (handoff) => handoff.fromLaneId === focusLane.value.laneId || handoff.toLaneId === focusLane.value.laneId
  )
);
</script>

<template>
  <WorkspaceSectionShell :workspace="workspace" :run-scope-id="resolvedRunId" current="focus">
    <div class="workspace-page-stack">
      <div class="workspace-page-header">
        <div>
          <p class="section-eyebrow">{{ t("sections.currentBottleneck") }}</p>
          <h1>{{ t("workspacePage.focusTitle") }}</h1>
        </div>
        <p>{{ t("workspacePage.focusDescription") }}</p>
      </div>

      <FocusLanePanel
        :lane="focusLane"
        :run-id="workspace.runId"
        :title="focusLane.role"
        :description="t('workspacePage.focusDescriptionShort')"
        :primary-action-label="t('actions.openLane')"
        :primary-action-to="getLaneConsolePath(workspace.runId, focusLane.laneId)"
        variant="hero"
      />

      <div class="workspace-focus-grid">
        <ActionQueuePanel
          :items="focusQueue"
          :run-id="workspace.runId"
          :title="t('sections.pendingForYou')"
          :description="t('workspacePage.actionQueueDescription')"
          :empty-action-label="t('actions.openLane')"
          :empty-action-to="getLaneConsolePath(workspace.runId, focusLane.laneId)"
        />
        <HandoffRail
          :handoffs="relatedHandoffs"
          :summary-items="focusLane.artifacts"
          :title="t('sections.crossLaneMovement')"
          :description="t('workspacePage.handoffsDescription')"
          :empty-action-label="t('actions.reviewFlow')"
          :empty-action-to="getWorkspacePath('handoffs', workspace.runId)"
        />
      </div>

      <HealthPanel
        :issues="focusIssues"
        :description="t('workspacePage.healthDescription')"
        :empty-action-label="t('actions.reviewFlow')"
        :empty-action-to="getWorkspacePath('handoffs', workspace.runId)"
      />
    </div>
  </WorkspaceSectionShell>
</template>

