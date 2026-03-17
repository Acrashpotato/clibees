<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { getTaskBoardProjection } from "../api";
import { usePreferences } from "../composables/usePreferences";
import { useRunScopedResource } from "../composables/useRunScopedResource";
import {
  createEmptyTaskBoardProjection,
  type TaskBoardDependencyState,
  type TaskBoardProjectionView,
  type TaskBoardRetrySourceMode,
  type TaskBoardSessionSourceMode,
  type TaskBoardTaskNode,
} from "../task-board-projection";
import { getTaskConsolePath } from "../workspace";

const route = useRoute();
const { riskLabel, statusLabel, t } = usePreferences();

const runScopeId = computed(() => (typeof route.params.runId === "string" ? route.params.runId : undefined));
const resource = useRunScopedResource<TaskBoardProjectionView, boolean>({
  getRunScopeId: () => runScopeId.value,
  createEmpty: (runId) => createEmptyTaskBoardProjection(runId),
  fetchData: (runId) => getTaskBoardProjection(runId),
  getStatus: () => false,
  isTerminalStatus: (status) => status,
  getPollIntervalMs: () => 2000,
});
const projection = resource.data;
const resolvedRunId = resource.resolvedRunId;
const loading = resource.loading;
const error = resource.error;
const mutating = resource.mutating;

async function loadProjection(showLoading = true): Promise<void> {
  await resource.load(showLoading);
}

async function handleResume(): Promise<void> {
  await resource.resumeScopedRun();
}

watch(
  () => route.fullPath,
  () => {
    void loadProjection();
  },
  { immediate: true },
);

const runId = computed(() => resolvedRunId.value ?? projection.value.runId);
const currentTaskId = computed(() => projection.value.currentTaskId);
const currentTask = computed(() =>
  currentTaskId.value
    ? projection.value.tasks.find((task) => task.taskId === currentTaskId.value)
    : undefined,
);
const taskColumns = computed(() => {
  const grouped = new Map<number, TaskBoardTaskNode[]>();

  for (const task of projection.value.tasks) {
    const bucket = grouped.get(task.depth) ?? [];
    bucket.push(task);
    grouped.set(task.depth, bucket);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([depth, tasks]) => ({
      depth,
      tasks,
    }));
});

function sessionTitle(task: TaskBoardTaskNode): string {
  if (!task.activeSession) {
    return "No active session";
  }

  return task.activeSession.sessionId
    ? `Session ${task.activeSession.sessionId}`
    : "Backfilled session";
}

function sessionRelation(task: TaskBoardTaskNode): string {
  if (!task.activeSession) {
    return "This task currently has no active session binding, so the board stays at task-level state and dependency context.";
  }

  return `Task ${task.taskId} is currently owned by ${task.activeSession.agentId}. The board keeps the session summary visible without dropping into transcript detail.`;
}

function edgeStateLabel(state: TaskBoardDependencyState): string {
  switch (state) {
    case "satisfied":
      return "Satisfied";
    case "active":
      return "Upstream active";
    case "blocked":
      return "Upstream blocked";
    default:
      return "Waiting";
  }
}

function sourceModeLabel(sourceMode: TaskBoardSessionSourceMode | TaskBoardRetrySourceMode): string {
  switch (sourceMode) {
    case "task_session":
      return "Task session";
    case "task_record":
      return "Task record";
    case "task_status_backfill":
      return "Status backfill";
    default:
      return "Event backfill";
  }
}

function taskPath(taskId: string): string | undefined {
  return runId.value ? getTaskConsolePath(runId.value, taskId) : undefined;
}
</script>

