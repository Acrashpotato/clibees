<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { usePreferences } from "../composables/usePreferences";
import { useWorkspaceView } from "../composables/useWorkspaceView";
import { getWorkspacePath } from "../workspace";

const route = useRoute();
const { riskLabel, statusLabel, t, validationLabel } = usePreferences();
const { workspace } = useWorkspaceView();

const activeLaneId = computed(() => {
  if (typeof route.params.laneId === "string" && route.params.laneId.length > 0) {
    return route.params.laneId;
  }

  return workspace.value.focusLaneId;
});

const activeLane = computed(
  () => workspace.value.lanes.find((lane) => lane.laneId === activeLaneId.value) ?? workspace.value.lanes[0]
);

const laneApprovals = computed(() =>
  workspace.value.approvals.filter((approval) => approval.laneId === activeLane.value.laneId)
);

const relatedHandoffs = computed(() =>
  workspace.value.handoffs.filter(
    (handoff) =>
      handoff.fromLaneId === activeLane.value.laneId || handoff.toLaneId === activeLane.value.laneId
  )
);

const relatedIssues = computed(() =>
  workspace.value.issues.filter(
    (issue) =>
      issue.toLowerCase().includes(activeLane.value.laneId.toLowerCase()) ||
      issue.toLowerCase().includes(activeLane.value.role.toLowerCase())
  )
);
</script>

<template>
  <section class="lane-console-shell">
    <div class="lane-console-header">
      <div>
        <p class="section-eyebrow">{{ t("sections.laneConsole") }}</p>
        <h1>{{ workspace.runId }}</h1>
        <p class="lane-console-header__meta">
          <span>{{ workspace.goal }}</span>
          <span>{{ activeLane.laneId }}</span>
          <span>{{ activeLane.role }}</span>
        </p>
      </div>
      <div class="lane-console-header__actions">
        <RouterLink class="ghost-link" :to="getWorkspacePath('overview', workspace.runId)">{{ t("actions.backToWorkspace") }}</RouterLink>
      </div>
    </div>

    <div class="lane-console-layout">
      <aside class="lane-roster">
        <div class="lane-roster__header">
          <p class="section-eyebrow">{{ t("sections.lanes") }}</p>
          <h2>{{ workspace.lanes.length }} {{ t("laneConsole.activeTracks") }}</h2>
        </div>

        <div class="lane-roster__list">
          <RouterLink
            v-for="lane in workspace.lanes"
            :key="lane.laneId"
            class="lane-roster__item"
            :class="{ 'lane-roster__item--active': lane.laneId === activeLane.laneId }"
            :to="`/runs/${workspace.runId}/lanes/${lane.laneId}`"
          >
            <div class="lane-roster__identity">
              <strong>{{ lane.role }}</strong>
              <span>{{ lane.laneId }}</span>
            </div>
            <div class="lane-roster__meta">
              <span class="status-pill" :data-status="lane.status">{{ statusLabel(lane.status) }}</span>
              <span>{{ lane.lastActivityAt }}</span>
            </div>
            <p>{{ lane.currentTaskTitle }}</p>
          </RouterLink>
        </div>
      </aside>

      <section class="lane-console-main">
        <article class="lane-conversation">
          <header class="lane-conversation__header">
            <div>
              <p class="lane-panel__eyebrow">{{ activeLane.laneId }}</p>
              <h2>{{ activeLane.currentTaskTitle }}</h2>
            </div>
            <div class="lane-panel__badges">
              <span class="status-pill" :data-status="activeLane.status">{{ statusLabel(activeLane.status) }}</span>
              <span class="risk-pill" :data-risk="activeLane.riskLevel">{{ riskLabel(activeLane.riskLevel) }}</span>
            </div>
          </header>

          <div class="lane-chat-toolbar">
            <span>{{ activeLane.agentId }}</span>
            <span>{{ activeLane.approvalState }}</span>
            <span>{{ activeLane.lastActivityAt }}</span>
          </div>

          <section class="terminal lane-conversation__terminal">
            <div class="terminal__toolbar">
              <span class="terminal__dot"></span>
              <span class="terminal__dot"></span>
              <span class="terminal__dot"></span>
              <code>{{ activeLane.role }}</code>
            </div>
            <pre class="terminal__body">{{ activeLane.terminalPreview.join("\n") }}</pre>
          </section>

          <footer class="lane-conversation__footer">
            <span>{{ activeLane.handoffHint }}</span>
            <RouterLink class="primary-link" :to="getWorkspacePath('lanes', workspace.runId)">{{ t("actions.viewBoard") }}</RouterLink>
          </footer>
        </article>
      </section>

      <aside class="lane-console-side">
        <section class="panel-card">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ t("sections.laneSettings") }}</p>
              <h2>{{ t("sections.executionProfile") }}</h2>
            </div>
          </div>
          <div class="detail-grid">
            <div class="detail-chip">
              <span>{{ t("fields.agent") }}</span>
              <strong>{{ activeLane.agentId }}</strong>
            </div>
            <div class="detail-chip">
              <span>{{ t("fields.role") }}</span>
              <strong>{{ activeLane.role }}</strong>
            </div>
            <div class="detail-chip">
              <span>{{ t("fields.approval") }}</span>
              <strong>{{ activeLane.approvalState }}</strong>
            </div>
            <div class="detail-chip">
              <span>{{ t("fields.risk") }}</span>
              <strong>{{ riskLabel(activeLane.riskLevel) }}</strong>
            </div>
          </div>
        </section>

        <section class="panel-card">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ t("sections.approvals") }}</p>
              <h2>{{ t("laneConsole.laneSpecificDecisions") }}</h2>
            </div>
          </div>
          <div v-if="laneApprovals.length > 0" class="approval-list">
            <article
              v-for="approval in laneApprovals"
              :key="approval.id"
              class="approval-card"
              :data-risk="approval.riskLevel"
            >
              <span class="approval-card__lane">{{ approval.laneId }}</span>
              <strong>{{ approval.title }}</strong>
              <p>{{ approval.summary }}</p>
            </article>
          </div>
          <p v-else class="panel-card__body">{{ t("laneConsole.noPendingApproval") }}</p>
        </section>

        <section class="panel-card">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">{{ t("sections.inspect") }}</p>
              <h2>{{ t("sections.recentChecks") }}</h2>
            </div>
          </div>
          <div class="detail-grid">
            <div
              v-for="validation in activeLane.validations"
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
              <p class="section-eyebrow">{{ t("sections.artifactsAndHandoffs") }}</p>
              <h2>{{ t("sections.laneContext") }}</h2>
            </div>
          </div>
          <div class="detail-grid lane-artifact-grid">
            <div v-for="artifact in activeLane.artifacts" :key="artifact.label" class="detail-chip">
              <span>{{ artifact.label }}</span>
              <strong>{{ artifact.value }}</strong>
            </div>
          </div>
          <div class="lane-related-list">
            <article v-for="handoff in relatedHandoffs" :key="handoff.id" class="handoff-card" :data-status="handoff.status">
              <div class="handoff-card__route">
                <span>{{ handoff.fromLaneId }}</span>
                <span class="handoff-card__arrow">-&gt;</span>
                <span>{{ handoff.toLaneId }}</span>
              </div>
              <strong>{{ handoff.title }}</strong>
              <p>{{ handoff.summary }}</p>
            </article>
            <p v-if="relatedIssues.length > 0" class="lane-related-issues">
              {{ relatedIssues.join(" | ") }}
            </p>
          </div>
        </section>
      </aside>
    </div>
  </section>
</template>
