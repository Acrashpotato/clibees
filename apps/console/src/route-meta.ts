export type ToolbarLabelKey =
  | "nav.runs"
  | "nav.manager"
  | "nav.workerpoll"
  | "nav.workspace"
  | "sections.multiLaneBoard"
  | "nav.approvals"
  | "nav.inspect"
  | "nav.settings";

export interface PrimaryNavItemDefinition {
  id: "runs" | "manager" | "workerpoll" | "workspace" | "task-board" | "approvals" | "inspect" | "settings";
  labelKey: string;
  requiresRun: boolean;
  to: (runId?: string) => string;
  isActive: (path: string) => boolean;
}

export interface PrimaryNavItem {
  id: PrimaryNavItemDefinition["id"];
  labelKey: string;
  requiresRun: boolean;
  to: string;
  isActive: boolean;
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

const PRIMARY_NAV_DEFINITIONS: PrimaryNavItemDefinition[] = [
  {
    id: "runs",
    labelKey: "nav.runs",
    requiresRun: false,
    to: () => "/runs",
    isActive: (path) => matchesPrefix(path, "/runs"),
  },
];

export function isWideContentRoute(path: string): boolean {
  return matchesPrefix(path, "/runs") || matchesPrefix(path, "/settings");
}

export function resolvePrimaryNavItems(path: string, runId?: string): PrimaryNavItem[] {
  return PRIMARY_NAV_DEFINITIONS.map((item) => ({
    id: item.id,
    labelKey: item.labelKey,
    requiresRun: item.requiresRun,
    to: item.to(runId),
    isActive: item.isActive(path),
  }));
}

export function resolveToolbarLabelKey(path: string): ToolbarLabelKey {
  if (/^\/runs\/[^/]+\/manager$/.test(path)) {
    return "nav.manager";
  }

  if (/^\/runs\/[^/]+\/workerpoll$/.test(path)) {
    return "nav.workerpoll";
  }

  if (/^\/runs\/[^/]+\/workspace$/.test(path)) {
    return "nav.workspace";
  }

  if (/^\/runs\/[^/]+\/(?:tasks|sessions)(?:$|\/)/.test(path)) {
    return "sections.multiLaneBoard";
  }

  if (/^\/runs\/[^/]+\/approvals$/.test(path)) {
    return "nav.approvals";
  }

  if (/^\/runs\/[^/]+\/inspect$/.test(path)) {
    return "nav.inspect";
  }

  if (matchesPrefix(path, "/settings")) {
    return "nav.settings";
  }

  return "nav.runs";
}

