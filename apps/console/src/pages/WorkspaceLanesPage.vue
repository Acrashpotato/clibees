<script setup lang="ts">
import FocusLanePanel from "../components/FocusLanePanel.vue";
import LanePanel from "../components/LanePanel.vue";
import WorkspaceSectionShell from "../components/WorkspaceSectionShell.vue";
import { usePreferences } from "../composables/usePreferences";
import { useWorkspaceView } from "../composables/useWorkspaceView";

const { t } = usePreferences();
const { focusLane, resolvedRunId, workspace } = useWorkspaceView();
</script>

<template>
  <WorkspaceSectionShell :workspace="workspace" :run-scope-id="resolvedRunId" current="lanes">
    <div class="workspace-page-stack">
      <div class="workspace-page-header">
        <div>
          <p class="section-eyebrow">{{ t("sections.executionLanes") }}</p>
          <h1>{{ t("workspacePage.lanesTitle") }}</h1>
        </div>
        <p>{{ t("workspacePage.lanesDescription") }}</p>
      </div>

      <FocusLanePanel
        :lane="focusLane"
        :run-id="workspace.runId"
        :eyebrow="t('sections.focusLane')"
        :title="focusLane.role"
      />

      <section class="panel-card">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">{{ t("sections.executionLanes") }}</p>
            <h2>{{ t("sections.multiLaneBoard") }}</h2>
          </div>
        </div>

        <div class="lane-grid workspace-lane-grid">
          <LanePanel
            v-for="lane in workspace.lanes"
            :key="lane.laneId"
            :lane="lane"
            :active="lane.laneId === workspace.focusLaneId"
            :run-id="workspace.runId"
          />
        </div>
      </section>
    </div>
  </WorkspaceSectionShell>
</template>

