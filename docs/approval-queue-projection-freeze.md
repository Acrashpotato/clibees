# 审批队列 projection 冻结

## 目标

冻结 `approvalQueueProjection` 的字段边界、归约规则和过渡期 `sessionId` 归属映射，使 Approvals 页后续能够围绕真实 `approvalRequest` 语义展示审批对象、所属 task/session、`actionPlans` 快照、风险等级和决策结果，而不是继续停留在只有 summary 的待办列表。

本文只覆盖任务 16，不展开任务 17 的审计时间线、任务 18 的 REST 路径设计，也不提前执行任务 25 的前端页面重构。

## 冻结结论

1. `approvalQueueProjection` 是 Approvals 页唯一主 projection，主实体是 `approvalRequest`，但页面允许按 `runId` 聚合多个审批请求。
2. 审批 projection 必须展示 `requestId`、`runId`、`taskId`、兼容期 `sessionId`、`actionPlans` 快照、风险等级、请求时间、决策结果、审批人和备注；不能再只返回 summary。
3. 在正式 `taskSession` 真源未落地前，`session` 归属允许按 `task_started` 事件窗口回填，并复用任务 15 冻结的兼容期 `sessionId` 规则。
4. `actionPlans` 必须以审批创建时快照为准；过渡期直接读取 `approval_record` artifact 中持久化的 `actionPlans`，不得引用后续可变 invocation。
5. Approvals 页允许同时展示 pending 和已决审批，但禁止承担 workspace 焦点态、terminal transcript 或 inspect 全量审计回放职责。

## projection 结构

```ts
interface ApprovalQueueProjectionView {
  projection: "approval_queue";
  generatedAt: string;
  summary: ApprovalQueueSummaryView;
  items: ApprovalQueueItemDetailView[];
}
```

### `summary`

```ts
interface ApprovalQueueSummaryView {
  totalCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
}
```

约束：

- `summary` 只承载审批页聚合统计，不承载 run 总览、task board 指标或全局风险解释文案。
- 统计口径必须直接以 `items` 中的审批事实为准，避免页面再各自重复归约。

### `items`

```ts
interface ApprovalQueueItemDetailView {
  requestId: string;
  runId: string;
  taskId?: string;
  taskTitle: string;
  summary: string;
  state: "pending" | "approved" | "rejected";
  riskLevel: RiskLevel | "none";
  requestedAt: string;
  decidedAt?: string;
  actor?: string;
  note?: string;
  session?: ApprovalQueueSessionBindingView;
  actionPlanCount: number;
  actionPlans: ApprovalQueueActionPlanSnapshotView[];
  sourceMode: "approval_artifact" | "inspection_approval";
}
```

约束：

- `summary` 表达审批原因或审批对象摘要，不代替 `actionPlans` 明细。
- `state` 必须能区分待审批、已批准、已拒绝；Approvals 页不能只展示 pending。
- `riskLevel` 必须优先由 `actionPlans` 快照归约，缺失时才退化到 inspection 聚合结果。
- `actor`、`note`、`decidedAt` 是审批决策事实，不得伪造默认值。

### `session`

```ts
interface ApprovalQueueSessionBindingView {
  sessionId: string;
  label: string;
  sourceMode: "run_event_backfill" | "task_status_backfill";
}
```

约束：

- `session` 只表达审批请求归属于哪个执行会话，不承担会话详情的 transcript、工具调用或 terminal preview。
- 若当前 task 无法稳定回填 session，则允许缺省 `session`，但不得继续输出模糊 `laneId` 代替。

### `actionPlans`

```ts
interface ApprovalQueueActionPlanSnapshotView {
  actionPlanId: string;
  kind: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  reason: string;
  command?: string;
  args: string[];
  cwd?: string;
  targets: string[];
}
```

约束：

- `actionPlans` 是审批创建时快照，后续 invocation、重试或重队列不得回写污染历史快照。
- Approvals 页必须能直接看到每个 action 的 `kind`、`riskLevel`、`reason` 和命令上下文。

## 字段准源与归约规则

| 字段组 | 准源 | 归约规则 |
| --- | --- | --- |
| `items.state` / `actor` / `note` / `decidedAt` | `approval_record` artifact + `approval_decided` 事件；过渡期补充 `inspection.approvals` | 决策 artifact 优先，inspection 聚合仅作缺失兜底 |
| `items.summary` / `requestedAt` | `approval_requested` 事件 + 请求侧 `approval_record` artifact | 优先读请求事件时间，其次退化为请求 artifact 创建时间 |
| `items.actionPlans` | 请求侧 `approval_record` artifact 的 `actionPlans` 快照 | 只读快照，不引用运行时可变 invocation |
| `items.session` | `task_session`；过渡期允许 `task_started` 事件窗口回填 | 正式切到真实 session 后移除 backfill 依赖 |
| `items.taskTitle` | `run_graph` / `task_record` | 解析审批所挂载 task 的稳定标题 |
| `summary` | `items` | 由 projection 内部统一归约 |

## 审批页职责边界

审批页允许展示：

- 审批请求列表及其待决/已决状态
- 所属 run、task、session
- `actionPlans` 快照明细
- 风险等级、审批人、备注、决策时间和决策结果

审批页禁止展示：

- workspace 焦点 task / action queue
- task board DAG 布局
- session transcript、terminal preview、工具调用全量时间线
- inspect 页的全量审计回放与重规划记录

## 过渡期实现约束

1. 当前仓库必须新增 `build-approval-queue-projection.ts`，作为审批 projection 的专用 builder 入口。
2. 过渡期 builder 可以从 `RunInspection` 和 `approval_record` artifact 组装数据，但输出字段只能落在本文件冻结的审批语义内。
3. 在任务 18 前，不要求 UI API 立即切到新的审批 projection 返回形状；任务 16 只冻结并落地读模型与 builder。
4. 在任务 25 前，不提前重构 ApprovalsPage 的页面结构；现有页面兼容逻辑可继续存在，但不得成为审批 projection 的长期契约。

## 与当前仓库的直接约束

1. [`src/ui-read-models/models.ts`](../src/ui-read-models/models.ts) 必须新增 `approval_queue` projection 类型。
2. [`src/ui-read-models/build-approval-queue-projection.ts`](../src/ui-read-models/build-approval-queue-projection.ts) 必须负责补齐 `actionPlans` 快照和兼容期 `sessionId` 绑定。
3. [`src/ui-read-models/projection-contracts.ts`](../src/ui-read-models/projection-contracts.ts) 中 `approval_queue` 的 primary sources 必须覆盖 `artifact_record` 与 `run_event`，否则无法稳定表达审批快照和 session 归属。
4. [`src/ui-read-models/build-views.ts`](../src/ui-read-models/build-views.ts) 中的 `buildApprovalQueue` 仍是旧 UI 适配层，不得继续膨胀成 Approvals 页正式契约。

## 非目标

任务 16 不定义：

- 审计时间线的审批历史回放布局
- 最终 REST 路径、分页与游标策略
- ApprovalsPage 的最终交互和路由
- `taskSession` 真源落地后的持久化 schema
