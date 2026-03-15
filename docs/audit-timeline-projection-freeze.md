# 审计时间线 projection 冻结

## 目标

冻结 `audit_timeline` 的字段边界、归约规则和 Inspect 页职责，使 InspectPage 后续围绕审计与复盘读取独立 projection，而不是继续直接消费 `RunInspection` 聚合对象。

本文只覆盖任务 17，不展开任务 18 的 REST 路径和分页，不提前执行任务 26 的 Inspect 页面重构，也不提前拆后端聚合器职责。

## 冻结结论

1. `auditTimelineProjection` 是 Inspect 页唯一主 projection，主实体是 `run` 上的审计时间线，而不是 workspace 焦点态。
2. projection 必须同时提供统一时间线 `entries`，以及按 Inspect 语义拆出的 `approvals`、`validations`、`artifacts`、`replans`、`sessionEvents` 五类审计切片。
3. 时间线条目长期以 `run_event` 为准源；审批历史优先复用 `approval_record` artifact 快照，验证记录优先读取 `validation_record` artifact / inspect validation 视图，artifact 摘要直接来自 `artifact_record`。
4. 在 `taskSession` 真源未落地前，Inspect projection 允许沿用任务 15 的兼容期 session backfill 规则，把关键执行事件、审批、验证和 artifact 绑定到兼容期 `sessionId`。
5. Inspect 页允许展示审批历史、验证记录、artifact 摘要、重规划记录和关键 session 事件，但不得重新承担 workspace 控制动作、任务板布局或 Approvals 页 actionPlans 明细职责。

## projection 结构

```ts
interface AuditTimelineProjectionView {
  projection: "audit_timeline";
  generatedAt: string;
  runId: string;
  graphRevision: number;
  summary: AuditTimelineSummaryView;
  entries: AuditTimelineEntryView[];
  approvals: AuditTimelineApprovalHistoryItemView[];
  validations: AuditTimelineValidationRecordView[];
  artifacts: AuditTimelineArtifactGroupView[];
  replans: AuditTimelineReplanRecordView[];
  sessionEvents: AuditTimelineSessionEventView[];
}
```

约束：

- `entries` 是 Inspect 页的统一审计主时间线，按最近事件优先排序。
- `approvals`、`validations`、`artifacts`、`replans`、`sessionEvents` 是面向 Inspect 复盘的高信号切片，不是其他页面的替代主 projection。

## `summary`

```ts
interface AuditTimelineSummaryView {
  runStatus: RunStatus;
  totalEventCount: number;
  approvalEventCount: number;
  validationEventCount: number;
  artifactEventCount: number;
  replanCount: number;
  sessionEventCount: number;
  latestEventAt?: string;
  latestFailure?: string;
  latestBlocker?: string;
  latestReplan?: string;
  latestValidation?: string;
}
```

约束：

- `summary` 只聚合审计视角指标，不承载 workspace 动作推荐或 task board 统计。
- `latestFailure`、`latestBlocker`、`latestReplan`、`latestValidation` 应直接复用 inspect summary 准源，避免 Inspect 页各自二次猜测。

## `entries`

```ts
interface AuditTimelineEntryView {
  eventId: string;
  timestamp: string;
  kind: "lifecycle" | "session" | "approval" | "validation" | "artifact" | "replan";
  type: RunEventType;
  title: string;
  details: string[];
  taskId?: string;
  taskTitle?: string;
  sessionId?: string;
  approvalRequestId?: string;
  artifactId?: string;
  sourceMode: "run_event";
}
```

约束：

- `entries` 以 `run_event` 为准源，不允许把 Inspect 页主时间线继续建立在 `RunInspection.timeline` 之上作为长期真源。
- `sessionId` 在过渡期允许回填兼容 id，但不得再使用 `laneId`。
- `kind` 只服务 Inspect 页分组与筛选，不得改变底层事件语义。

## `approvals`

```ts
interface AuditTimelineApprovalHistoryItemView {
  requestId: string;
  taskId?: string;
  taskTitle: string;
  summary: string;
  state: "pending" | "approved" | "rejected";
  riskLevel: RiskLevel | "none";
  requestedAt: string;
  decidedAt?: string;
  actor?: string;
  note?: string;
  sessionId?: string;
  sourceMode: "approval_artifact" | "inspection_approval";
}
```

约束：

- Inspect 页必须能回放已决和待决审批，不得只展示 pending。
- 审批历史只承载复盘必需字段，不重复承担 Approvals 页 `actionPlans` 完整快照职责。

## `validations`

```ts
interface AuditTimelineValidationRecordView {
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  outcome?: string;
  summary: string;
  details: string[];
  updatedAt?: string;
  sessionId?: string;
  sourceMode: "validation_record" | "task_status_backfill";
}
```

