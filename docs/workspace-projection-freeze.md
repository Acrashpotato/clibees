# 工作台 projection 冻结

## 目标

冻结 `workspaceProjection` 的字段边界、焦点选择规则、过渡期回填方式与职责边界，使 Workspace 页面后续能够围绕真实 `run`、`task`、`taskSession` 语义展示以下内容：

- run 概览
- 焦点 task
- 活动 session
- 动作队列
- 依赖摘要
- 风险摘要
- 待处理消息
- 控制动作

本文只覆盖任务 12，不展开任务 13 的任务板 projection、任务 15 的会话详情 projection、任务 18 的最终 REST 资源路径，也不提前执行任务 21/22 的 console 类型与页面重构。

## 冻结结论

1. `workspaceProjection` 是 Workspace 页唯一主 projection，主实体是 `run`，但必须内嵌一个显式“焦点 task”和一个显式“活动 session”摘要。
2. Workspace 页只负责当前运行中的总控视角与近实时决策信息，不承载完整 task DAG、完整 session transcript 或完整审计时间线。
3. `focusTask` 与 `activeSession` 必须分离建模，禁止继续让旧 `focusLane` 同时充当任务焦点和会话焦点。
4. 在 `taskSession`、`messageThread`、`sessionMessage` 真源落地前，允许用 `task.status` 和 `run_event` 做过渡回填，但必须显式标注来源模式，不能伪装为真实 session / message 视图。
5. Workspace 页暴露的控制动作只允许是与当前总控决策直接相关的动作摘要，动作的最终 REST 端点和提交参数留到任务 18 冻结。

## projection 结构

```ts
interface WorkspaceProjectionView {
  projection: "workspace";
  generatedAt: string;
  run: WorkspaceRunSummaryView;
  focusTask?: WorkspaceFocusTaskView;
  activeSession?: WorkspaceActiveSessionView;
  actionQueue: WorkspaceActionQueueItemView[];
  dependencySummary: WorkspaceDependencySummaryView;
  riskSummary: WorkspaceRiskSummaryView;
  pendingMessages: WorkspacePendingMessageSummaryView;
  controlActions: WorkspaceControlActionView[];
}
```

### `run`

`run` 摘要只承载总控级信息：

```ts
interface WorkspaceRunSummaryView {
  runId: string;
  goal: string;
  status: WorkspaceLaneStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  totalTaskCount: number;
  completedTaskCount: number;
  activeTaskCount: number;
  activeSessionCount: number;
  blockedTaskCount: number;
  pendingApprovalCount: number;
  sessionSourceMode: "task_session" | "task_status_backfill";
  canResume: boolean;
}
```

约束：

- `status` 仍固定映射自 `run.status`。
- `activeSessionCount` 在当前仓库阶段允许按 `task.status in { running, awaiting_approval }` 回填。
- `sessionSourceMode` 必须显式区分真实 `taskSession` 计数与回填值。

### `focusTask`

```ts
interface WorkspaceFocusTaskView {
  taskId: string;
  title: string;
  status: WorkspaceLaneStatus;
  statusReason: string;
  ownerLabel: string;
  riskLevel: RiskLevel;
  lastActivityAt: string;
  dependsOn: string[];
  downstreamTaskIds: string[];
  selectionMode:
    | "run_current_task"
    | "approval_priority"
    | "blocked_priority"
    | "active_fallback"
    | "first_task_fallback";
}
```

焦点选择顺序冻结为：

1. `run.currentTaskId`
2. 首个 `awaiting_approval` task
3. 首个 `blocked` task
4. 首个活动 task
5. 图中的首个 task

### `activeSession`

```ts
interface WorkspaceActiveSessionView {
  sessionId?: string;
  taskId: string;
  taskTitle: string;
  agentId: string;
  status: WorkspaceLaneStatus;
  statusReason: string;
  lastActivityAt: string;
  terminalPreview: string[];
  pendingApprovalCount: number;
  sourceMode: "task_session" | "task_status_backfill";
}
```

约束：

- `activeSession` 的主目标是让 Workspace 知道“当前应该把哪个会话入口当成主入口”，不是承载完整 transcript。
- 当 `taskSession` 未落地时，允许以 `running` / `awaiting_approval` task 回填一个会话摘要。
- 回填时 `sessionId` 可以为空，但 `sourceMode` 必须是 `task_status_backfill`。

### `actionQueue`

```ts
interface WorkspaceActionQueueItemView {
  id: string;
  kind: "approval_request" | "blocked_task" | "pending_message" | "risk" | "run_control";
  title: string;
  summary: string;
  priority: number;
  tone: "neutral" | "warning" | "danger";
  targetType: "run" | "task" | "task_session" | "approval_request" | "thread";
  targetId: string;
  recommendedAction:
    | "resume"
    | "review_approval"
    | "interact"
    | "requeue"
    | "cancel"
    | "interrupt"
    | "inspect";
}
```

动作队列优先级冻结为：

1. 待审批请求
2. 焦点 blocked task
3. 待处理消息
4. run 级继续动作

### `dependencySummary`

```ts
interface WorkspaceDependencySummaryView {
  focusTaskId?: string;
  upstreamPendingCount: number;
  upstreamBlockedCount: number;
  downstreamReadyCount: number;
  downstreamWaitingCount: number;
  summary: string;
}
```

