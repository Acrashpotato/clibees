# 控制动作契约冻结

## 目标

冻结 `resume`、`approve`、`reject`、`interact`、`requeue`、`cancel`、`interrupt` 七类控制动作的契约，明确作用对象、前置状态、幂等性、冲突语义、失败语义、事件落点和页面落点，并固定采用显式动作端点。

本文只覆盖任务 9 范围，不展开任务 10 之后的 projection 拆分，不展开任务 18 的完整 REST 字段定义与分页策略。

## 冻结结论

1. 控制动作的作用对象粒度冻结为：`resume -> run`、`approve/reject -> approvalRequest`、`interact -> thread 或指定 taskSession`、`requeue/cancel -> task`、`interrupt -> taskSession`。
2. 所有控制动作都必须走显式资源动作端点，不允许再引入统一 `/commands`、`/actions/dispatch` 或模糊 `lane` 目标。
3. 任何控制动作都必须先校验目标对象是否仍可操作，再写入真源记录与审计事件；不得以“静默 no-op”掩盖非法状态。
4. 幂等语义冻结为“资源 + 动作 + `clientRequestId`”三级键；其中 `requeue`、`interact` 在没有 `clientRequestId` 时一律视为非幂等。
5. 冲突语义必须显式返回“对象已变化、已有并发动作、或前置条件不满足”的结果，而不是笼统复用内部异常。
6. 审计落点冻结为“先写领域真源，再追加 run 级事件”；消息写 `sessionMessage`，审批写 `approvalRecord`，重派/取消/中断写对应控制事实，再由 projection 消费。
7. 本文新增的 `run_resumed`、`task_requeued`、`task_cancelled`、`session_interrupted` 属于对任务 7 事件体系的补充扩展，用于承接任务 9 的控制事实。

## 显式端点冻结

| 动作 | 目标对象 | 显式端点 |
| --- | --- | --- |
| `resume` | `run` | `POST /api/runs/:runId/resume` |
| `approve` | `approvalRequest` | `POST /api/runs/:runId/approvals/:approvalRequestId/approve` |
| `reject` | `approvalRequest` | `POST /api/runs/:runId/approvals/:approvalRequestId/reject` |
| `interact`（线程入口） | `messageThread` | `POST /api/runs/:runId/threads/:threadId/messages` |
| `interact`（会话入口） | `taskSession` | `POST /api/runs/:runId/sessions/:sessionId/interact` |
| `requeue` | `task` | `POST /api/runs/:runId/tasks/:taskId/requeue` |
| `cancel` | `task` | `POST /api/runs/:runId/tasks/:taskId/cancel` |
| `interrupt` | `taskSession` | `POST /api/runs/:runId/sessions/:sessionId/interrupt` |

冻结规则：

1. 线程入口和会话入口都属于 `interact`，但它们的目标对象不同：前者直接作用于 `threadId`，后者作用于 `sessionId` 并解析到默认 `session_primary` 线程。
2. `approve`、`reject` 必须继续挂在 `approvalRequest` 资源上，不能退回 `task` 或 `run` 级模糊动作。
3. `interrupt` 必须改为 `sessionId` 入口；现有 `runId + taskId` 的底层能力只可作为兼容实现细节，不再是对外契约。

## 通用动作字段冻结

任务 9 只冻结动作语义所需的最小公共字段，完整 JSON 形状留给任务 18：

| 字段 | 适用动作 | 说明 |
| --- | --- | --- |
| `actorId` | 全部 | 发起动作的稳定操作者标识 |
| `clientRequestId` | 全部 | 用于重试去重的客户端请求标识；`requeue`、`interact` 强烈建议必填 |
| `note` | `approve`、`reject`、`cancel`、`interrupt`、`requeue` | 人类备注 |
| `reasonCode` | `resume`、`interact`、`requeue`、`cancel`、`interrupt` | 结构化原因码，例如 `operator.retry`、`blocked.dependency` |

冻结规则：

1. `actorId` 是审计字段，不得只保存在 UI 本地。
2. 同一资源上的同一动作若收到相同 `clientRequestId`，服务端必须返回首次成功或失败的稳定结果。
3. 若动作天生会创建新事实，例如新消息或新 `taskSession`，没有 `clientRequestId` 时不得承诺天然幂等。

## 动作契约

### `resume`

