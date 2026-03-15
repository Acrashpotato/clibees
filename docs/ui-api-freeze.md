# UI API 冻结

## 范围

本文冻结任务 18：为七类页面 projection 补齐显式 UI API 路由，明确查询参数、响应包裹、分页策略，以及控制动作 POST 端点。本文不实现 `taskSession`、`messageThread`、`sessionMessage` 的真实持久化，也不替代后续任务 20 到 28 对后端聚合、前端类型和测试矩阵的重构。

## 冻结结论

1. UI API 分为两类资源：只读 projection 资源和显式动作资源；不引入统一 `/commands` 或 `/dispatch`。
2. 新的 projection 端点全部进入显式命名空间，避免继续让页面依赖旧 `/inspect` 聚合返回。
3. 兼容期内保留旧端点：`/api/runs`、`/api/runs/:runId/workspace`、`/api/runs/:runId/inspect`、`/api/approvals`、`/api/runs/:runId/approvals`，但它们只作为旧 console 的兼容读接口，不再视为冻结后的目标契约。
4. 新 projection 端点统一返回 `{ data: <projection> }`；集合型 projection 额外返回 `page`，用于表达游标分页结果。
5. 当前仓库已具备实现能力的动作只有 `create_run`、`resume_run`、`approve_request`、`reject_request`；`interact`、`requeue`、`cancel`、`interrupt` 先提供显式资源端点，并以 `501 not_supported` 占位，直到 `taskSession/thread/message` 真源落地。

## 读接口冻结

| projection | 方法 | 路径 | 查询参数 | 响应 |
| --- | --- | --- | --- | --- |
| `run_list` | `GET` | `/api/projections/run-list` | `status?`、`limit?`、`cursor?` | `{ data: RunListProjection, page }` |
| `workspace` | `GET` | `/api/runs/:runId/projections/workspace` | 无 | `{ data: WorkspaceProjectionView }` |
| `task_board` | `GET` | `/api/runs/:runId/projections/task-board` | 无 | `{ data: TaskBoardProjectionView }` |
| `task_detail` | `GET` | `/api/runs/:runId/tasks/:taskId/projection` | 无 | `{ data: TaskDetailProjectionView }` |
| `session_detail` | `GET` | `/api/runs/:runId/sessions/:sessionId/projection` | 无 | `{ data: SessionDetailProjectionView }` |
| `approval_queue` 全局 | `GET` | `/api/projections/approval-queue` | `state?`、`riskLevel?`、`limit?`、`cursor?` | `{ data: ApprovalQueueProjectionView, page }` |
| `approval_queue` run 级 | `GET` | `/api/runs/:runId/projections/approval-queue` | `state?`、`riskLevel?`、`limit?`、`cursor?` | `{ data: ApprovalQueueProjectionView, page }` |
| `audit_timeline` | `GET` | `/api/runs/:runId/projections/audit-timeline` | 无 | `{ data: AuditTimelineProjectionView }` |

冻结规则：
1. projection 路径体现页面主 projection，而不是底层存储表名。
2. `task_detail` 和 `session_detail` 使用资源路径，不通过 query string 传 `taskId` 或 `sessionId`。
3. `audit_timeline` 替代未来页面对 `/inspect` 的依赖；`/inspect` 仅保留为 `RunInspection` 兼容入口。
4. 集合型 projection 的 `data.summary` 基于过滤后的全集计算，而不是仅当前页。

## 动作接口冻结

| action | 方法 | 路径 | 最小请求体 | 当前状态 |
| --- | --- | --- | --- | --- |
| `create_run` | `POST` | `/api/runs` | `{ goal, configPath?, autoResume? }` | 已实现 |
| `resume_run` | `POST` | `/api/runs/:runId/resume` | `{ configPath?, actorId?, clientRequestId?, note?, reasonCode? }` | 已实现，兼容旧返回 |
| `approve_request` | `POST` | `/api/runs/:runId/approvals/:requestId/approve` | `{ actorId, note?, clientRequestId? }` | 已实现，兼容旧返回 |
| `reject_request` | `POST` | `/api/runs/:runId/approvals/:requestId/reject` | `{ actorId, note?, clientRequestId? }` | 已实现，兼容旧返回 |
| `post_thread_message` | `POST` | `/api/runs/:runId/threads/:threadId/messages` | `{ actorId, body, clientRequestId, note?, replyToMessageId? }` | 显式占位，返回 `501` |
| `interact_session` | `POST` | `/api/runs/:runId/sessions/:sessionId/interact` | `{ actorId, body, clientRequestId, note?, reasonCode? }` | 显式占位，返回 `501` |
| `requeue_task` | `POST` | `/api/runs/:runId/tasks/:taskId/requeue` | `{ actorId, clientRequestId?, note?, reasonCode? }` | 显式占位，返回 `501` |
| `cancel_task` | `POST` | `/api/runs/:runId/tasks/:taskId/cancel` | `{ actorId, clientRequestId?, note?, reasonCode? }` | 显式占位，返回 `501` |
| `interrupt_session` | `POST` | `/api/runs/:runId/sessions/:sessionId/interrupt` | `{ actorId, clientRequestId?, note?, reasonCode? }` | 显式占位，返回 `501` |

冻结规则：
1. 所有动作继续绑定到已冻结的目标对象粒度：`run`、`approvalRequest`、`thread`、`task`、`taskSession`。
2. 即使后端能力暂未落地，也必须先暴露显式路径，避免前端重新走回模糊 command 分发。
3. `approve`、`reject` 兼容旧字段 `actor`，但冻结后的对外字段名统一为 `actorId`。

## 响应与错误冻结

### 成功响应

- 单文档 projection：`{ data: <projection> }`
- 集合 projection：`{ data: <projection with paged items>, page }`
- 兼容期动作：当前仍返回既有 `RunRecord`，后续在不破坏旧消费者后再统一收敛到动作 envelope

### 错误响应

统一错误形状：

```json
{
  "error": {
    "code": "not_supported",
    "message": "...",
    "details": {}
  }
}
```

冻结错误码：`bad_request`、`not_found`、`state_conflict`、`not_supported`、`internal_error`。

## 游标分页冻结

1. 当前仓库使用文件存储和内存聚合，集合接口统一采用 `opaque_offset` 游标。
2. `cursor` 为 base64url 编码的 JSON：`{"offset": <number>}`。
3. `limit` 默认 `20`，最大 `100`。
4. `page` 返回 `limit`、`returnedCount`、`totalCount`、`cursorMode` 和可选 `nextCursor`。
5. 仅 `run_list` 与 `approval_queue` 在任务 18 落地分页；其余 run 级单文档 projection 暂不分页。

## 仓库约束

1. [`src/ui-api/contracts.ts`](../src/ui-api/contracts.ts) 成为 UI API 路径、请求体和分页策略的代码化冻结点。
2. [`src/ui-api/server.ts`](../src/ui-api/server.ts) 必须同时维护旧兼容入口和新 projection 入口，直到 console 在任务 21 到 26 完成迁移。
3. [`src/control/inspection-aggregator.ts`](../src/control/inspection-aggregator.ts) 仍可作为过渡期数据源，但新页面不得再以其原始返回作为最终契约。
4. 后续任务 19 到 28 不得更改本文冻结的动作目标粒度；如需新增字段，只能扩展请求或响应内容，不能把 `thread/session/task` 再折叠回 `lane`。