Workspace 只展示与焦点 task 直接相关的一层上下游摘要，不展示完整 DAG 布局或全图边列表。

### `riskSummary`

```ts
interface WorkspaceRiskSummaryView {
  highestRiskLevel: RiskLevel | "none";
  pendingApprovalCount: number;
  blockedTaskCount: number;
  failedTaskCount: number;
  warningCount: number;
  headlines: string[];
}
```

`headlines` 只允许携带高优先级风险摘要，例如最新 failure、最新 blocker、最新 validation、最高优先级待审批摘要。

### `pendingMessages`

```ts
interface WorkspacePendingMessageSummaryView {
  pendingThreadCount: number;
  unreadMessageCount: number;
  latestMessageAt?: string;
  sourceMode: "thread_messages" | "run_event_backfill";
  summary: string;
  items: WorkspacePendingMessageItemView[];
}
```

过渡期约束：

- 当前仓库没有正式 `messageThread` / `sessionMessage` 真源。
- 过渡期允许从 `run_event` 中回填 `agent_message`、`approval_requested`、`task_blocked`、`task_failed`、`validation_failed`。
- `pendingMessages` 是工作台入口摘要，不是最终消息中心。

### `controlActions`

```ts
interface WorkspaceControlActionView {
  actionId: "resume" | "review_approval" | "interact" | "requeue" | "cancel" | "interrupt";
  label: string;
  scope: "run" | "task" | "task_session" | "approval_request" | "thread";
  targetId: string;
  enabled: boolean;
  reason: string;
}
```

约束：

- Workspace 必须能显示“现在可做什么”与“为什么现在不能做”。
- `interact` 与 `interrupt` 在 `taskSession` / `thread` 未落地前可以存在，但必须显式禁用并解释原因。

## 字段准源与归约规则

| 字段组 | 准源 | 归约规则 |
| --- | --- | --- |
| `run` | `run_record` + `run_graph` + `approval_request` | 统计完成数、活动 task 数、过渡期活动 session 数、阻塞数和待审批数 |
| `focusTask` | `run_record.currentTaskId` + `task_record` + `run_graph` | 按冻结的焦点选择顺序选出一个 task |
| `activeSession` | `taskSession`；过渡期允许 `task_record` + `run_event` | 正式使用 `taskSession`，当前可用 task 状态和最近事件回填 |
| `actionQueue` | `approval_request` + `task_record` + `run_event` | 仅保留当前需要决策的高优先级项目 |
| `dependencySummary` | `run_graph` + `task_record` | 只计算焦点 task 一层上下游 |
| `riskSummary` | `approval_request` + `validation_record` + `task_record` | 聚合风险等级、阻塞、失败和警告摘要 |
| `pendingMessages` | `message_thread` / `session_message`；过渡期允许 `run_event` | 正式以 thread/message 为准，当前允许事件回填 |
| `controlActions` | `run`、`task`、`taskSession`、`approvalRequest` 状态机 | 只输出工作台必须暴露的动作与可用性说明 |

## Workspace 页职责边界

Workspace 页允许展示：

- 当前 run 的总控摘要
- 一个焦点 task
- 一个活动 session 摘要
- 高优先级动作队列
- 焦点依赖压力摘要
- 风险与待处理消息摘要
- 可执行或被禁用的控制动作

Workspace 页禁止展示：

- 完整 task DAG 与全量边布局
- 全量 sibling task 详情
- 全量 session transcript、工具调用列表、artifact 列表
- 全量审批快照与 `actionPlans`
- 全量审计时间线

## 过渡期实现约束

1. 当前仓库可以继续保留旧 `buildWorkspaceView(inspection)` 适配器，以兼容现有 console 页面。
2. 任务 12 必须新增专用 `build-workspace-projection.ts`，作为 Workspace 正式 projection 的 builder 入口。
3. 在任务 18 前，不强制要求现有 `/api/runs/:runId/workspace` 立即切换到最终 REST 形状；但后续切换必须以本文件冻结的字段语义为准。
4. 在任务 21/22 前，不提前重命名 console 里的 `LaneView`、`focusLaneId` 或 Workspace 页面组件结构；这些属于后续 UI 收敛工作，而不是本任务。
5. 一旦 `taskSession` 和消息线程模型落地，`activeSession.sourceMode` 与 `pendingMessages.sourceMode` 必须从回填模式切换到真实源模式。

## 与当前仓库的直接约束

1. [`src/ui-read-models/build-workspace-projection.ts`](../src/ui-read-models/build-workspace-projection.ts) 是工作台 projection 的专用 builder 入口。
2. [`src/ui-read-models/build-views.ts`](../src/ui-read-models/build-views.ts) 中的 `buildWorkspaceView` 仍然只是过渡期 console 适配器，不得继续扩展为正式长期契约。
3. [`src/ui-read-models/projection-contracts.ts`](../src/ui-read-models/projection-contracts.ts) 中 `workspace` 的 primary sources 必须覆盖 `run_event`、`validation_record`、`message_thread`、`session_message`，避免把消息和风险摘要继续埋进 ad hoc 视图。

## 非目标

任务 12 不定义：

- 任务板 DAG 节点与边的最终结构
- task 详情页的上游/下游全量信息
- session 详情页的 transcript / tool call / artifact 子视图
- 审批页的 `actionPlans` 详细快照结构
- 最终 REST 路径、分页与游标策略
