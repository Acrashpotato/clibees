<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { listRuns, resumeRun } from "../api";
import { usePreferences } from "../composables/usePreferences";
import { getTaskConsolePath } from "../workspace";

type TaskBoardProjectionStatus =
  | "running"
  | "awaiting_approval"
  | "blocked"
  | "paused"
  | "completed"
  | "failed";

type TaskBoardProjectionRiskLevel = "low" | "medium" | "high";
type TaskBoardSessionSourceMode = "task_session" | "task_status_backfill";
type TaskBoardRetrySourceMode = "task_record" | "status_event_backfill";
type TaskBoardDependencyState = "satisfied" | "active" | "waiting" | "blocked";

interface TaskBoardGraphSummary {
  totalTaskCount: number;
  completedTaskCount: number;
  activeTaskCount: number;
  blockedTaskCount: number;
  failedTaskCount: number;
  pendingApprovalCount: number;
  activeSessionCount: number;
  dependencyEdgeCount: number;
}

interface TaskBoardActiveSession {
  sessionId?: string;
  agentId: string;
  status: TaskBoardProjectionStatus;
  lastActivityAt: string;
  pendingApprovalCount: number;
  sourceMode: TaskBoardSessionSourceMode;
}

interface TaskBoardRetrySummary {
  attempts?: number;
  maxAttempts: number;
  retryable: boolean;
  requeueRecommended: boolean;
  sourceMode: TaskBoardRetrySourceMode;
  lastFailureAt?: string;
  summary: string;
}

interface TaskBoardTaskNode {
  taskId: string;
  title: string;
  kind: string;
  status: TaskBoardProjectionStatus;
  statusReason: string;
  waitingReason?: string;
  ownerLabel: string;
  riskLevel: TaskBoardProjectionRiskLevel;
  dependsOn: string[];
  downstreamTaskIds: string[];
  depth: number;
  latestActivityAt: string;
  latestActivitySummary: string;
  activeSession?: TaskBoardActiveSession;
  retry: TaskBoardRetrySummary;
}

interface TaskBoardDependencyEdge {
  edgeId: string;
  fromTaskId: string;
  toTaskId: string;
  state: TaskBoardDependencyState;
  summary: string;
}

interface TaskBoardProjectionView {
  projection: "task_board";
  generatedAt: string;
  runId: string;
  graphRevision: number;
  currentTaskId?: string;
  summary: TaskBoardGraphSummary;
  tasks: TaskBoardTaskNode[];
  edges: TaskBoardDependencyEdge[];
}

interface UiProjectionEnvelope<TProjection> {
  data: TProjection;
}

function createEmptyTaskBoardProjection(runId = "workspace"): TaskBoardProjectionView {
  return {
    projection: "task_board",
    generatedAt: "",
    runId,
    graphRevision: 0,
    summary: {
      totalTaskCount: 0,
      completedTaskCount: 0,
      activeTaskCount: 0,
      blockedTaskCount: 0,
      failedTaskCount: 0,
      pendingApprovalCount: 0,
      activeSessionCount: 0,
      dependencyEdgeCount: 0,
    },
    tasks: [],
    edges: [],
  };
}

async function getTaskBoardProjection(runId: string): Promise<TaskBoardProjectionView> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/projections/task-board`, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string | { message?: string };
    };
    const message =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message ?? `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  const payload = (await response.json()) as UiProjectionEnvelope<TaskBoardProjectionView>;
  return payload.data;
}

const route = useRoute();
const { riskLabel, statusLabel, t } = usePreferences();

const runScopeId = computed(() => (typeof route.params.runId === "string" ? route.params.runId : undefined));
const resolvedRunId = ref<string | undefined>(runScopeId.value);
const projection = ref<TaskBoardProjectionView>(createEmptyTaskBoardProjection(runScopeId.value));
const loading = ref(false);
const error = ref("");
const mutating = ref(false);
let pollHandle: ReturnType<typeof setInterval> | undefined;

function stopPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = undefined;
  }
}

function startPolling() {
  stopPolling();

  if (!resolvedRunId.value) {
    return;
  }

  pollHandle = setInterval(() => {
    void loadProjection(false);
  }, 2000);
}

async function resolveRunId(): Promise<string | undefined> {
  if (runScopeId.value) {
    return runScopeId.value;
  }

  const runs = await listRuns();
  return runs[0]?.runId;
}

async function loadProjection(showLoading = true): Promise<void> {
  if (showLoading) {
    loading.value = true;
  }

  try {
    error.value = "";
    resolvedRunId.value = await resolveRunId();

    if (!resolvedRunId.value) {
      projection.value = createEmptyTaskBoardProjection();
      stopPolling();
      return;
    }

    projection.value = await getTaskBoardProjection(resolvedRunId.value);
    startPolling();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
    stopPolling();
  } finally {
    loading.value = false;
  }
}

async function handleResume(): Promise<void> {
  if (!resolvedRunId.value || mutating.value) {
    return;
  }

  mutating.value = true;
  try {
    await resumeRun(resolvedRunId.value);
    await loadProjection(false);
  } finally {
    mutating.value = false;
  }
}

watch(
  () => route.fullPath,
  () => {
    void loadProjection();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopPolling();
});

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

<style scoped>
.task-board-page,
.task-board-hero,
.task-board-intro,
.task-board-column,
.task-node-card,
.task-board-edges {
  display: grid;
  gap: 16px;
}

.task-board-hero__top,
.task-node-card__top,
.task-node-card__section-header,
.task-node-card__footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}

.task-board-summary-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.task-board-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
  align-items: start;
}

.task-node-card {
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.02);
}

.task-node-card[data-current="true"] {
  border-color: rgba(87, 215, 210, 0.34);
  background: rgba(87, 215, 210, 0.08);
}

.task-node-card h3 {
  margin: 0;
  line-height: 1.35;
}

.task-node-card__meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.task-node-card__section {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--panel-subtle);
}

.task-node-card__section strong,
.task-node-card__section p {
  margin: 0;
}

.task-node-card__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.task-node-card__pill {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--text-secondary);
  font-size: 0.84rem;
}

.task-node-card__reason {
  color: var(--text-secondary);
  line-height: 1.5;
}

.task-board-edge-list {
  display: grid;
  gap: 10px;
}

.task-board-edge {
  display: grid;
  gap: 8px;
}

.task-board-edge[data-state="satisfied"] {
  border-color: rgba(117, 240, 174, 0.24);
}

.task-board-edge[data-state="active"] {
  border-color: rgba(87, 215, 210, 0.28);
}

.task-board-edge[data-state="blocked"] {
  border-color: rgba(255, 123, 112, 0.28);
}

@media (max-width: 1240px) {
  .task-board-summary-grid,
  .task-node-card__meta {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .task-board-hero__top,
  .task-node-card__top,
  .task-node-card__section-header,
  .task-node-card__footer {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
