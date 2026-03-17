import { createRouter, createWebHistory } from "vue-router";

import ApprovalsPage from "./pages/ApprovalsPage.vue";
import InspectPage from "./pages/InspectPage.vue";
import ManagerPage from "./pages/ManagerPage.vue";
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
      path: "/settings",
      name: "settings",
      component: SettingsPage,
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: "/runs",
    },
  ],
});
