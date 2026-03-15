# 任务详情 projection 冻结

## 目标

冻结 `taskDetailProjection` 的字段边界、依赖上下游摘要、关联 sessions 过渡回填方式，以及最新审批、验证结果与 artifact 摘要的职责边界，使任务详情页后续能够围绕真实 `task` 语义展示以下内容：

- task 概览
- 上游与下游依赖任务
- 关联 sessions
- 最新审批
- 验证结果
- artifact 摘要

本文只覆盖任务 14，不展开任务 15 的会话详情 projection、任务 16 的审批 projection、任务 17 的审计时间线 projection、任务 18 的最终 REST 资源路径，也不提前执行任务 24 的页面与路由收敛。

## 冻结结论

1. `taskDetailProjection` 是任务详情页唯一主 projection，主实体是单个 `task`，入口必须是 `taskId`。
2. 任务详情页必须展示该 `task` 的上下游依赖任务、关联 sessions、最新审批、最新验证摘要与 artifact 摘要，但不能越界承担 workspace 总控、全局审批队列或全量审计回放职责。
3. `sessions` 必须建模为集合，而不是继续假设“一个 task 永远只有一个 lane / session”；在正式 `taskSession` 真源落地前，允许按 `task_started` 事件窗口回填 session 摘要，并显式标注 `sourceMode`。
4. `latestApproval` 只表达当前 task 最近一次审批事实，不承担完整审批历史与 `actionPlans` 全量快照；这些留给任务 16。
5. `artifacts` 只提供任务级摘要和少量最新高亮项，不承担 artifact 全量列表与审计时间线的重放职责。

## projection 结构

```ts
interface TaskDetailProjectionView {
  projection: "task_detail";
  generatedAt: string;
  runId: string;
  graphRevision: number;
  taskId: string;
  overview: TaskDetailOverviewView;
  upstream: TaskDetailDependencyItemView[];
  downstream: TaskDetailDependencyItemView[];
  sessions: TaskDetailSessionSummaryView[];
  latestApproval?: TaskDetailLatestApprovalView;
  validation: TaskDetailValidationSummaryView;
  artifacts: TaskDetailArtifactSummaryView;
}
```

### `overview`

```ts
interface TaskDetailOverviewView {
  taskId: string;
  title: string;
  kind: string;
  goal: string;
  status: WorkspaceLaneStatus;
  statusReason: string;
  ownerLabel: string;
  riskLevel: RiskLevel;
  inputs: string[];
  acceptanceCriteria: string[];
  expectedArtifacts: string[];
  latestActivityAt: string;
  latestActivitySummary: string;
  sessionCount: number;
  activeSessionCount: number;
  pendingApprovalCount: number;
  artifactCount: number;
}
```

约束：

- `overview` 只承载当前 task 的摘要，不拼接 sibling task、run 全局风险卡片或 session transcript。
- `sessionCount` / `activeSessionCount` 的准源长期应来自 `taskSession`；当前仓库允许由 `task_started` 事件窗口或 `task.status` 回填。
- `statusReason` 用于解释当前 task 状态，不替代审批历史或验证详情。

### `upstream` / `downstream`

```ts
interface TaskDetailDependencyItemView {
  taskId: string;
  title: string;
  kind: string;
  status: WorkspaceLaneStatus;
  statusReason: string;
  ownerLabel: string;
  latestActivityAt: string;
  latestActivitySummary: string;
}
```

约束：

- `upstream` 只展示直接依赖。
- `downstream` 只展示直接后继。
- 详情页允许看到相邻依赖任务的状态与最近活动，但不展开为完整 DAG；完整图布局仍属于任务板 projection。

### `sessions`

```ts
interface TaskDetailSessionSummaryView {
  sessionId?: string;
  label: string;
  status: WorkspaceLaneStatus;
  agentId: string;
  startedAt?: string;
  lastActivityAt: string;
  latestActivitySummary: string;
  pendingApprovalCount: number;
  sourceMode: "task_session" | "run_event_backfill" | "task_status_backfill";
}
```

约束：

- `sessions` 是进入任务级执行历史的入口摘要，不承载完整 transcript、工具调用、terminal preview 或 artifact 子视图。
- 当 `taskSession` 真源尚未落地时，允许按 `task_started` 事件分段回填出多个近似 session 摘要。
- 如果没有足够事件可以分段，允许退化为单条 `task_status_backfill` 摘要，但必须显式标注来源模式。

### `latestApproval`

```ts
interface TaskDetailLatestApprovalView {
  requestId: string;
  state: "pending" | "approved" | "rejected";
  summary: string;
  riskLevel: RiskLevel | "none";
  requestedAt?: string;
  decidedAt?: string;
  actor?: string;
  sourceMode: "approval_request" | "inspection_approval";
}
```

约束：

