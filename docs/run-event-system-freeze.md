# 运行事件体系冻结

## 目标

冻结 `run` 级审计事件体系，确保事件只表达编排、执行、控制事实，不再混入 `lane`、页面模块或终端拼装语义，并统一补齐 `sessionId`、`threadId`、`toolCallId`、`approvalRequestId` 等关联键。

本文只覆盖任务 7 范围，不展开任务 8 的完整状态机，也不展开任务 9 的动作端点契约。

## 冻结结论

1. `RunEvent` 是 `run` 级审计事实流和 projection 准源之一，不是 `messageThread`、`sessionMessage`、`toolCall`、`artifact`、`approvalRequest` 的真源替代物。
2. 事件命名只允许表达领域事实，不允许继续引入 `lane`、`workspace`、`console`、`panel`、`focus` 等 UI 语义。
3. 所有涉及会话、线程、工具调用、审批、验证、artifact 的事件，都必须把稳定关联键提升到事件外层，而不是藏在 `payload` 里等待页面反推。
4. `payload` 只承载该事实自己的快照、原因、结果和补充上下文，不承担主外键职责，也不承担页面展示文案拼装职责。
5. 任务 5 冻结的六类桥接事件在写入真源后，必须投影为去 UI 化的 `run` 级事件；桥接输入层和 `run` 级审计层可以分层，但事实命名必须一致或可确定映射。
6. 当前 `agent_message`、`artifact_created`、`validation_passed`、`validation_failed` 属于过渡命名；目标事件体系分别收敛为 `message_recorded`、`artifact_recorded`、`validation_finished`。
7. `task`、`taskSession`、`approvalRequest`、`messageThread`、`toolCall` 的聚合或状态归约由后续任务负责；本轮只冻结事件对象能否稳定追溯这些实体。

## 顶层事件对象冻结

