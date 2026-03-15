<script setup lang="ts">
import { RouterLink } from "vue-router";

import { usePreferences } from "../composables/usePreferences";
import type { WorkspaceTaskCardView } from "../view-models";
import { getTaskConsolePath } from "../workspace";

const props = defineProps<{
  task: WorkspaceTaskCardView;
  active?: boolean;
  runId?: string;
}>();

const { riskLabel, statusLabel, t } = usePreferences();
</script>

<template>
  <article class="lane-panel" :data-active="active" :data-status="task.status">
    <header class="lane-panel__header">
      <div>
        <p class="lane-panel__eyebrow">{{ task.taskId }}</p>
        <h2>{{ task.role }}</h2>
      </div>
      <div class="lane-panel__badges">
        <span class="status-pill" :data-status="task.status">{{ statusLabel(task.status) }}</span>
        <span class="risk-pill" :data-risk="task.riskLevel">{{ riskLabel(task.riskLevel) }}</span>
      </div>
    </header>

    <div class="lane-panel__task-block">
      <strong>{{ task.currentTaskTitle }}</strong>
      <p>{{ task.statusReason }}</p>
    </div>

    <div class="lane-panel__summary">
      <div>
        <span>{{ t("fields.agent") }}</span>
        <strong>{{ task.agentId }}</strong>
      </div>
      <div>
        <span>{{ t("fields.lastActivity") }}</span>
        <strong>{{ task.lastActivityAt }}</strong>
      </div>
      <div>
        <span>{{ t("fields.approval") }}</span>
        <strong>{{ task.approvalState }}</strong>
      </div>
    </div>

    <section class="terminal">
      <div class="terminal__toolbar">
        <span class="terminal__dot"></span>
        <span class="terminal__dot"></span>
        <span class="terminal__dot"></span>
        <code>{{ task.currentTaskTitle }}</code>
      </div>
      <pre class="terminal__body">{{ task.terminalPreview.join("\n") }}</pre>
    </section>

    <footer class="lane-panel__footer">
      <p>{{ task.handoffHint }}</p>
      <div class="lane-panel__footer-actions">
        <div class="lane-panel__mini-stats">
          <span v-for="artifact in task.artifacts" :key="artifact.label">
            {{ artifact.label }} {{ artifact.value }}
          </span>
        </div>
        <RouterLink v-if="runId" class="ghost-link lane-panel__link" :to="getTaskConsolePath(runId, task.taskId)">
          {{ t("actions.openLane") }}
        </RouterLink>
      </div>
    </footer>
  </article>
</template>