- 只保留最新一条与该 task 直接关联的审批事实。
- `state` 必须能区分待审批和已决审批，避免任务详情页只能看 pending。
- 不提前在任务 14 暴露 `actionPlans` 明细，这属于任务 16 的职责。

### `validation`

```ts
interface TaskDetailValidationSummaryView {
  state: "pass" | "warn" | "fail";
  summary: string;
  details: string[];
  updatedAt?: string;
  sourceMode: "validation_record" | "task_status_backfill";
}
```

约束：

- 任务详情页必须能直接看到当前 task 最近一次验证结论或缺失验证记录的状态说明。
- 没有正式验证记录时，允许按 task 状态回填，但必须标明 `task_status_backfill`。

### `artifacts`

```ts
interface TaskDetailArtifactSummaryView {
  totalCount: number;
  latestCreatedAt?: string;
  highlights: TaskDetailArtifactItemView[];
}

interface TaskDetailArtifactItemView {
  artifactId: string;
  kind: ArtifactKind;
  uri: string;
  summary: string;
  createdAt: string;
}
```

约束：

- `highlights` 只保留少量最近 artifact 摘要，默认不超过 5 条。
- 任务详情页不负责提供 artifact 分页浏览、全文检索或按时间线回放。

## 字段准源与归约规则

| 字段组 | 准源 | 归约规则 |
| --- | --- | --- |
| `overview` | `task_record` + `run_graph` + `task_session` + `approval_request` + `artifact_record` + `run_event` | 汇总当前 task 状态、最新活动、session 数、待审批数与 artifact 数 |
| `upstream` / `downstream` | `run_graph` + 相邻 task 的 `task_record` / `approval_request` / `validation_record` / `run_event` | 只展示一层相邻依赖任务摘要 |
| `sessions` | `task_session`；过渡期允许 `run_event` + `task.status` | 正式读取真实 session 集合；当前允许按 `task_started` 事件窗口回填 |
| `latestApproval` | `approval_request` + `approval_record`；过渡期允许 `inspection.approvals` + `approval_requested` 事件 | 只保留最近一条与该 task 直接相关的审批事实 |
| `validation` | `validation_record`；过渡期允许 `task.status` | 正式读取验证记录；无记录时按状态回填 |
| `artifacts` | `artifact_record` | 汇总任务级 artifact 总数和最近高亮项 |

## 任务详情页职责边界

任务详情页允许展示：

- 单个 task 的基本目标、状态与负责人摘要
- 直接上游与直接下游任务摘要
- 该 task 关联的 sessions 摘要集合
- 最新审批状态
- 最近验证结论
- artifact 摘要与少量最新高亮项

任务详情页禁止展示：

- run 级总控指标和 workspace 动作队列
- 完整 task DAG 布局
- session transcript、工具调用明细、terminal preview
- 审批 `actionPlans` 全量快照
- inspect 页的全量时间线与重规划记录

## 过渡期实现约束

1. 当前仓库必须新增 `build-task-detail-projection.ts`，作为任务详情 projection 的专用 builder 入口。
2. 过渡期 builder 可以从 `RunInspection` 读取数据，但输出字段只能落在本文件冻结的任务详情语义内，不能把 `RunInspection` 继续当作任务详情页长期契约。
3. 在任务 18 前，不要求现有 API 立即暴露任务详情显式端点；后续端点设计必须兼容本文件字段语义。
4. 在任务 15 前，不提前把 `sessions` 展开成会话详情子视图；任务 14 只提供 session 摘要列表。
5. 在任务 16 前，不提前在 `latestApproval` 中塞入 `actionPlans` 快照明细；任务 14 只提供审批摘要与状态。

## 与当前仓库的直接约束

1. [`src/ui-read-models/build-task-detail-projection.ts`](../src/ui-read-models/build-task-detail-projection.ts) 是任务详情 projection 的专用 builder 入口。
2. [`src/ui-read-models/projection-contracts.ts`](../src/ui-read-models/projection-contracts.ts) 中 `task_detail` 的 primary sources 必须覆盖 `approval_record` 与 `run_event`，否则无法稳定表达最新审批状态和 session 回填。
3. [`src/ui-read-models/build-views.ts`](../src/ui-read-models/build-views.ts) 中现有 lane 兼容视图仍是旧 UI 适配层，不得继续膨胀成任务详情页正式契约。
4. [`apps/console/src/pages/LaneConsolePage.vue`](../apps/console/src/pages/LaneConsolePage.vue) 的后续收敛不能直接代替任务详情页；任务详情必须以 `taskId` 为主入口，而不是沿用 lane 语义。

## 非目标

任务 14 不定义：

- 会话详情页的 transcript / tool call / terminal preview 子视图
- Approvals 页的审批历史与 `actionPlans` 明细结构
- Inspect 页的完整审计时间线
- 最终 REST 路径、分页与游标策略
- console 页面实际布局与兼容路由改造
