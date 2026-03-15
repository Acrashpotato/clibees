# Projection 一致性规则冻结

## 目标

冻结同一 `task`、`taskSession`、`approvalRequest`、`artifact`、`validation`、`timeline`、`sessionMessage` 在多个 projection 与页面中的源事实一致、映射一致、准源优先级与可追溯规则，避免后续页面各自拼装出互相冲突的事实。

本文只覆盖任务 19，不提前执行任务 20 的后端聚合拆分，也不提前执行任务 21 到 26 的 console 页面重构。

## 定义

### 源事实一致

源事实一致指同一个实体在所有 projection 中都必须回指到同一组主标识和同一条领域事实链，不能出现：

- 同一 `taskId` 在不同页面被映射成不同状态
- 同一 `sessionId` 在一个页面属于 A task、在另一个页面属于 B task
- 同一 `requestId` 的审批结果、风险等级或 `actionPlans` 快照互相矛盾
- 同一 `artifactId`、`eventId`、`messageId` 在不同页面绑定到不同上游对象

### 映射一致

映射一致指允许不同页面对同一实体做不同粒度的展示，但字段含义和映射方向必须固定。例如：

- Workspace 只展示 task 风险摘要，Task Detail 展示 task 全量摘要，但二者都必须映射回同一个 `taskId`
- Session Detail 展示审批明细，Approvals 展示审批队列，但同一 `requestId` 的状态与 session 归属必须一致
- Inspect 展示完整时间线，其他页面只展示片段，但片段必须引用同一 `eventId`

### 准源

准源是 projection 做归约时允许依赖的结构化事实来源。准源有优先级：

1. 专属实体记录
2. 与该实体直接关联的审计记录
3. `run_event`
4. 过渡期兼容回填

`RunInspection` 只能继续作为过渡期输入，不得作为任务 19 之后任何一致性规则的长期准源。

## 冻结结论

1. 一致性检查的主对象固定为 `task`、`taskSession`、`approvalRequest`、`artifactRecord`、`validationRecord`、`timelineEntry`、`sessionMessage` 七类。
2. 每类对象必须先冻结“身份键”和“准源优先级”，页面字段才能在其上做摘要映射。
3. 页面允许缺字段，不允许改字段语义；允许摘要化，不允许改实体归属。
4. 所有跨页面可点击实体都必须可追溯到同一主键组合和同一事件链，不允许继续依赖 `laneId`、数组下标或文案匹配。
5. 过渡期回填必须显式暴露 `sourceMode`，禁止把兼容推断值伪装成真实实体记录。

## 实体一致性矩阵

| 实体 | 身份键 | 准源优先级 | 最低追溯键 | 必须保持一致的核心字段 |
| --- | --- | --- | --- | --- |
| `task` | `runId + taskId` | `task_record` -> `run_graph` -> `run_event` | `taskId`、`runId`、`graphRevision`、`eventId` | `status`、`statusReason`、依赖关系、最近活动 |
| `taskSession` | `runId + sessionId` | `task_session` -> `run_event` -> `session_message`/`artifact_record` | `sessionId`、`taskId`、`threadId`、`eventId` | `status`、所属 task、最近活动、关联审批/验证/artifact |
| `approvalRequest` | `runId + requestId` | `approval_request` -> `approval_record` -> `artifact_record` -> `run_event` | `requestId`、`sessionId`、`taskId`、`actionPlanId` | `state`、`riskLevel`、`actor`、`note`、`actionPlans` |
| `artifactRecord` | `runId + artifactId` | `artifact_record` -> `run_event` | `artifactId`、`taskId`、`sessionId`、`eventId` | `kind`、`uri`、`createdAt`、归属 task/session |
| `validationRecord` | `runId + taskId + validationKey` | `validation_record` -> `run_event` -> `task_record` | `taskId`、`sessionId`、`eventId`、`validationKey` | `state`、`summary`、`updatedAt` |
| `timelineEntry` | `runId + eventId` | `run_event` -> `approval_record`/`validation_record`/`artifact_record` | `eventId`、`taskId`、`sessionId`、`threadId` | 时间顺序、事件类型、关联对象 |
| `sessionMessage` | `runId + threadId + messageId` | `session_message` -> `message_thread` -> `run_event` | `messageId`、`threadId`、`sessionId`、`replyToMessageId` | 发送方、接收范围、正文、回复链 |

## 跨页面固定映射规则

### `task`

- Workspace、Task Board、Task Detail、Inspect 中出现的同一 `taskId`，必须共享同一 `status` 和依赖拓扑。
- Workspace 的 `focusTask`、Task Board 的节点、Task Detail 的 `overview` 允许文案不同，但必须引用同一 `taskId` 与同一最新活动时间线。
- 任一页面若展示 `activeSessionCount`、`sessionCount`，长期准源都必须回到 `taskSession` 集合；过渡期回填必须标记来源模式。

### `taskSession`

- Task Board 的活动 session 摘要、Task Detail 的 session 列表、Session Detail 的会话主体、Inspect 的关键会话事件必须使用同一 `sessionId`。
- 恢复原会话只允许延续同一 `sessionId`；`requeue` 创建的新执行实例必须展示为新 `sessionId`，旧会话仍保留在历史页中。
- Session Detail 可以比其他页面展示更多细节，但不能单独改写 session 的归属 task、状态或最近活动时间。

