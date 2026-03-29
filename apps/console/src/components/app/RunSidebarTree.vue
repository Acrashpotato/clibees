<script setup lang="ts">
import { Plus } from "@element-plus/icons-vue";
import { ElScrollbar, ElTooltip, ElTree } from "element-plus";
import { computed } from "vue";

export type RunSidebarLeaf = "manager" | "workerpoll" | "workspace" | "tasks" | "approvals" | "inspect";

export interface RunSidebarTaskItem {
  runId: string;
  name: string;
  goal: string;
  status: string;
  updatedAt: string;
}

interface SidebarTreeNode {
  id: string;
  label: string;
  type: "root" | "run" | "leaf";
  runId?: string;
  leaf?: RunSidebarLeaf;
  meta?: string;
  tooltip?: string;
  children?: SidebarTreeNode[];
}

const props = defineProps<{
  runs: RunSidebarTaskItem[];
  activeRunId?: string;
  activeLeaf?: RunSidebarLeaf;
  expandedRunIds: string[];
  loading: boolean;
}>();

const emit = defineEmits<{
  "open-root": [];
  "open-create": [];
  "select-run": [runId: string];
  "select-leaf": [payload: { runId: string; leaf: RunSidebarLeaf }];
  "expand-run": [runId: string];
  "collapse-run": [runId: string];
}>();

const sectionItems = [
  { id: "manager" as const, label: "总管" },
  { id: "workerpoll" as const, label: "工位池" },
  { id: "workspace" as const, label: "工作台" },
  { id: "tasks" as const, label: "执行车道" },
  { id: "approvals" as const, label: "审批" },
  { id: "inspect" as const, label: "审计" },
];

const currentNodeKey = computed(() => {
  if (props.activeRunId && props.activeLeaf) {
    return `leaf:${props.activeRunId}:${props.activeLeaf}`;
  }
  if (props.activeRunId) {
    return `run:${props.activeRunId}`;
  }
  return "root:runs";
});

const expandedKeys = computed(() => [
  "root:runs",
  ...props.expandedRunIds.map((runId) => `run:${runId}`),
]);

const treeRenderKey = computed(() =>
  [...expandedKeys.value, currentNodeKey.value, String(props.runs.length)].join("|"),
);

const treeData = computed<SidebarTreeNode[]>(() => [
  {
    id: "root:runs",
    label: "运行中心",
    type: "root",
    meta: `${props.runs.length} 个任务`,
    children: props.runs.map((run) => ({
      id: `run:${run.runId}`,
      label: run.name,
      type: "run",
      runId: run.runId,
      meta: `${formatRunStatus(run.status)} · ${formatTimestamp(run.updatedAt)}`,
      tooltip: `${run.name}\n${run.runId}\n${run.goal}`,
      children: sectionItems.map((section) => ({
        id: `leaf:${run.runId}:${section.id}`,
        label: section.label,
        type: "leaf",
        runId: run.runId,
        leaf: section.id,
      })),
    })),
  },
]);

function formatRunStatus(status: string): string {
  switch (status) {
    case "running":
      return "运行中";
    case "awaiting_approval":
      return "待审批";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "已暂停";
  }
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function handleNodeClick(data: SidebarTreeNode): void {
  if (data.type === "root") {
    emit("open-root");
    return;
  }

  if (data.type === "run" && data.runId) {
    emit("select-run", data.runId);
    return;
  }

  if (data.type === "leaf" && data.runId && data.leaf) {
    emit("select-leaf", {
      runId: data.runId,
      leaf: data.leaf,
    });
  }
}

function handleNodeExpand(data: SidebarTreeNode): void {
  if (data.type === "run" && data.runId) {
    emit("expand-run", data.runId);
  }
}

function handleNodeCollapse(data: SidebarTreeNode): void {
  if (data.type === "run" && data.runId) {
    emit("collapse-run", data.runId);
  }
}
</script>

<template>
  <aside class="run-sidebar">
    <div class="run-sidebar__brand">
      <div class="run-sidebar__brand-copy">
        <p class="run-sidebar__product">CLIBEES</p>
        <p class="run-sidebar__caption">Multi-agent orchestration console</p>
      </div>
      <button class="run-sidebar__create" type="button" @click="emit('open-create')">
        <el-icon><Plus /></el-icon>
      </button>
    </div>

    <ElScrollbar class="run-sidebar__scroll">
      <div class="run-sidebar__tree-wrap">
        <ElTree
          :key="treeRenderKey"
          class="run-sidebar__tree"
          node-key="id"
          :data="treeData"
          :default-expanded-keys="expandedKeys"
          :current-node-key="currentNodeKey"
          :expand-on-click-node="false"
          :highlight-current="true"
          @node-click="handleNodeClick"
          @node-expand="handleNodeExpand"
          @node-collapse="handleNodeCollapse"
        >
          <template #default="{ data }">
            <div class="sidebar-tree-node" :data-kind="data.type">
              <template v-if="data.type === 'root'">
                <span class="sidebar-tree-node__label">{{ data.label }}</span>
                <span class="sidebar-tree-node__count">{{ runs.length }}</span>
              </template>

              <template v-else-if="data.type === 'run'">
                <ElTooltip :content="data.tooltip" placement="right" effect="dark">
                  <div class="sidebar-tree-node__run">
                    <span class="sidebar-tree-node__label">{{ data.label }}</span>
                    <span class="sidebar-tree-node__meta">{{ data.meta }}</span>
                  </div>
                </ElTooltip>
              </template>

              <template v-else>
                <span class="sidebar-tree-node__leaf-dot" />
                <span class="sidebar-tree-node__label">{{ data.label }}</span>
              </template>
            </div>
          </template>
        </ElTree>

        <p v-if="loading" class="run-sidebar__hint">正在同步运行中心...</p>
        <p v-else-if="runs.length === 0" class="run-sidebar__hint">点击右上角加号，创建第一个任务分支。</p>
      </div>
    </ElScrollbar>
  </aside>
</template>
