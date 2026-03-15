# 核心实体命名与关系冻结

## 目标

冻结可视化 CLI 任务编排管理系统的核心运行实体命名，明确各实体的职责、主键、主挂载层级与关联规则，作为后续状态机、事件体系、UI API 和 console 类型改造的前置约束。

本文件只覆盖任务1范围，不展开任务2之后的生命周期、控制动作、projection 拆分与页面细节。

## 命名冻结原则

1. `run` 是单次编排运行的顶层边界。
2. `task` 是工作目标与依赖图节点，不再兼作 CLI 会话实例。
3. `taskSession` 是具体 CLI 窗口中的执行实例，是审批、工具调用、artifact、消息的执行归属主体。
4. `messageThread` 是通信线程容器，不替代 `taskSession` 的执行归属语义。
5. `lane` 仅作为兼容期 UI 历史别名，不再作为正式运行实体命名；新模型、存储、事件、API、console 类型中不得新增 `laneId`。

## 实体冻结总表

| 实体 | 主键 | 主挂载层级 | 核心职责 | 关键必备关联 |
| --- | --- | --- | --- | --- |
| `run` | `runId` | 根实体 | 表示一次完整编排运行，提供统一审计与聚合边界 | 无父级；聚合 `task`、`taskSession`、`approvalRequest`、`artifact`、`event`、`messageThread` |
| `task` | `taskId` | `run` | 表示工作目标、依赖关系和任务级状态归约，不直接承载具体会话输出 | `runId` |
| `taskSession` | `sessionId` | `task` | 表示某个 task 的一次具体 CLI 执行实例，是执行事实的主归属实体 | `runId`、`taskId` |
| `approvalRequest` | `approvalRequestId` | `taskSession` | 表示一次审批请求及其冻结快照 | `runId`、`taskId`、`sessionId` |
| `actionPlan` | `actionPlanId` | `approvalRequest` | 表示审批时提交的单条行动计划快照，不作为独立聚合根 | `approvalRequestId` |
| `artifact` | `artifactId` | `taskSession` | 表示执行、验证、审批过程中产出的持久化证据 | `runId`、`taskId`、`sessionId` |
| `event` | `eventId` | `run` | 表示追加式运行事实流，是 projection 的准源之一 | `runId`，按类型可选关联 `taskId`、`sessionId`、`threadId`、`approvalRequestId`、`artifactId` |
| `messageThread` | `threadId` | `run` | 表示通信线程及参与者范围，承载消息编组和寻址上下文 | `runId`，可选 `taskId` |
| `sessionMessage` | `messageId` | `messageThread` | 表示线程中的单条消息事实；当会话参与时必须回链到对应 `taskSession` | `runId`、`threadId`，以及参与通信的发送方/接收方 |

## 实体详细定义

### 1. `run`

- 职责：单次用户目标执行的顶层编排容器，是持久化、审计、查询和控制动作归集的根边界。
- 归属：根实体，无父级。
- 必备标识：`runId`。
- 最小核心字段：
  - `goal`
  - `workspacePath`
  - `status`
  - `createdAt`
  - `updatedAt`
- 聚合关系：
  - 一个 `run` 包含多个 `task`
  - 一个 `run` 包含多个 `taskSession`
  - 一个 `run` 包含多个 `approvalRequest`
  - 一个 `run` 包含多个 `artifact`
  - 一个 `run` 包含多个 `event`
  - 一个 `run` 包含多个 `messageThread`
- 约束：任何运行事实都必须可追溯回唯一 `runId`。

### 2. `task`

- 职责：表达待完成工作目标、依赖关系、执行约束和任务级聚合状态。
- 主键：`taskId`。
- 父级：`run`。
- 必备关联：`runId`。
- 最小核心字段：
  - `title`
  - `goal`
  - `dependsOn`
  - `status`
  - `kind`
  - `requiredCapabilities`
- 聚合关系：
  - 一个 `task` 归属于一个 `run`
  - 一个 `task` 后续可关联多个 `taskSession`
- 非职责边界：
  - `task` 不直接承载终端输出
  - `task` 不直接作为审批、artifact、消息的主挂载点
  - `task` 不替代 `taskSession` 表达具体 CLI 进程实例

### 3. `taskSession`

- 职责：表示某个 `task` 的一次具体执行实例，对应一个 CLI 临时员工会话。
- 主键：`sessionId`。
- 父级：`task`。
- 必备关联：`runId`、`taskId`。
- 最小核心字段：
  - `sessionId`
  - `runId`
  - `taskId`
  - `status`
  - `adapterId`
  - `workingDirectory`
  - `startedAt`
  - `updatedAt`
- 绑定语义：
  - `taskSession` 需要绑定实际 CLI 进程或窗口标识
  - 绑定字段后续至少覆盖进程实例标识、终端窗口标识或等价恢复句柄
- 主挂载关系：
  - `approvalRequest`
  - `artifact`
  - `sessionMessage` 的会话参与归属
  - 后续 `toolCall`
- 约束：
  - `taskSession` 是执行事实的主归属主体
  - 任何审批、artifact、消息、工具调用都必须能回链到触发它的 `sessionId`

### 4. `approvalRequest`

- 职责：表示某个会话为继续执行而发起的一次审批请求。
- 主键：`approvalRequestId`。
- 父级：`taskSession`。
- 必备关联：`runId`、`taskId`、`sessionId`。
- 最小核心字段：
  - `approvalRequestId`
  - `runId`
  - `taskId`
  - `sessionId`
  - `reason`
  - `requestedAt`
  - `status`