`RunEvent` 目标最小形状冻结如下：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schemaVersion` | 是 | 事件 schema 版本 |
| `id` | 是 | 事件主键 |
| `type` | 是 | 去 UI 化后的事件类型 |
| `runId` | 是 | 顶层运行标识 |
| `timestamp` | 是 | 事件落入审计流的时间 |
| `taskId` | 否 | 事件聚焦单 task 时必填 |
| `sessionId` | 否 | 事件由单个 `taskSession` 触发时必填 |
| `threadId` | 否 | 事件涉及消息线程或线程上下文时必填 |
| `toolCallId` | 否 | 事件涉及工具调用时必填 |
| `approvalRequestId` | 否 | 事件涉及审批请求时必填 |
| `artifactId` | 否 | 事件指向单条 artifact 时必填 |
| `validationId` | 否 | 事件指向单次验证时必填 |
| `payload` | 是 | 当前事实的补充快照 |

冻结约束：

1. `laneId` 不得再出现在 `RunEvent` 顶层字段或 `payload` 中。
2. 只要事件能够稳定定位某个 `session`、`thread`、`toolCall`、`approvalRequest`、`artifact`、`validation`，就必须使用对应外层字段。
3. `payload` 中允许保留冗余快照字段，但冗余字段不得成为唯一可用的关联来源。
4. 事件标题、页面标签、摘要卡片文案属于 projection 责任，不得写成事件类型或结构字段。

## 事件家族冻结

### 1. 编排事实

| 事件类型 | 必备关联键 | 说明 |
| --- | --- | --- |
| `run_started` | `runId` | 运行创建并进入编排链路 |
| `memory_recalled` | `runId` | 召回项目记忆 |
| `task_planned` | `runId`、`taskId` | 新 task 被规划进入图 |
| `task_queued` | `runId`、`taskId` | task 进入可执行队列 |
| `agent_selected` | `runId`、`taskId` | 为 task 选定 agent/profile |
| `context_built` | `runId`、`taskId` | task 执行上下文完成 |
| `invocation_planned` | `runId`、`taskId` | 形成执行/调用计划 |
| `replan_requested` | `runId`、`taskId` | 因验证或阻塞请求重规划 |
| `replan_applied` | `runId`、`taskId` | 图补丁已落地 |
| `workspace_drift_detected` | `runId` | 发现工作区漂移事实 |
| `run_finished` | `runId` | run 进入终态 |

约束：

1. 这些事件不得带入 `lane` 语义，也不得引用页面模块名。
2. `task` 级编排事实默认以 `taskId` 为主键；只有当事实由某个具体执行会话触发时，才额外携带 `sessionId`。

### 2. 会话执行事实

| 事件类型 | 必备关联键 | 说明 |
| --- | --- | --- |
| `session_started` | `runId`、`taskId`、`sessionId`、`threadId` | 真实 CLI 会话已附着 |
| `task_started` | `runId`、`taskId`、`sessionId` | task 在某个 session 上进入执行 |
| `task_completed` | `runId`、`taskId`、`sessionId` | 当前 task 在某个 session 上执行完成 |
| `task_failed` | `runId`、`taskId`、`sessionId` | 当前 task 在某个 session 上执行失败 |
| `task_blocked` | `runId`、`taskId` | task 因审批、验证或运行事实阻塞 |

约束：

1. `task_started`、`task_completed`、`task_failed` 在多 session 模型下不再默认等价于“task 唯一生命周期事件”，必须显式携带 `sessionId`。
2. `task_blocked` 若来自某个具体会话或审批请求，应额外补齐 `sessionId`、`approvalRequestId`。

### 3. 通信与桥接事实

| 事件类型 | 必备关联键 | 说明 |
| --- | --- | --- |
| `message_recorded` | `runId`、`threadId` | 某条线程消息已落盘并可审计 |
| `tool_called` | `runId`、`taskId`、`sessionId`、`threadId`、`toolCallId` | 工具调用已发起 |
| `tool_finished` | `runId`、`taskId`、`sessionId`、`threadId`、`toolCallId` | 工具调用已结束 |
| `artifact_recorded` | `runId`、`artifactId` | artifact 真源已落盘 |
| `validation_started` | `runId`、`taskId` | 验证开始 |
| `validation_finished` | `runId`、`taskId`、`validationId` | 验证结束并给出结果 |

约束：

1. `message_recorded` 是 `agent_message` 的替代事件名，必须能回链到 `threadId`，涉及会话时还必须回链 `sessionId`。
2. `artifact_recorded` 是 `artifact_created` 的替代事件名；若 artifact 来源于工具调用或审批请求，应同时补齐 `toolCallId` 或 `approvalRequestId`。
3. `validation_finished` 用 `payload.outcome` 表达 `pass`、`fail_retryable`、`fail_replan_needed`、`blocked`，不再把结果拆成多个互斥类型。

### 4. 控制与审批事实

| 事件类型 | 必备关联键 | 说明 |
| --- | --- | --- |
| `approval_requested` | `runId`、`taskId`、`sessionId`、`approvalRequestId` | 审批请求已创建 |
| `approval_decided` | `runId`、`taskId`、`sessionId`、`approvalRequestId` | 审批决定已记录 |

约束：

1. 审批事实必须显式携带发起 `sessionId`，不能只停留在 `taskId`。
2. `approval_decided` 只能表达“决策已发生”，不能混入后续 task 状态归约结论。

## 任务 5 桥接事件到 run 级事件的映射

| 桥接输入事件 | run 级审计事件 | 备注 |
| --- | --- | --- |
| `session_started` | `session_started` | 命名保持一致 |
| `bridge_message` | `message_recorded` | 以消息真源写入后再投影 |
| `tool_called` | `tool_called` | 命名保持一致 |
| `tool_finished` | `tool_finished` | 命名保持一致 |
| `artifact_recorded` | `artifact_recorded` | 命名保持一致 |
| `validation_finished` | `validation_finished` | 命名保持一致 |

补充规则：

1. 如果 coordinator 在验证前显式启动了验证器，可额外追加 `validation_started`。
2. run 级事件必须引用真源记录的稳定标识，不能只抄写一段终端文本。
3. 任何桥接事件被投影为 run 级事件时，都不得重新引入 `lane`、`terminalPreview`、`sourceLabel` 等 UI 字段。

## 旧事件命名清理计划

| 当前命名 | 冻结后命名 | 处理原则 |
| --- | --- | --- |
| `agent_message` | `message_recorded` | 保留消息事实，移除“只属于 agent 输出”的暗示 |
| `artifact_created` | `artifact_recorded` | 以真源落盘为准，不强调由谁“创建” |
| `validation_passed` | `validation_finished` | 结果写入 `payload.outcome = "pass"` |
| `validation_failed` | `validation_finished` | 结果写入 `payload.outcome = "fail_*"` |

说明：

1. 当前仓库中仍存在旧事件名，兼容期允许读取，但新增实现不得继续扩写旧命名。
2. 是否保留 `task_started` / `task_completed` / `task_failed` 作为 task 聚合层事实，留给任务 8 结合状态机进一步约束；本轮先冻结其必须显式带 `sessionId`。

## payload 允许与禁止内容

允许：

- `summary`、`reason`、`details`、`decision`、`riskLevel`
- 执行快照，如 `command`、`args`、`cwd`、`exitCode`
- 验证结果，如 `outcome`、`validatorKind`
- 桥接补充信息，如 `streamChannel`、`bodyFormat`

禁止：

- `laneId`
- `laneLabel`
- `workspacePanel`
- `focusLane`
- `terminalPreview`
- `pageSection`
- 只能供某个页面消费的卡片拼装字段

## 与当前仓库实现的直接约束

1. [`src/domain/models.ts`](../src/domain/models.ts) 后续必须扩展 `RunEvent` 顶层关联键，而不是继续把 `requestId`、`artifactId`、`messageId` 等塞进 `payload`。
2. [`src/execution/execution-runtime.ts`](../src/execution/execution-runtime.ts) 和 [`src/adapters/configured-cli-adapter.ts`](../src/adapters/configured-cli-adapter.ts) 后续必须停止产出 `agent_message`，改为先写消息真源，再投影 `message_recorded`。
3. [`src/control/run-coordinator.ts`](../src/control/run-coordinator.ts) 后续必须把 `approval_requested`、`approval_decided`、`artifact_recorded`、`validation_finished` 补齐 `sessionId`、`approvalRequestId`、`artifactId`、`validationId` 等外层关联键。
4. [`src/storage/event-store.ts`](../src/storage/event-store.ts) 的过滤与恢复接口后续必须支持 `sessionId`、`threadId`、`approvalRequestId`、`toolCallId` 等维度，而不再只按 `taskId` 聚合。
5. [`src/control/inspection-aggregator.ts`](../src/control/inspection-aggregator.ts) 后续必须从新事件字段构建时间线，不能继续依赖旧 payload 猜测消息、审批和 artifact 的归属。

## 对后续任务的直接约束

1. 任务 8 冻结状态机时，必须以本事件体系作为状态变化的事实输入，不得重新发明一套 `lane` 生命周期事件。
2. 任务 9 定义控制动作契约时，必须让动作结果落在本事件体系中，尤其是审批、恢复、中断、重派相关事件。
3. 任务 15、16、17 的页面 projection 必须直接消费这里冻结的关联键，不能继续从 `payload.summary` 或旧 `laneId` 推断会话归属。
