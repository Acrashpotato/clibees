import { createRouter, createWebHistory } from "vue-router";

import ApprovalsPage from "./pages/ApprovalsPage.vue";
import InspectPage from "./pages/InspectPage.vue";
import PlaceholderPage from "./pages/PlaceholderPage.vue";
import LaneConsolePage from "./pages/LaneConsolePage.vue";
import RunsPage from "./pages/RunsPage.vue";
import SessionDetailPage from "./pages/SessionDetailPage.vue";
import TaskDetailPage from "./pages/TaskDetailPage.vue";
import WorkspaceLanesPage from "./pages/WorkspaceLanesPage.vue";
import WorkspacePage from "./pages/WorkspacePage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/workspace",
    },
    {
      path: "/workspace",
      name: "workspace",
      component: WorkspacePage,
    },
    {
      path: "/workspace/lanes",
      name: "workspace-lanes",
      component: WorkspaceLanesPage,
    },
    {
      path: "/workspace/handoffs",
      redirect: "/workspace",
    },
    {
      path: "/workspace/focus",
      redirect: "/workspace",
    },
    {
      path: "/runs/:runId/workspace",
      name: "run-workspace",
      component: WorkspacePage,
    },
    {
      path: "/runs/:runId/workspace/lanes",
      name: "run-workspace-lanes",
      component: WorkspaceLanesPage,
    },
    {
      path: "/runs/:runId/workspace/handoffs",
      redirect: (to) => ({ name: "run-workspace", params: { runId: to.params.runId } }),
    },
    {
      path: "/runs/:runId/workspace/focus",
      redirect: (to) => ({ name: "run-workspace", params: { runId: to.params.runId } }),
    },
    {
      path: "/runs/:runId/tasks/:taskId",
      name: "task-detail",
      component: TaskDetailPage,
    },
    {
      path: "/runs/:runId/sessions/:sessionId",
      name: "session-detail",
      component: SessionDetailPage,
    },
    {
      path: "/runs/:runId/lanes/:laneId?",
      name: "legacy-lane-route",
      component: LaneConsolePage,
    },
    {
      path: "/runs",
      name: "runs",
      component: RunsPage,
    },
    {
      path: "/runs/new",
      name: "runs-new",
      component: RunsPage,
    },
    {
      path: "/approvals",
      name: "approvals",
      component: ApprovalsPage,
    },
    {
      path: "/inspect",
      name: "inspect",
      component: InspectPage,
    },
    {
      path: "/settings",
      name: "settings",
      component: PlaceholderPage,
      props: {
        eyebrowKey: "nav.settings",
        titleKey: "placeholder.settingsTitle",
        descriptionKey: "placeholder.settingsDescription",
      },
    },
  ],
});
