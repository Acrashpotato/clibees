# 任务板 projection 冻结

## 目标

冻结 `taskBoardProjection` 的字段边界、准源、节点/依赖边语义与过渡期回填方式，使任务板页面后续能围绕真实 `task graph` 展示：

- task DAG
- 依赖边
- 等待原因
- 责任 agent
- 活动 session
- 最近活动
- 重试 / 重派信息

本文只覆盖任务 13，不展开任务 14 的任务详情 projection、任务 15 的会话详情 projection、任务 18 的最终 REST 资源路径，也不提前执行任务 21/23/24 的 console 页面重构。

## 冻结结论

1. `taskBoardProjection` 是任务板页面唯一主 projection，主实体是 `task graph`，不是 `run` 总控视图，也不是单一 `task` 详情视图。
2. 任务板必须显式拆出“节点”和“依赖边”两层结构，禁止继续把 DAG 关系压扁成 lane 列表或 handoff 卡片。
3. 节点必须同时承载任务状态、等待原因、责任 agent、最近活动、活动 session 摘要和重试/重派摘要，但不能承载完整 transcript、审批快照全文或 artifact 列表。
4. 在正式 `taskSession` 与 `task_record` 真源全面接入前，允许把活动 session 与尝试次数按 `task.status` / `run_event` 回填，但必须显式标注 `sourceMode`，不能伪装为真实会话或精确 task record。
5. 任务板只展示与图结构直接相关的摘要，不承担 Workspace 的焦点选择、Approvals 的审批正文、Inspect 的审计回放职责。

## projection 结构

```ts
interface TaskBoardProjectionView {
  projection: "task_board";
  generatedAt: string;
  runId: string;
  graphRevision: number;
  currentTaskId?: string;
  summary: TaskBoardGraphSummaryView;
  tasks: TaskBoardTaskNodeView[];
  edges: TaskBoardDependencyEdgeView[];
}
```

### `summary`

```ts
interface TaskBoardGraphSummaryView {
  totalTaskCount: number;
  completedTaskCount: number;
  activeTaskCount: number;
  blockedTaskCount: number;
  failedTaskCount: number;
  pendingApprovalCount: number;
  activeSessionCount: number;
  dependencyEdgeCount: number;
}
```

约束：

- `summary` 只允许承载图级统计，不承载 Workspace 焦点、审批正文或 Inspect 时间线。
- `activeSessionCount` 在当前仓库阶段允许按 `task.status in { running, awaiting_approval }` 回填。
- `graphRevision` 是图版本标识，不是新的调度状态机。

### `tasks`

```ts
interface TaskBoardTaskNodeView {
  taskId: string;
  title: string;
  kind: string;
  status: WorkspaceLaneStatus;
  statusReason: string;
  waitingReason?: string;
  ownerLabel: string;
  riskLevel: RiskLevel;
  dependsOn: string[];
  downstreamTaskIds: string[];
  depth: number;
  latestActivityAt: string;
  latestActivitySummary: string;
  activeSession?: TaskBoardActiveSessionView;
  retry: TaskBoardRetrySummaryView;
}
```

补充结构：

```ts
interface TaskBoardActiveSessionView {
  sessionId?: string;
  agentId: string;
  status: WorkspaceLaneStatus;
  lastActivityAt: string;
  pendingApprovalCount: number;
  sourceMode: "task_session" | "task_status_backfill";
}

interface TaskBoardRetrySummaryView {
  attempts?: number;
  maxAttempts: number;
  retryable: boolean;
  requeueRecommended: boolean;
  sourceMode: "task_record" | "status_event_backfill";
  lastFailureAt?: string;
  summary: string;
}
```

约束：

- `statusReason` 是节点当前状态摘要；`waitingReason` 只在 pending、approval、blocked、failed 等需要解释等待/受阻原因时出现。
- `ownerLabel` 固定用于展示责任 agent / 能力归属，避免继续混用 lane 角色文案。
- `depth` 只服务任务板布局排序或分层展示，不是新的拓扑真源。
- `activeSession` 只是进入会话详情的板级摘要，不承载 terminal preview 或消息流。
- `retry` 必须明确区分“仍可重试”和“需要重派新 session”；当前仓库没有正式 `task_record` 聚合时，允许从 `task_started` / `task_failed` / `validation_failed` 事件近似回填。

### `edges`