| 项 | 冻结规则 |
| --- | --- |
| 作用对象 | `run` |
| 适用状态 | `ready`、`paused`，以及“无待审批请求但记录仍停留在 `waiting_approval`”的 run |
| 成功结果 | 返回更新后的 `RunRecord`；run 可进一步进入 `running`、`waiting_approval`、`paused`、`completed`、`failed` |
| 幂等语义 | 相同 `clientRequestId` 的重复提交返回同一次恢复尝试结果；无 `clientRequestId` 的重复点击若 run 已进入 `running`，必须视为冲突而不是再次启动 |
| 冲突语义 | run 处于 `planning`、`running`、`replanning`、终态，或仍有 pending approval / 未解决漂移时，返回“不可恢复”冲突 |
| 失败语义 | `run` 不存在、graph 缺失、配置加载失败、工作区漂移阻塞、待审批请求未解决、恢复过程异常 |
| 事件落点 | 成功受理时追加 `run_resumed`；后续继续落 `task_queued`、`session_started`、`approval_requested`、`run_finished` 等执行事实 |
| 页面落点 | Runs、Workspace 为主；Inspect 展示审计结果 |

补充约束：

1. `resume` 不得隐式创建新的 `taskSession` 去替代本应恢复的原会话；是否新建执行实例应交给 `requeue`。
2. `resume` 的首要职责是恢复 run 的继续执行资格，不是绕过审批或忽略漂移检查。

### `approve`

| 项 | 冻结规则 |
| --- | --- |
| 作用对象 | `approvalRequest` |
| 适用状态 | `approvalRequest.state = pending`，且其关联 `task` / `taskSession` 仍处于可继续审批的上下文 |
| 成功结果 | 返回审批决定已落盘后的最新运行视图；兼容期可继续返回 `RunRecord`，但真源必须是 `approvalRecord` |
| 幂等语义 | 相同 `clientRequestId` 的重复批准返回同一条决定记录；不同请求键对已决审批再次批准必须报冲突 |
| 冲突语义 | 审批已决、审批已过期、关联 session 已被替换或不再等待该审批时，返回“审批不可执行”冲突 |
| 失败语义 | `run` 不存在、审批不存在、审批不再 pending、关联 `task` / `session` 缺失、审批落盘失败 |
| 事件落点 | 追加 `approval_decided(decision=approved)`；若继续执行，再追加 `run_resumed` 或后续执行事件 |
| 页面落点 | Approvals 为主；Session Detail、Task Detail 为次；Inspect 负责审计追溯 |

补充约束：

1. `approve` 只改变审批对象和后续执行资格，不直接把 `task` 标记为完成。
2. `actionPlans` 必须以审批创建时快照为准，批准时不得回看可变 invocation 当前态替换原审批内容。

### `reject`

| 项 | 冻结规则 |
| --- | --- |
| 作用对象 | `approvalRequest` |
| 适用状态 | 与 `approve` 相同，要求审批仍为 `pending` |
| 成功结果 | 返回拒绝决定已落盘后的最新运行视图；兼容期可继续返回 `RunRecord` |
| 幂等语义 | 相同 `clientRequestId` 的重复拒绝返回同一条决定记录；不同请求键对已决审批再次拒绝必须报冲突 |
| 冲突语义 | 与 `approve` 相同；已批准的审批不得再被拒绝，已拒绝的审批不得再次决策 |
| 失败语义 | 与 `approve` 相同 |
| 事件落点 | 追加 `approval_decided(decision=rejected)`；随后由 coordinator 决定是否落 `task_blocked`、`run_finished(status=failed)` 或其他状态事件 |
| 页面落点 | Approvals 为主；Session Detail、Task Detail 为次；Inspect 负责审计追溯 |

补充约束：

1. `reject` 的直接控制结果是“审批被拒绝”，不是“立即删除该 session 历史”。
2. 若拒绝会导致 `task` 进入 `blocked` 或 `run` 进入 `failed`，这些都是后续归约结果，必须由独立事实表达。

### `interact`

| 项 | 冻结规则 |
| --- | --- |
| 作用对象 | `messageThread` 或指定 `taskSession` |
| 适用状态 | 线程存在且可写，或 `taskSession` 处于 `launching`、`attached`、`waiting_approval`、`waiting_message`、`interrupted`、`restorable` 中之一 |
| 成功结果 | 返回新写入的 `sessionMessage` 与对应线程/会话的最新摘要；兼容期至少返回 `messageId`、`threadId`、`sessionId` |
| 幂等语义 | 以 `clientRequestId` 去重；没有 `clientRequestId` 时，每次提交都视为创建一条新消息 |
| 冲突语义 | 线程已归档、目标 session 已终态或不再可交互、发送方不属于线程参与者、目标解析不唯一时返回冲突 |
| 失败语义 | `run` / `thread` / `session` 不存在、正文为空、消息超限、目标参与者无效、消息真源落盘失败 |
| 事件落点 | 先写 `sessionMessage` 真源，再追加 `message_recorded`；如果消息导致后续审批或阻塞解除，由后续事件继续表达 |
| 页面落点 | Workspace、Session Detail 为主；Inspect 展示审计；会话入口解析后的默认线程必须能在 Session Detail 中回看 |

