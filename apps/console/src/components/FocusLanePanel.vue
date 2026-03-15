<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import { usePreferences } from "../composables/usePreferences";
import type { WorkspaceTaskCardView } from "../view-models";
import { getTaskConsolePath } from "../workspace";

const props = withDefaults(
  defineProps<{
    task: WorkspaceTaskCardView;
    runId?: string;
    eyebrow?: string;
    title?: string;
    description?: string;
    primaryActionLabel?: string;
    primaryActionTo?: string;
    variant?: "hero" | "section";
  }>(),
  {
    variant: "section"
  }
);

const { riskLabel, statusLabel, t, validationLabel } = usePreferences();

const defaultActionTo = computed(() => (props.runId ? getTaskConsolePath(props.runId, props.task.taskId) : undefined));
const resolvedPrimaryActionTo = computed(() => props.primaryActionTo ?? defaultActionTo.value);
const resolvedPrimaryActionLabel = computed(() => props.primaryActionLabel ?? t("actions.openLane"));
</script>

<template>
  <section class="panel-card focus-panel" :data-variant="variant" :data-status="task.status">
    <div class="panel-card__header focus-panel__header">
      <div>
        <p class="section-eyebrow">{{ eyebrow ?? t("sections.currentBottleneck") }}</p>
        <h2>{{ title ?? task.role }}</h2>
      </div>
      <div class="lane-panel__badges">
        <span class="status-pill" :data-status="task.status">{{ statusLabel(task.status) }}</span>
        <span class="risk-pill" :data-risk="task.riskLevel">{{ riskLabel(task.riskLevel) }}</span>
      </div>
    </div>

    <div class="focus-panel__status-block">
      <strong class="focus-panel__status">{{ task.statusReason }}</strong>
      <p v-if="description" class="panel-card__body">{{ description }}</p>
    </div>

    <div class="focus-panel__task-block">
      <span class="focus-panel__task-label">{{ t("sections.focusLane") }}</span>
      <p class="focus-panel__task">{{ task.currentTaskTitle }}</p>
    </div>

    <div class="lane-panel__summary focus-panel__summary">
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

    <div class="detail-grid focus-panel__checks">
      <div
        v-for="validation in task.validations"
        :key="validation.title"
        class="detail-chip detail-chip--row"
        :data-state="validation.state"
      >
        <span>{{ validation.title }}</span>
        <strong>{{ validationLabel(validation.state) }}</strong>
      </div>
    </div>

    <div class="focus-panel__footer">
      <p>{{ task.handoffHint }}</p>
      <RouterLink v-if="resolvedPrimaryActionTo" class="primary-link" :to="resolvedPrimaryActionTo">
        {{ resolvedPrimaryActionLabel }}
      </RouterLink>
    </div>
  </section>
</template>