```ts
interface TaskBoardDependencyEdgeView {
  edgeId: string;
  fromTaskId: string;
  toTaskId: string;
  state: "satisfied" | "active" | "waiting" | "blocked";
  summary: string;
}
```

约束：

- 每条依赖边必须能表达“已满足、上游进行中、等待上游、上游阻塞”四类状态。
- `summary` 只解释该依赖关系本身，不承担 run 级或 session 级额外语义。

## 字段准源与归约规则

| 字段组 | 准源 | 归约规则 |
| --- | --- | --- |
| `summary` | `run_graph` + `task_record` + `task_session` + `approval_request` | 统计任务总数、活动数、阻塞数、失败数、待审批数与过渡期活动 session 数 |
| `tasks[].status/statusReason` | `task_record` / `run_graph.tasks` + `approval_request` + `validation_record` | 任务主状态来自 task，自定义摘要可引用待审批或验证结果 |
| `tasks[].waitingReason` | `run_graph` + `approval_request` + `validation_record` + `run_event` | 仅在需要解释等待/受阻时出现 |
| `tasks[].ownerLabel` | `task_record` / `run_graph.tasks` | 优先级：`assignedAgent` > `preferredAgent` > `requiredCapabilities` |
| `tasks[].latestActivity*` | `run_event` + `validation_record` | 优先取最近事件，其次取最近验证记录 |
| `tasks[].activeSession` | `taskSession`；过渡期允许 `task_record` + `run_event` | 正式使用真实 session，当前允许按活动 task 回填 |
| `tasks[].retry` | `task_record`；过渡期允许 `run_event` + `task.retryPolicy` | 正式读取 attempts，当前允许按开始/失败事件近似估算 |
| `edges[]` | `run_graph` + 上游/下游 task 状态 | 依赖边状态由上游 task 状态归约得到 |

## 任务板页面职责边界

任务板允许展示：

- 任务 DAG 节点与边
- 节点级等待原因、责任归属、最近活动
- 节点级活动 session 摘要
- 节点级重试 / 重派摘要
- 图级统计摘要

任务板禁止展示：

- Workspace 焦点选择与动作队列
- session transcript、工具调用明细、terminal preview
- 审批 `actionPlans` 全量快照
- artifact 列表全文
- Inspect 时间线回放

## 过渡期实现约束

1. 当前仓库必须新增 `build-task-board-projection.ts`，作为任务板 projection 的专用 builder 入口。
2. 过渡期 builder 可以从 `RunInspection` 读取数据，但输出字段只能落在本文件冻结的任务板语义内，不能继续把 `RunInspection` 当成任务板正式契约。
3. 在任务 18 前，不要求现有 API 立即暴露任务板显式端点；后续端点设计必须兼容本文件字段语义。
4. 在任务 23/24 前，不提前重构 `WorkspaceLanesPage`、`LaneConsolePage` 或兼容路由；这些属于页面与路由收敛工作，不属于本轮。
5. 一旦 `taskSession` 与 `task_record` 真源补齐，`activeSession.sourceMode` 与 `retry.sourceMode` 必须从回填模式切换到真实源模式。

## 与当前仓库的直接约束

1. [`src/ui-read-models/build-task-board-projection.ts`](../src/ui-read-models/build-task-board-projection.ts) 是任务板 projection 的专用 builder 入口。
2. [`src/ui-read-models/projection-contracts.ts`](../src/ui-read-models/projection-contracts.ts) 中 `task_board` 的 primary sources 必须覆盖 `approval_request`、`validation_record`、`run_event`，否则无法稳定表达等待原因、最近活动与重试摘要。
3. [`src/ui-read-models/build-views.ts`](../src/ui-read-models/build-views.ts) 中现有 lane / handoff 适配器仍是旧 UI 兼容层，不得继续扩展成任务板长期契约。
4. [`apps/console/src/pages/WorkspaceLanesPage.vue`](../apps/console/src/pages/WorkspaceLanesPage.vue) 的后续重构必须消费本任务冻结的节点/边语义，而不是继续把 task DAG 折叠成 lane 卡片集合。

## 非目标

任务 13 不定义：

- task 详情页的上游 / 下游全量详情字段
- session 详情页的 transcript / tool call / artifact 子视图
- 审批页的 `actionPlans` 快照结构
- 最终 REST 路径、分页与游标策略
- console 页面实际布局与视觉重构