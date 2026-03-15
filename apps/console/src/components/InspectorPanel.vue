<script setup lang="ts">
import { computed } from "vue";

import { usePreferences } from "../composables/usePreferences";
import type { WorkspaceView } from "../view-models";

const props = defineProps<{
  workspace: WorkspaceView;
}>();

const focusTask = computed(() =>
  props.workspace.tasks.find((task) => task.taskId === props.workspace.focusTaskId) ?? props.workspace.tasks[0]
);

const { statusLabel, t, validationLabel } = usePreferences();
</script>

<template>
  <aside class="sidebar-stack">
    <section class="panel-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ t("sections.inspector") }}</p>
          <h2>{{ focusTask.taskId }}</h2>
        </div>
        <span class="status-pill" :data-status="focusTask.status">{{ statusLabel(focusTask.status) }}</span>
      </div>
      <p class="panel-card__body">{{ focusTask.currentTaskTitle }}</p>
      <div class="detail-grid">
        <div
          v-for="validation in focusTask.validations"
          :key="validation.title"
          class="detail-chip"
          :data-state="validation.state"
        >
          <span>{{ validation.title }}</span>
          <strong>{{ validationLabel(validation.state) }}</strong>
        </div>
      </div>
    </section>

    <section class="panel-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ t("sections.approvals") }}</p>
          <h2>{{ t("sections.pendingDecisions") }}</h2>
        </div>
      </div>
      <div class="approval-list">
        <article v-for="approval in workspace.approvals" :key="approval.id" class="approval-card" :data-risk="approval.riskLevel">
          <span class="approval-card__lane">{{ approval.taskId ?? approval.id }}</span>
          <strong>{{ approval.title }}</strong>
          <p>{{ approval.summary }}</p>
        </article>
      </div>
    </section>

    <section class="panel-card">
      <div class="panel-card__header">
        <div>
          <p class="section-eyebrow">{{ t("sections.issues") }}</p>
          <h2>{{ t("sections.issues") }}</h2>
        </div>
      </div>
      <ul class="issue-list">
        <li v-for="issue in workspace.issues" :key="issue">{{ issue }}</li>
      </ul>
    </section>
  </aside>
</template>
