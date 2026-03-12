<script setup lang="ts">
import { RouterLink } from "vue-router";

import { usePreferences } from "../composables/usePreferences";
import type { LaneView } from "../types";
import { getLaneConsolePath } from "../workspace";

const props = defineProps<{
  lane: LaneView;
  active?: boolean;
  runId?: string;
}>();

const { riskLabel, statusLabel, t } = usePreferences();
</script>

<template>
  <article class="lane-panel" :data-active="active" :data-status="lane.status">
    <header class="lane-panel__header">
      <div>
        <p class="lane-panel__eyebrow">{{ lane.laneId }}</p>
        <h2>{{ lane.role }}</h2>
      </div>
      <div class="lane-panel__badges">
        <span class="status-pill" :data-status="lane.status">{{ statusLabel(lane.status) }}</span>
        <span class="risk-pill" :data-risk="lane.riskLevel">{{ riskLabel(lane.riskLevel) }}</span>
      </div>
    </header>

    <div class="lane-panel__task-block">
      <strong>{{ lane.currentTaskTitle }}</strong>
      <p>{{ lane.statusReason }}</p>
    </div>

    <div class="lane-panel__summary">
      <div>
        <span>{{ t("fields.agent") }}</span>
        <strong>{{ lane.agentId }}</strong>
      </div>
      <div>
        <span>{{ t("fields.lastActivity") }}</span>
        <strong>{{ lane.lastActivityAt }}</strong>
      </div>
      <div>
        <span>{{ t("fields.approval") }}</span>
        <strong>{{ lane.approvalState }}</strong>
      </div>
    </div>

    <section class="terminal">
      <div class="terminal__toolbar">
        <span class="terminal__dot"></span>
        <span class="terminal__dot"></span>
        <span class="terminal__dot"></span>
        <code>{{ lane.currentTaskTitle }}</code>
      </div>
      <pre class="terminal__body">{{ lane.terminalPreview.join("\n") }}</pre>
    </section>

    <footer class="lane-panel__footer">
      <p>{{ lane.handoffHint }}</p>
      <div class="lane-panel__footer-actions">
        <div class="lane-panel__mini-stats">
          <span v-for="artifact in lane.artifacts" :key="artifact.label">
            {{ artifact.label }} {{ artifact.value }}
          </span>
        </div>
        <RouterLink v-if="runId" class="ghost-link lane-panel__link" :to="getLaneConsolePath(runId, lane.laneId)">
          {{ t("actions.openLane") }}
        </RouterLink>
      </div>
    </footer>
  </article>
</template>