<template>
  <section class="workspace-page-stack task-board-page">
    <div class="workspace-page-header">
      <div>
        <p class="section-eyebrow">Task Board</p>
        <h1>Task DAG and Session Bindings</h1>
      </div>
      <p>
        This page no longer flattens the task graph into a lane list. Each node shows task state,
        dependencies, ownership, and its relationship to the active session.
      </p>
    </div>

    <section class="status-bar workspace-hero task-board-hero">
      <div class="task-board-hero__top">
        <div>
          <p class="section-eyebrow">Task Graph</p>
          <h1>{{ currentTask?.title ?? "Selected Run Task Board" }}</h1>
          <p class="workspace-hero__lead">
            {{
              currentTask
                ? `Current highlighted task is ${currentTask.taskId}, graph revision ${projection.graphRevision}.`
                : `Task board for run ${projection.runId || runId}, graph revision ${projection.graphRevision}.`
            }}
          </p>
        </div>

        <div class="workspace-hero__meta">
          <span class="flow-pill">Run {{ projection.runId || runId }}</span>
          <span class="flow-pill">Graph {{ projection.graphRevision }}</span>
          <button class="ghost-button" type="button" :disabled="loading" @click="loadProjection(false)">
            {{ t("actions.refresh") }}
          </button>
          <button class="primary-button" type="button" :disabled="mutating || !runId" @click="handleResume">
            {{ mutating ? t("actions.resuming") : t("actions.resumeRun") }}
          </button>
        </div>
      </div>

      <div class="workspace-summary-grid task-board-summary-grid">
        <article class="summary-card">
          <span>Total tasks</span>
          <strong>{{ projection.summary.totalTaskCount }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.activeTasks") }}</span>
          <strong>{{ projection.summary.activeTaskCount }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.activeSessions") }}</span>
          <strong>{{ projection.summary.activeSessionCount }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.approvals") }}</span>
          <strong>{{ projection.summary.pendingApprovalCount }}</strong>
        </article>
        <article class="summary-card">
          <span>{{ t("fields.blocked") }}</span>
          <strong>{{ projection.summary.blockedTaskCount }}</strong>
        </article>
        <article class="summary-card">
          <span>Failed tasks</span>
          <strong>{{ projection.summary.failedTaskCount }}</strong>
        </article>
        <article class="summary-card">
          <span>Dependency edges</span>
          <strong>{{ projection.summary.dependencyEdgeCount }}</strong>
        </article>
        <article class="summary-card">
          <span>Completed</span>
          <strong>{{ projection.summary.completedTaskCount }}</strong>
        </article>
      </div>
    </section>

    <div v-if="error" class="panel-card__empty-state">
      <p class="panel-card__body">{{ error }}</p>
    </div>

    <div v-else-if="loading && projection.tasks.length === 0" class="panel-card__empty-state">
      <p class="panel-card__body">Loading task board.</p>
    </div>

    <div v-else-if="projection.tasks.length === 0" class="panel-card__empty-state">
      <p class="panel-card__body">The selected run does not expose a task graph yet.</p>
    </div>

    <template v-else>
      <section class="panel-card task-board-intro">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">Node View</p>
            <h2>Columns by DAG Depth</h2>
          </div>
          <span class="panel-chip">{{ taskColumns.length }}</span>
        </div>
        <p class="panel-card__body">
          Each node carries task state, waiting reason, ownership, latest activity, active session
          summary, and retry state. Full transcript and approval bodies stay in later detail pages.
        </p>
      </section>

      <section class="task-board-columns">
        <article v-for="column in taskColumns" :key="column.depth" class="panel-card task-board-column">
          <div class="panel-card__header">
            <div>
              <p class="section-eyebrow">Depth</p>
              <h2>Depth {{ column.depth }}</h2>
            </div>
            <span class="panel-chip">{{ column.tasks.length }}</span>
          </div>

          <article
            v-for="task in column.tasks"
            :key="task.taskId"
            class="task-node-card"
            :data-current="task.taskId === currentTaskId"
            :data-status="task.status"
          >
            <div class="task-node-card__top">
              <div>
                <p class="lane-panel__eyebrow">{{ task.taskId }}</p>
                <h3>{{ task.title }}</h3>
              </div>
              <div class="lane-panel__badges">
                <span class="status-pill" :data-status="task.status">{{ statusLabel(task.status) }}</span>
                <span class="risk-pill" :data-risk="task.riskLevel">{{ riskLabel(task.riskLevel) }}</span>
              </div>
            </div>

            <div class="task-node-card__meta">
              <div class="summary-card">
                <span>{{ t("fields.owner") }}</span>
                <strong>{{ task.ownerLabel }}</strong>
              </div>
              <div class="summary-card">
                <span>Task kind</span>
                <strong>{{ task.kind }}</strong>
              </div>
              <div class="summary-card">
                <span>{{ t("fields.lastActivity") }}</span>
                <strong>{{ task.latestActivityAt }}</strong>
              </div>
              <div class="summary-card">
                <span>Downstream tasks</span>
                <strong>{{ task.downstreamTaskIds.length }}</strong>
              </div>
            </div>

            <section class="task-node-card__section">
              <strong>{{ task.statusReason }}</strong>
              <p class="panel-card__body">{{ task.latestActivitySummary }}</p>
              <p v-if="task.waitingReason" class="task-node-card__reason">{{ task.waitingReason }}</p>
            </section>

            <section class="task-node-card__section">
              <div class="task-node-card__section-header">
                <strong>Dependencies</strong>
                <span class="flow-pill">Depth {{ task.depth }}</span>
              </div>
              <div class="task-node-card__list">
                <span v-if="task.dependsOn.length === 0" class="task-node-card__pill">No upstream deps</span>
                <span v-for="dependencyId in task.dependsOn" :key="dependencyId" class="task-node-card__pill">
                  Depends on {{ dependencyId }}
                </span>
              </div>
              <div class="task-node-card__list">
                <span v-if="task.downstreamTaskIds.length === 0" class="task-node-card__pill">No downstream tasks</span>
                <span v-for="downstreamTaskId in task.downstreamTaskIds" :key="downstreamTaskId" class="task-node-card__pill">
                  Downstream {{ downstreamTaskId }}
                </span>
              </div>
            </section>

            <section class="task-node-card__section">
              <div class="task-node-card__section-header">
                <strong>Task and Session</strong>
                <span class="flow-pill">{{ sessionTitle(task) }}</span>
              </div>
              <template v-if="task.activeSession">
                <div class="task-node-card__meta">
                  <div class="summary-card">
                    <span>{{ t("fields.agent") }}</span>
                    <strong>{{ task.activeSession.agentId }}</strong>
                  </div>
                  <div class="summary-card">
                    <span>{{ t("fields.approvals") }}</span>
                    <strong>{{ task.activeSession.pendingApprovalCount }}</strong>
                  </div>
                  <div class="summary-card">
                    <span>{{ t("fields.lastActivity") }}</span>
                    <strong>{{ task.activeSession.lastActivityAt }}</strong>
                  </div>
                  <div class="summary-card">
                    <span>Session source</span>
                    <strong>{{ sourceModeLabel(task.activeSession.sourceMode) }}</strong>
                  </div>
                </div>
              </template>
              <p class="panel-card__body">{{ sessionRelation(task) }}</p>
            </section>

            <section class="task-node-card__section">
              <div class="task-node-card__section-header">
                <strong>Retry and Requeue</strong>
                <span class="flow-pill">{{ sourceModeLabel(task.retry.sourceMode) }}</span>
              </div>
              <div class="task-node-card__meta">
                <div class="summary-card">
                  <span>Attempts</span>
                  <strong>{{ task.retry.attempts ?? "-" }}</strong>
                </div>
                <div class="summary-card">
                  <span>Max attempts</span>
                  <strong>{{ task.retry.maxAttempts }}</strong>
                </div>
                <div class="summary-card">
                  <span>Retryable</span>
                  <strong>{{ task.retry.retryable ? "Yes" : "No" }}</strong>
                </div>
                <div class="summary-card">
                  <span>Requeue</span>
                  <strong>{{ task.retry.requeueRecommended ? "Recommended" : "No" }}</strong>
                </div>
              </div>
              <p class="panel-card__body">{{ task.retry.summary }}</p>
              <p v-if="task.retry.lastFailureAt" class="task-node-card__reason">
                Last failure: {{ task.retry.lastFailureAt }}
              </p>
            </section>

            <div class="task-node-card__footer">
              <RouterLink v-if="taskPath(task.taskId)" class="ghost-link" :to="taskPath(task.taskId)!">
                Open task / session entry
              </RouterLink>
            </div>
          </article>
        </article>
      </section>

      <section class="panel-card task-board-edges">
        <div class="panel-card__header">
          <div>
            <p class="section-eyebrow">Dependency Edges</p>
            <h2>Explicit Edge Relationships</h2>
          </div>
          <span class="panel-chip">{{ projection.edges.length }}</span>
        </div>

        <div class="task-board-edge-list">
          <article
            v-for="edge in projection.edges"
            :key="edge.edgeId"
            class="summary-card task-board-edge"
            :data-state="edge.state"
          >
            <div class="task-node-card__section-header">
              <strong>{{ edge.fromTaskId }} -> {{ edge.toTaskId }}</strong>
              <span class="flow-pill">{{ edgeStateLabel(edge.state) }}</span>
            </div>
            <p class="panel-card__body">{{ edge.summary }}</p>
          </article>
        </div>
      </section>
    </template>
  </section>
</template>