补充约束：

1. 线程入口直接作用于 `threadId`；会话入口只负责把输入解析到该 session 的 `session_primary` 线程，不得私自新建“匿名 lane 对话”。
2. `interact` 不等于 `resume`；发送消息本身不会自动恢复 run，除非后续状态机基于消息事实判定可继续执行。

### `requeue`

| 项 | 冻结规则 |
| --- | --- |
| 作用对象 | `task` |
| 适用状态 | `blocked`、`failed_retryable` |
| 成功结果 | 返回最新 `task` 摘要和新建的 `taskSession` 标识；兼容期若还没有正式 session 读模型，也必须至少返回 `newSessionId` 或等价保留字段 |
| 幂等语义 | 相同 `clientRequestId` 的重复提交必须返回同一个新建 `sessionId`；没有 `clientRequestId` 时，每次成功 `requeue` 都代表一次全新的执行尝试 |
| 冲突语义 | `task` 仍有活动 session、存在 pending approval、已进入 `completed` / `failed_terminal` / `cancelled`，或已有并发 `requeue` 在处理中时返回冲突 |
| 失败语义 | `run` / `task` 不存在、新 session 预留失败、调度或持久化失败、资源配额不足 |
| 事件落点 | 成功创建新执行尝试时追加 `task_requeued`；随后进入 `task_queued`，待真实附着后再写 `session_started` |
| 页面落点 | Task Board、Task Detail 为主；Workspace 展示待处理动作；Inspect 负责审计 |

补充约束：

1. `requeue` 总是创建新的 `taskSession`，绝不复活旧 `sessionId`。
2. 旧 session 必须保留为审计历史；是否归档由任务 3 和任务 8 已冻结的生命周期规则决定。

### `cancel`

| 项 | 冻结规则 |
| --- | --- |
| 作用对象 | `task` |
| 适用状态 | `pending`、`ready`、`routing`、`context_building`、`queued`、`running`、`awaiting_approval`、`validating`、`blocked`、`failed_retryable` |
| 成功结果 | 返回 `task.status = cancelled` 的最新 task 视图；若存在关联活跃 session，还必须反映级联停止结果 |
| 幂等语义 | `cancel` 是状态幂等动作；task 已是 `cancelled` 时重复调用返回当前快照，不再创建新事实 |
| 冲突语义 | `task` 已进入 `completed` 或 `failed_terminal`，或其上游 run 已进入不可变终态时返回冲突 |
| 失败语义 | `run` / `task` 不存在、级联停止活动 session 失败、状态持久化失败 |
| 事件落点 | 先写 `task_cancelled`；若有活动 session，被中断或终止的结果继续落 `session_interrupted` 或会话终态事件 |
| 页面落点 | Task Detail、Task Board 为主；Workspace 展示阻塞解除或取消结果；Inspect 负责审计 |

补充约束：

1. `cancel` 只作用于单个 `task`，不是整个 `run` 终止命令。
2. `cancel` 不得通过内部 graph patch 的隐式副作用替代显式控制事实；用户主动取消必须拥有独立审计事件。

### `interrupt`

| 项 | 冻结规则 |
| --- | --- |
| 作用对象 | `taskSession` |
| 适用状态 | `launching`、`attached`、`waiting_approval`、`waiting_message`；对 `interrupted`、`restorable` 的重复调用视为状态幂等 |
| 成功结果 | 返回最新 `taskSession` 视图，状态应进入 `interrupted` 或 `restorable`，但绝不新建 session |
| 幂等语义 | 相同 `clientRequestId` 的重复调用返回同一次中断结果；session 已为 `interrupted` 或 `restorable` 时重复调用返回当前快照 |
| 冲突语义 | session 已进入 `completed`、`failed`、`cancelled`、`archived`，或不再绑定可中断执行实例时返回冲突 |
| 失败语义 | `run` / `session` 不存在、底层 adapter/runtime 中断失败、状态持久化失败 |
| 事件落点 | 中断请求被接受并完成状态收敛后追加 `session_interrupted`；若 task 因此进入阻塞，再追加 `task_blocked` |
| 页面落点 | Session Detail 为主；Workspace 展示当前活动 session 控制；Inspect 负责审计 |

