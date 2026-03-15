# 运行列表 projection 冻结

## 目标

冻结 `runListProjection` 的字段边界、准源、归约规则和过渡适配方式，使 Runs 页面能稳定展示 `run` 状态、活跃 task 数、活跃 session 数、阻塞 task 数、待审批数和最近更新时间。

本文只覆盖任务 11，不展开任务 12 的 Workspace projection、任务 13 的任务板 projection，或任务 18 的最终 REST 资源命名。

## 冻结结论

1. `runListProjection` 是 Runs 页唯一主 projection，主实体是 `run`，主状态来源是 `run.status`。
2. 运行列表只承载列表级摘要，不承载 task/session 详情、消息流、审批快照正文或审计时间线明细。
3. Runs 页每一行都必须可追溯到同一组稳定字段：`runId`、`goal`、`status`、`stage`、`startedAt`、`updatedAt`、四类聚合计数和一条列表摘要 `summary`。
4. `activeTaskCount` 与 `activeSessionCount` 必须明确区分，禁止继续用单一 `activeLanes` 近似替代。
5. 在正式 `taskSession` 真源落地前，`activeSessionCount` 允许使用任务状态回填，但必须显式标记为过渡模式，不能伪装成精确 session 计数。

## projection 结构

```ts
interface RunListProjection {
  projection: "run_list";
  generatedAt: string;
  runs: RunListItemView[];
}

interface RunListItemView {
  runId: string;
  goal: string;
  status: WorkspaceLaneStatus;
  stage: string;
  startedAt: string;
  updatedAt: string;
  activeTaskCount: number;
  activeSessionCount: number;
  blockedTaskCount: number;
  pendingApprovalCount: number;
  sessionCountMode: "task_sessions" | "task_status_backfill";
  summary: string;
}
```

说明：

- `status` 是 Runs 页的主状态字段，固定映射自 `run.status`。
- `stage` 是列表级显示辅助字段，不是新的状态真源。
- `summary` 只允许承载最近失败、阻塞、验证或最近时间线标题的摘要文本，不得嵌入 task/session drilldown 结构。
- `sessionCountMode` 是过渡期数据可信度标记，用来显式区分“真实 session 计数”和“按 task 状态回填的近似值”。

## 字段准源与归约规则

| 字段 | 准源 | 归约规则 |
| --- | --- | --- |
| `runId` / `goal` / `startedAt` / `updatedAt` | `run_record` | 直接取 `RunRecord` |
| `status` | `run_record.status` | 固定映射到 Runs 页展示状态 |
| `stage` | `run_record` + `run_graph` + `inspection summary` | 由 `run.status`、完成 task 数、当前 task 标题拼出单行标签 |
| `activeTaskCount` | `task_record` / `run_graph.tasks` | 统计状态属于 `routing`、`context_building`、`queued`、`running`、`awaiting_approval`、`validating` 的 task |
| `activeSessionCount` | `taskSession` 真源；过渡期允许 `task_record` 回填 | 正式规则统计状态属于 `launching`、`attached`、`waiting_approval`、`waiting_message` 的 session；当前仓库未落地 `taskSession` 时，临时按 `task.status in { running, awaiting_approval }` 回填 |
| `blockedTaskCount` | `task_record` / `run_graph.tasks` | 仅统计 `task.status = blocked`，不把失败混入阻塞数 |
| `pendingApprovalCount` | `approvalRequest` | 统计 state 为 `pending` 的审批请求 |
| `summary` | `inspection summary` + 最新时间线条目 | 优先级：`latestFailure` > `latestBlocker` > `latestValidation` > 最新时间线标题 > 默认文案 |

## Runs 页职责边界

Runs 页允许展示：

- 运行目标与主状态
- 启动时间、最近更新时间
- 活跃 task 数、活跃 session 数、阻塞 task 数、待审批数
- 一条列表级摘要
- 跳转到 Workspace 或 Inspect 的入口

Runs 页禁止展示：

- 单个 task 的依赖图、重试细节、artifact 列表
- 单个 session 的终端输出、消息流、工具调用
- 审批 `actionPlans` 快照明细
- 审计时间线全文回放

## 排序与展示规则

1. 默认按 `updatedAt` 倒序排列，最近更新的 run 置顶。
2. Runs 页的“阻塞数”只显示 `blockedTaskCount`，不把 `failed_terminal`、`cancelled` 或待审批混算进去。
3. Runs 页的“活跃 session 数”优先反映真实会话绑定状态，而不是 task 调度态。
4. 当 `sessionCountMode = "task_status_backfill"` 时，前端可以展示数值，但不得把该值解释为“真实并发 CLI 窗口总数”。

## 过渡期实现约束

1. 当前仓库的 `/api/runs` 仍可继续返回 Runs 页所需的列表项数组，但生成逻辑必须统一收敛到 `runListProjection` builder，而不是散落在通用 inspection 拼装逻辑中。
2. 过渡期 builder 可以从 `RunInspection` 读取数据，但只允许输出运行列表字段，不能继续把 `RunInspection` 当作 Runs 页正式契约。
3. 一旦 `taskSession` 真源落地，`activeSessionCount` 的计算必须切换到 session 集合，并把 `sessionCountMode` 从 `task_status_backfill` 升级为 `task_sessions`。
4. 后续任务 18 若为 Runs 页补显式 REST 资源，资源返回体必须兼容本文件冻结的字段语义。

## 与当前仓库的直接约束

1. [`src/ui-read-models/build-run-list-projection.ts`](../src/ui-read-models/build-run-list-projection.ts) 是运行列表 projection 的专用 builder 入口。
2. [`src/ui-read-models/build-views.ts`](../src/ui-read-models/build-views.ts) 中的 `buildRunListItemView` 仅作为过渡适配器存在，字段语义必须与本文件一致。
3. [`src/ui-api/server.ts`](../src/ui-api/server.ts) 的 `/api/runs` 路径后续即使改造为显式 projection 端点，也必须保持 Runs 页主 projection 只有 `runListProjection` 一个。
4. [`apps/console/src/pages/RunsPage.vue`](../apps/console/src/pages/RunsPage.vue) 只能消费列表级计数和摘要，不得提前拼入任务板或会话详情字段。

## 非目标

任务 11 不定义：

- Workspace 聚焦逻辑
- task board 依赖边结构
- task 详情或 session 详情字段
- 审批明细快照字段
- 最终分页、游标或筛选 REST 规则