约束：

- `validations` 表达验证结论及其可追溯上下文，优先读验证记录，缺失时允许按 task 状态回填。
- Inspect 页不应再从 task detail 或 workspace projection 间接拼接验证信息。

## `artifacts`

```ts
interface AuditTimelineArtifactGroupView {
  taskId?: string;
  taskTitle: string;
  totalCount: number;
  latestCreatedAt?: string;
  artifactKinds: ArtifactKind[];
  highlights: AuditTimelineArtifactHighlightView[];
  sourceMode: "artifact_record";
}
```

约束：

- artifact 在 Inspect 页只提供审计摘要和代表性高亮信息，不承载 task detail 的完整 artifact 浏览职责。
- `highlights` 中若可稳定回填 session，则必须输出 `sessionId`，便于从审计回放定位到执行实例。

## `replans`

```ts
interface AuditTimelineReplanRecordView {
  eventId: string;
  type: "replan_requested" | "replan_applied";
  timestamp: string;
  title: string;
  details: string[];
  taskId?: string;
  taskTitle?: string;
  sourceMode: "run_event";
}
```

约束：

- Inspect 页必须能单独查看重规划记录，不再把 replan 仅作为 summary 文本。
- 重规划记录仍以事件为准，不额外引入新的 inspect 专属事件实体。

## `sessionEvents`

```ts
interface AuditTimelineSessionEventView {
  eventId: string;
  sessionId: string;
  taskId: string;
  taskTitle: string;
  timestamp: string;
  type: RunEventType;
  title: string;
  summary: string;
  sourceMode: "run_event_backfill" | "task_status_backfill";
}
```

约束：

- `sessionEvents` 只保留高信号执行事件，例如 `task_started`、`agent_selected`、`context_built`、`invocation_planned`、`task_completed`、`task_failed`、`task_blocked`。
- 普通 workspace 焦点态、terminal preview 或全量 transcript 不属于 Inspect projection。

## 字段准源与归约规则

| 字段组 | 准源 | 归约规则 |
| --- | --- | --- |
| `entries` | `run_event`；过渡期允许复用 `RunInspection.timeline` 的标题/详情文案 | 条目以事件为主键，按时间倒序输出 |
| `approvals` | `approval_record` artifact + `inspection.approvals` | 决策 artifact / 请求 artifact 优先，inspection 审批视图兜底 |
| `validations` | `validation_record` artifact + `inspection.validation` | 优先输出稳定验证结论，再按 task 状态回填缺失字段 |
| `artifacts` | `artifact_record` | 按 task 分组并保留代表性 highlights |
| `replans` | `replan_requested` / `replan_applied` 事件 | 独立列出重规划记录，便于复盘 |
| `sessionEvents` | 关键 task 级 `run_event` + 兼容期 session backfill | 使用任务 15 的兼容 `sessionId` 规则，不输出 lane 语义 |

## Inspect 页职责边界

Inspect 页允许展示：

- 统一审计时间线
- 审批历史与决策记录
- 验证记录与失败/阻塞回放
- artifact 摘要与代表性结果
- 重规划记录
- 关键 session 执行事件

Inspect 页禁止展示：

- workspace 控制动作与焦点 task 选择
- task board DAG 布局
- Approvals 页完整 `actionPlans` 快照详情
- session detail 的 transcript、terminal preview、工具调用全量视图

## 过渡期实现约束

1. 当前仓库必须新增 `build-audit-timeline-projection.ts`，作为 Inspect projection 的专用 builder。
2. 在 `taskSession` 真源落地前，builder 允许复用 `session-backfill.ts` 生成兼容期 `sessionId`。
3. 任务 17 只冻结并落地读模型与 builder，不要求 UI API 立即切换到新的 `audit_timeline` 返回形状。
4. 任务 26 前不提前重构 InspectPage 页面结构；当前页面仍可继续读取旧 inspect 兼容接口。

## 与当前仓库的直接约束

1. `src/ui-read-models/build-audit-timeline-projection.ts` 必须负责输出 Inspect 页所需的独立 projection。
2. `src/ui-read-models/projection-contracts.ts` 中 `audit_timeline` 的 primary sources 至少覆盖 `run_event`、`artifact_record`、`validation_record`、`approval_record`。
3. 审计 projection 必须与任务 15 的兼容期 `sessionId` 规则一致，不得重新发明新的 backfill id。

## 非目标

任务 17 不定义：

- 最终 REST 路径、分页或游标策略
- InspectPage 的最终交互和视觉结构
- 后端 inspect 聚合器拆分方案
- 真实 `taskSession` / `threadId` 持久化 schema