补充约束：

1. `interrupt` 只针对原会话本体，不得隐式触发 `requeue`。
2. 当前仓库已有 `ExecutionRuntime.interrupt(runId, taskId)` 底层能力；后续实现必须把它提升并改造成 `sessionId` 级契约。

## 冲突与失败语义总表

| 类别 | 适用动作 | 含义 |
| --- | --- | --- |
| `not_found` | 全部 | `run`、`task`、`session`、`thread` 或 `approvalRequest` 不存在 |
| `state_conflict` | 全部 | 目标对象已不在允许状态，或并发动作已改变其状态 |
| `stale_target` | `approve`、`reject`、`interact` | 目标审批、线程或 session 仍存在，但已不是当前可操作上下文 |
| `duplicate_request` | 全部 | 相同 `clientRequestId` 已处理；服务端返回已存在结果，而不是再次执行 |
| `validation_error` | `interact`、`requeue`、`cancel`、`interrupt` | 缺少必要字段、正文为空、原因码非法、会话目标解析失败 |
| `execution_failure` | `resume`、`requeue`、`cancel`、`interrupt` | 运行时恢复、中断、调度或持久化动作失败 |

冻结规则：

1. 冲突与失败必须区分，不能继续用一个通用 `Error` 文本吞掉语义。
2. `duplicate_request` 不属于失败；它是幂等重放结果。
3. `approve` 与 `reject` 的“已决审批”属于 `state_conflict`，不是“审批不存在”。

## 页面落点矩阵

| 动作 | 主页面落点 | 次页面落点 |
| --- | --- | --- |
| `resume` | Runs、Workspace | Inspect |
| `approve` | Approvals | Session Detail、Task Detail、Inspect |
| `reject` | Approvals | Session Detail、Task Detail、Inspect |
| `interact` | Workspace、Session Detail | Inspect |
| `requeue` | Task Board、Task Detail | Workspace、Inspect |
| `cancel` | Task Board、Task Detail | Workspace、Inspect |
| `interrupt` | Session Detail | Workspace、Inspect |

冻结规则：

1. 主页面落点决定动作入口的默认归属，但不限制其他页面展示只读回链。
2. 同一动作在不同页面展示时，必须引用同一动作结果与同一审计事件，不允许各页自行拼装不同语义。

## 与当前仓库实现的直接约束

1. [`src/cli/command-parser.ts`](../src/cli/command-parser.ts) 后续必须补齐 `interact`、`requeue`、`cancel`、`interrupt` 命令解析，且目标对象要分别落到 `thread/session`、`task`、`task`、`session`。
2. [`src/ui-api/server.ts`](../src/ui-api/server.ts) 后续必须新增 `threads/:threadId/messages`、`sessions/:sessionId/interact`、`tasks/:taskId/requeue`、`tasks/:taskId/cancel`、`sessions/:sessionId/interrupt` 端点，不能引入统一 command 分发入口。
3. [`src/control/run-coordinator.ts`](../src/control/run-coordinator.ts) 后续必须为 `resume`、`requeue`、`cancel`、`interrupt` 建立独立 coordinator 契约，不能继续把用户控制动作折叠成内部调度副作用。
4. [`src/adapters/configured-cli-adapter.ts`](../src/adapters/configured-cli-adapter.ts) 与 [`src/execution/execution-runtime.ts`](../src/execution/execution-runtime.ts) 后续必须把中断能力从 `taskId` 执行键提升到 `sessionId` 执行键。
5. [`src/domain/models.ts`](../src/domain/models.ts) 后续必须补齐 `taskSession`、`messageThread`、`sessionMessage` 以及新增控制事件类型，不能继续只靠 `RunRecord` / `TaskSpec` / `ApprovalRequest` 近似表达。

## 对后续任务的直接约束

1. 任务 10 到任务 17 的 projection 设计必须按本文页面落点分配默认动作入口，不得再把所有控制按钮堆回 Workspace。
2. 任务 15 的会话详情页必须承接 `interact` 与 `interrupt` 的主操作入口，并回放同一 `sessionMessage` 与 `session_interrupted` 真源。
3. 任务 16 的审批 projection 必须把 `approve`、`reject` 的冲突态、已决态和 `actionPlans` 快照暴露出来。
4. 任务 18 必须在本文冻结的端点基础上补齐精确请求体、响应体、错误码、分页或游标策略，不能改动动作目标对象粒度。