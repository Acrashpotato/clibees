<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import { usePreferences } from "../composables/usePreferences";
import type { LaneView } from "../types";
import { getLaneConsolePath } from "../workspace";

const props = withDefaults(
  defineProps<{
    lane: LaneView;
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

const defaultActionTo = computed(() => (props.runId ? getLaneConsolePath(props.runId, props.lane.laneId) : undefined));
const resolvedPrimaryActionTo = computed(() => props.primaryActionTo ?? defaultActionTo.value);
const resolvedPrimaryActionLabel = computed(() => props.primaryActionLabel ?? t("actions.openLane"));
</script>

<template>
  <section class="panel-card focus-panel" :data-variant="variant" :data-status="lane.status">
    <div class="panel-card__header focus-panel__header">
      <div>
        <p class="section-eyebrow">{{ eyebrow ?? t("sections.currentBottleneck") }}</p>
        <h2>{{ title ?? lane.role }}</h2>
      </div>
      <div class="lane-panel__badges">
        <span class="status-pill" :data-status="lane.status">{{ statusLabel(lane.status) }}</span>
        <span class="risk-pill" :data-risk="lane.riskLevel">{{ riskLabel(lane.riskLevel) }}</span>
      </div>
    </div>

    <div class="focus-panel__status-block">
      <strong class="focus-panel__status">{{ lane.statusReason }}</strong>
      <p v-if="description" class="panel-card__body">{{ description }}</p>
    </div>

    <div class="focus-panel__task-block">
      <span class="focus-panel__task-label">{{ t("sections.focusLane") }}</span>
      <p class="focus-panel__task">{{ lane.currentTaskTitle }}</p>
    </div>

    <div class="lane-panel__summary focus-panel__summary">
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

    <div class="detail-grid focus-panel__checks">
      <div
        v-for="validation in lane.validations"
        :key="validation.title"
        class="detail-chip detail-chip--row"
        :data-state="validation.state"
      >
        <span>{{ validation.title }}</span>
        <strong>{{ validationLabel(validation.state) }}</strong>
      </div>
    </div>

    <div class="focus-panel__footer">
      <p>{{ lane.handoffHint }}</p>
      <RouterLink v-if="resolvedPrimaryActionTo" class="primary-link" :to="resolvedPrimaryActionTo">
        {{ resolvedPrimaryActionLabel }}
      </RouterLink>
    </div>
  </section>
</template>
