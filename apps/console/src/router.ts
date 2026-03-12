import { createRouter, createWebHistory } from "vue-router";

import ApprovalsPage from "./pages/ApprovalsPage.vue";
import InspectPage from "./pages/InspectPage.vue";
import PlaceholderPage from "./pages/PlaceholderPage.vue";
import LaneConsolePage from "./pages/LaneConsolePage.vue";
import RunsPage from "./pages/RunsPage.vue";
import WorkspaceHandoffsPage from "./pages/WorkspaceHandoffsPage.vue";
import WorkspaceFocusPage from "./pages/WorkspaceFocusPage.vue";
import WorkspaceLanesPage from "./pages/WorkspaceLanesPage.vue";
import WorkspacePage from "./pages/WorkspacePage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/workspace"
    },
    {
      path: "/workspace",
      name: "workspace",
      component: WorkspacePage
    },
    {
      path: "/workspace/lanes",
      name: "workspace-lanes",
      component: WorkspaceLanesPage
    },
    {
      path: "/workspace/handoffs",
      name: "workspace-handoffs",
      component: WorkspaceHandoffsPage
    },
    {
      path: "/workspace/focus",
      name: "workspace-focus",
      component: WorkspaceFocusPage
    },
    {
      path: "/runs/:runId/workspace",
      name: "run-workspace",
      component: WorkspacePage
    },
    {
      path: "/runs/:runId/workspace/lanes",
      name: "run-workspace-lanes",
      component: WorkspaceLanesPage
    },
    {
      path: "/runs/:runId/workspace/handoffs",
      name: "run-workspace-handoffs",
      component: WorkspaceHandoffsPage
    },
    {
      path: "/runs/:runId/workspace/focus",
      name: "run-workspace-focus",
      component: WorkspaceFocusPage
    },
    {
      path: "/runs/:runId/lanes/:laneId?",
      name: "lane-console",
      component: LaneConsolePage
    },
    {
      path: "/runs",
      name: "runs",
      component: RunsPage
    },
    {
      path: "/runs/new",
      name: "runs-new",
      component: RunsPage
    },
    {
      path: "/approvals",
      name: "approvals",
      component: ApprovalsPage
    },
    {
      path: "/inspect",
      name: "inspect",
      component: InspectPage
    },
    {
      path: "/settings",
      name: "settings",
      component: PlaceholderPage,
      props: {
        eyebrowKey: "nav.settings",
        titleKey: "placeholder.settingsTitle",
        descriptionKey: "placeholder.settingsDescription"
      }
    }
  ]
});
