import { createRouter, createWebHistory } from "vue-router";

import ApprovalsPage from "./pages/ApprovalsPage.vue";
import InspectPage from "./pages/InspectPage.vue";
import ManagerPage from "./pages/ManagerPage.vue";
import MultiAgentPage from "./pages/MultiAgentPage.vue";
import RunsPage from "./pages/RunsPage.vue";
import SettingsPage from "./pages/SettingsPage.vue";
import SessionDetailPage from "./pages/SessionDetailPage.vue";
import TaskDetailPage from "./pages/TaskDetailPage.vue";
import WorkerpollPage from "./pages/WorkerpollPage.vue";
import WorkspaceLanesPage from "./pages/WorkspaceLanesPage.vue";
import WorkspacePage from "./pages/WorkspacePage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/runs",
    },
    {
      path: "/runs",
      name: "runs",
      component: RunsPage,
      children: [
        {
          path: ":runId/manager",
          name: "run-manager",
          component: ManagerPage,
        },
        {
          path: ":runId/workerpoll",
          name: "run-workerpoll",
          component: WorkerpollPage,
        },
        {
          path: ":runId/workspace",
          name: "run-workspace",
          component: WorkspacePage,
        },
        {
          path: ":runId/tasks",
          name: "run-task-board",
          component: WorkspaceLanesPage,
        },
        {
          path: ":runId/approvals",
          name: "run-approvals",
          component: ApprovalsPage,
        },
        {
          path: ":runId/inspect",
          name: "run-inspect",
          component: InspectPage,
        },
      ],
    },
    {
      path: "/runs/new",
      name: "runs-new",
      component: RunsPage,
    },
    {
      path: "/runs/:runId/tasks/:taskId/summary",
      name: "task-detail-summary",
      component: TaskDetailPage,
    },
    {
      path: "/runs/:runId/tasks/:taskId/dependencies",
      name: "task-detail-dependencies",
      component: TaskDetailPage,
    },
    {
      path: "/runs/:runId/tasks/:taskId/sessions",
      name: "task-detail-sessions",
      component: TaskDetailPage,
    },
    {
      path: "/runs/:runId/tasks/:taskId/artifacts",
      name: "task-detail-artifacts",
      component: TaskDetailPage,
    },
    {
      path: "/runs/:runId/sessions/:sessionId/live",
      name: "session-detail-live",
      component: SessionDetailPage,
    },
    {
      path: "/runs/:runId/sessions/:sessionId/support",
      name: "session-detail-support",
      component: SessionDetailPage,
    },
    {
      path: "/runs/:runId/sessions/:sessionId/artifacts",
      name: "session-detail-artifacts",
      component: SessionDetailPage,
    },
    {
      path: "/settings",
      redirect: "/settings/run",
    },
    {
      path: "/settings/run",
      name: "settings-run",
      component: SettingsPage,
    },
    {
      path: "/settings/approvals",
      name: "settings-approvals",
      component: SettingsPage,
    },
    {
      path: "/settings/inspect",
      name: "settings-inspect",
      component: SettingsPage,
    },
    {
      path: "/settings/workspace",
      name: "settings-workspace",
      component: SettingsPage,
    },
    {
      path: "/settings/multi-agent",
      name: "settings-multi-agent",
      component: MultiAgentPage,
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: "/runs",
    },
  ],
});
