<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import { usePreferences } from "../composables/usePreferences";

const props = defineProps<{
  issues: string[];
  eyebrow?: string;
  title?: string;
  description?: string;
  emptyKey?: string;
  emptyActionLabel?: string;
  emptyActionTo?: string;
}>();

const { t } = usePreferences();

const healthStatus = computed(() => (props.issues.length > 0 ? "awaiting_approval" : "completed"));
const healthLabel = computed(() => (props.issues.length > 0 ? t("validation.warn") : t("validation.pass")));
</script>

<template>
  <section class="panel-card health-panel">
    <div class="panel-card__header">
      <div>
        <p class="section-eyebrow">{{ eyebrow ?? t("sections.runReminders") }}</p>
        <h2>{{ title ?? t("sections.runReminders") }}</h2>
      </div>
      <span class="status-pill" :data-status="healthStatus">{{ healthLabel }}</span>
    </div>

    <p v-if="description" class="panel-card__body">{{ description }}</p>

    <div v-if="issues.length > 0" class="health-panel__list">
      <article v-for="issue in issues" :key="issue" class="health-panel__item">
        <span class="health-panel__marker"></span>
        <p>{{ issue }}</p>
      </article>
    </div>

    <div v-else class="panel-card__empty-state">
      <p class="panel-card__body">{{ t(emptyKey ?? "workspacePage.healthEmpty") }}</p>
      <RouterLink v-if="emptyActionTo" class="ghost-link" :to="emptyActionTo">
        {{ emptyActionLabel ?? t("actions.reviewFlow") }}
      </RouterLink>
    </div>
  </section>
</template>