- 子级关系：
  - 一个 `approvalRequest` 包含一个或多个 `actionPlan`
- 约束：
  - `approvalRequest` 的 `actionPlans` 是审批创建时的冻结快照
  - 审批记录不能只挂在 `task`，必须显式保留 `sessionId`

### 5. `actionPlan`

- 职责：表示审批中单条可执行动作的静态快照。
- 主键：`actionPlanId`。
- 父级：`approvalRequest`。
- 必备关联：`approvalRequestId`。
- 最小核心字段：
  - `actionPlanId`
  - `approvalRequestId`
  - `kind`
  - `riskLevel`
  - `requiresApproval`
  - `reason`
- 约束：
  - `actionPlan` 不单独升级为顶层运行实体
  - `actionPlan` 只通过所属 `approvalRequest` 被查询和审计

### 6. `artifact`

- 职责：表示执行、验证、审批链路中产出的持久化证据。
- 主键：`artifactId`。
- 父级：`taskSession`。
- 必备关联：`runId`、`taskId`、`sessionId`。
- 最小核心字段：
  - `artifactId`
  - `runId`
  - `taskId`
  - `sessionId`
  - `kind`
  - `uri`
  - `summary`
  - `createdAt`
- 可选关联：
  - `approvalRequestId`
  - `threadId`
  - 后续 `toolCallId`
- 约束：
  - artifact 可以向 `task` 和 `run` 聚合展示
  - 但准源记录必须保留 `sessionId`

### 7. `event`

- 职责：表示追加式、不可回写的运行事实流。
- 主键：`eventId`。
- 父级：`run`。
- 必备关联：`runId`。
- 最小核心字段：
  - `eventId`
  - `runId`
  - `type`
  - `timestamp`
  - `payload`
- 可选关联：
  - `taskId`
  - `sessionId`
  - `threadId`
  - `approvalRequestId`
  - `artifactId`
  - 后续 `toolCallId`
- 约束：
  - `event` 只表达编排、执行、通信、审批、验证事实
  - 事件命名与字段中不得继续使用 `lane` 作为正式语义

### 8. `messageThread`

- 职责：表示通信线程及其参与者边界，用于组织消息流和寻址上下文。
- 主键：`threadId`。
- 父级：`run`。
- 必备关联：`runId`。
- 可选关联：`taskId`。
- 最小核心字段：
  - `threadId`
  - `runId`
  - `type`
  - `participants`
  - `createdAt`
  - `updatedAt`
- 约束：
  - `messageThread` 是通信容器，不是执行归属实体
  - 一个线程可以包含 `user <-> session`、`session <-> session`、群组或广播通信

### 9. `sessionMessage`

- 职责：表示线程中的单条消息事实。
- 主键：`messageId`。
- 父级：`messageThread`。
- 必备关联：`runId`、`threadId`。
- 最小核心字段：
  - `messageId`
  - `runId`
  - `threadId`
  - `sender`
  - `target`
  - `body`
  - `createdAt`
- 可选关联：
  - `taskId`
  - `senderSessionId`
  - `recipientSessionId`
  - `replyToMessageId`
  - `contextKey`
- 约束：
  - 当消息涉及会话参与者时，必须显式记录相关 `sessionId`
  - `threadId` 负责组织消息顺序，`sessionId` 负责执行归属追溯

## 关系冻结规则

1. `run` 是唯一顶层聚合根。
2. `task` 只能归属于一个 `run`。
3. `taskSession` 只能归属于一个 `task` 和一个 `run`。
4. `approvalRequest`、`artifact` 必须直接挂载到 `taskSession`，并冗余保留 `taskId`、`runId` 以支持聚合查询。
5. `actionPlan` 只能作为 `approvalRequest` 的子项存在。
6. `messageThread` 归属于 `run`，`sessionMessage` 归属于 `messageThread`；只要消息涉及会话，必须额外保留相关 `sessionId`，确保 session 视图可追溯。
7. `event` 归属于 `run`，通过可选关联键回链 `task`、`taskSession`、`approvalRequest`、`artifact`、`messageThread`。
8. `lane` 不得再作为任一实体主键或正式外键命名；兼容期只能在映射层解释其对应的是 `taskId` 还是 `sessionId`。

## 现状到目标的命名映射

| 现状 | 冻结后语义 |
| --- | --- |
| `RunInspection` 大一统聚合对象 | 过渡期聚合对象，不是长期主读模型真源 |
| `laneId` | 必须拆分为 `taskId` 或 `sessionId` |
| `LaneView` / `WorkspaceLaneStatus` | 后续拆为 task/session 语义专用读模型 |
| 仅 `run/task` 级审批与 artifact | 改为以 `taskSession` 为主挂载，并向 task/run 聚合 |

## 对当前仓库的直接约束

1. [`src/domain/models.ts`](../src/domain/models.ts) 后续新增核心实体时，必须采用本文件冻结命名，不得再引入 `lane` 运行语义。
2. [`src/ui-read-models/models.ts`](../src/ui-read-models/models.ts) 与 [`apps/console/src/types.ts`](../apps/console/src/types.ts) 中现有 `lane` 命名仅视为兼容遗留，后续任务需要按本文件拆分。
3. [`src/control/inspection-aggregator.ts`](../src/control/inspection-aggregator.ts) 仍可作为过渡聚合器存在，但后续不得继续扩张为所有页面的长期统一真源。
4. 本任务不直接修改运行时代码行为，只冻结后续实现必须遵守的实体边界。