### `approvalRequest`

- Approvals、Session Detail、Task Detail、Workspace、Inspect 中出现的同一 `requestId`，其 `state`、`riskLevel`、`actor`、`note`、`actionPlans` 快照必须完全一致。
- 页面可以各自裁剪 `actionPlans` 的呈现样式，但不得重新生成、合并或丢失既有 `actionPlanId`。
- 一个审批若绑定 `sessionId`，所有页面都必须绑定到同一 `sessionId`；若处于过渡期回填，也必须使用同一回填 session 标识。

### `artifactRecord`

- Task Detail、Session Detail、Approvals、Inspect 对同一 `artifactId` 的展示必须共用同一 `kind`、`uri`、`createdAt` 与归属 task/session。
- Approvals 如果引用审批快照 artifact，只能把它作为审批事实的补充来源，不能反向改写审批主状态。

### `validationRecord`

- Workspace 风险摘要、Task Board 等待原因、Task Detail 验证区块、Session Detail 验证摘要、Inspect 验证历史对同一验证结果必须给出相同结论。
- 在正式 `validation_record` 缺失时，允许从任务状态回填失败/警告摘要，但必须通过 `sourceMode` 明示其为兼容值。

### `timelineEntry`

- Inspect 是完整时间线唯一主 projection，其他页面只能引用其子集或摘要。
- 同一 `eventId` 在所有页面中必须指向同一 `taskId`、`sessionId`、`threadId`、`approvalRequestId`、`artifactId` 组合。
- 页面可自定义标题文案，但不得改变事件顺序或关联对象。

### `sessionMessage`

- Workspace 的待处理消息摘要、Session Detail 的消息流、Inspect 的消息事件若指向同一 `messageId`，必须共享同一 `threadId`、发送方、目标范围与回复链。
- 消息寻址必须来自 `threadId`、参与者和目标范围字段，不得再回退为 `laneId` 或字符串模糊匹配。

## 页面职责与一致性边界

| 页面 | 唯一主 projection | 可以做的映射 | 不允许做的事情 |
| --- | --- | --- | --- |
| Runs | `run_list` | run 级计数摘要 | 推断 task/session 明细真相 |
| Workspace | `workspace` | 焦点 task、活动 session、高优先级消息和动作摘要 | 生成 task/session 的新身份或改写审批事实 |
| 任务板 | `task_board` | task DAG、等待原因、活动 session 摘要 | 改写 task 依赖和 session 主归属 |
| 任务详情 | `task_detail` | task 单体聚合、关联 sessions、最新审批、验证、artifact 摘要 | 充当全局审批队列或完整 timeline |
| 会话详情 | `session_detail` | session 主视图、消息流、工具、审批、验证、artifact | 改写审批或 artifact 的主记录 |
| Approvals | `approval_queue` | 跨 run 或单 run 审批聚合、`actionPlans` 快照 | 回填出新的审批对象或 session 归属 |
| Inspect | `audit_timeline` | 审计全量时间线与复盘切片 | 充当 workspace 控制视图 |

## 过渡期兼容规则

1. `RunInspection` 只允许作为 projection builder 的输入适配层，不允许作为一致性检查的最终结果。
2. 兼容期 `sessionId` 必须沿用任务 15 冻结的 backfill 规则，不得每个页面各自生成不同 id。
3. 当前 console 仍存在 `laneId`、`LaneView`、`WorkspaceLaneStatus` 命名；这些只能视为兼容 UI 壳层，不得再充当真源身份键。
4. 任何回填字段一旦进入 projection，都必须通过 `sourceMode` 或等价字段公开其来源。

## 与当前仓库的直接约束

1. [`src/ui-read-models/projection-contracts.ts`](../src/ui-read-models/projection-contracts.ts) 必须新增代码化的一致性契约，至少覆盖七类共享实体的身份键、准源和追溯键。
2. [`src/ui-read-models/build-workspace-projection.ts`](../src/ui-read-models/build-workspace-projection.ts)、[`src/ui-read-models/build-task-board-projection.ts`](../src/ui-read-models/build-task-board-projection.ts)、[`src/ui-read-models/build-task-detail-projection.ts`](../src/ui-read-models/build-task-detail-projection.ts)、[`src/ui-read-models/build-session-detail-projection.ts`](../src/ui-read-models/build-session-detail-projection.ts)、[`src/ui-read-models/build-approval-queue-projection.ts`](../src/ui-read-models/build-approval-queue-projection.ts)、[`src/ui-read-models/build-audit-timeline-projection.ts`](../src/ui-read-models/build-audit-timeline-projection.ts) 后续在任务 20 到 27 中都必须遵守这里冻结的身份键和准源优先级。
3. [`src/ui-api/contracts.ts`](../src/ui-api/contracts.ts) 在后续扩展字段时，不得破坏这里冻结的对象粒度与追溯键。
4. 任务 27 的一致性测试必须围绕本文件的七类实体，验证跨 projection 的源事实一致和映射一致。

## 非目标

任务 19 不定义：

- 任务 20 的具体后端聚合拆分实现
- 任务 21 到 26 的 console 页面结构调整
- 任务 27 的最终测试夹具与断言代码
- 新实体的最终存储 schema 迁移脚本
