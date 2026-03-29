export const settingsSections = [
  {
    id: "run",
    label: "运行",
    path: "/settings/run",
    routeName: "settings-run",
    eyebrow: "运行设置",
    title: "创建与进入默认行为",
    description: "统一 run 创建时的 CLI、默认进入位置和写入权限。",
  },
  {
    id: "approvals",
    label: "审批",
    path: "/settings/approvals",
    routeName: "settings-approvals",
    eyebrow: "审批设置",
    title: "审批筛选与刷新策略",
    description: "减少审批页的重复筛选、分页和刷新操作。",
  },
  {
    id: "inspect",
    label: "审计",
    path: "/settings/inspect",
    routeName: "settings-inspect",
    eyebrow: "审计设置",
    title: "审计默认视图与刷新",
    description: "约束默认 run 来源和自动刷新行为，降低排查成本。",
  },
  {
    id: "workspace",
    label: "Workspace",
    path: "/settings/workspace",
    routeName: "settings-workspace",
    eyebrow: "Workspace 设置",
    title: "Workspace 轮询频率",
    description: "控制工作区页自动轮询的频率，平衡及时性和噪声。",
  },
  {
    id: "multi-agent",
    label: "多代理管理",
    path: "/settings/multi-agent",
    routeName: "settings-multi-agent",
    eyebrow: "多代理管理",
    title: "Run 与 Memory 数据管理",
    description: "查看占用情况，并按需清理 run 数据和 memory 记录。",
  },
] as const;

export type SettingsSectionId = (typeof settingsSections)[number]["id"];

const settingsSectionIdByRouteName = new Map<string, SettingsSectionId>(
  settingsSections.map((section) => [section.routeName, section.id]),
);

const settingsSectionById = new Map<SettingsSectionId, (typeof settingsSections)[number]>(
  settingsSections.map((section) => [section.id, section]),
);

export function getSettingsSectionIdFromRouteName(routeName: string): SettingsSectionId {
  return settingsSectionIdByRouteName.get(routeName) ?? "run";
}

export function getSettingsSectionPath(sectionId: SettingsSectionId): string {
  return settingsSectionById.get(sectionId)?.path ?? "/settings/run";
}

export function getSettingsSectionMeta(sectionId: SettingsSectionId) {
  return settingsSectionById.get(sectionId) ?? settingsSections[0];
}
