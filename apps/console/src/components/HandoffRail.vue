<script setup lang="ts">
import { RouterLink } from "vue-router";

import { usePreferences } from "../composables/usePreferences";
import type { ArtifactSummary, HandoffView } from "../types";

const props = defineProps<{
  handoffs: HandoffView[];
  eyebrow?: string;
  title?: string;
  description?: string;
  emptyKey?: string;
  emptyActionLabel?: string;
  emptyActionTo?: string;
  summaryItems?: ArtifactSummary[];
}>();

const { t } = usePreferences();
</script>

<template>
  <section class="panel-card handoff-panel">
    <div class="panel-card__header">
      <div>
        <p class="section-eyebrow">{{ eyebrow ?? t("sections.handoffs") }}</p>
        <h2>{{ title ?? t("sections.crossLaneMovement") }}</h2>
      </div>
    </div>

    <p v-if="description" class="panel-card__body">{{ description }}</p>

    <div v-if="summaryItems?.length" class="workspace-stat-row workspace-stat-row--summary">
      <div v-for="item in summaryItems" :key="item.label" class="detail-chip detail-chip--compact">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </div>
    </div>

    <div v-if="handoffs.length > 0" class="handoff-list handoff-list--timeline">
      <article v-for="handoff in handoffs" :key="handoff.id" class="handoff-card handoff-card--flow" :data-status="handoff.status">
        <div class="handoff-card__topline">
          <div class="handoff-card__route">
            <span>{{ handoff.fromLaneId }}</span>
            <span class="handoff-card__arrow">-></span>
            <span>{{ handoff.toLaneId }}</span>
          </div>
          <span class="flow-pill" :data-status="handoff.status">{{ t(`handoffStatus.${handoff.status}`) }}</span>
        </div>
        <strong>{{ handoff.title }}</strong>
        <p>{{ handoff.summary }}</p>
        <div class="handoff-card__meta-grid">
          <div class="detail-chip detail-chip--row detail-chip--compact">
            <span>{{ t("fields.reason") }}</span>
            <strong>{{ handoff.reason }}</strong>
          </div>
          <div class="detail-chip detail-chip--row detail-chip--compact">
            <span>{{ t("fields.owner") }}</span>
            <strong>{{ handoff.ownerLabel }}</strong>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="panel-card__empty-state">
      <p class="panel-card__body">{{ t(emptyKey ?? "workspacePage.healthEmpty") }}</p>
      <RouterLink v-if="emptyActionTo" class="ghost-link" :to="emptyActionTo">
        {{ emptyActionLabel ?? t("actions.continueFocus") }}
      </RouterLink>
    </div>
  </section>
</template>
