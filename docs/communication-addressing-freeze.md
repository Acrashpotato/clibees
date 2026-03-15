# 通信寻址模型冻结

## 目标

冻结桥接通信的寻址模型，明确 `user <-> session`、`session <-> session`、群组和广播线程、消息回复链、求助消息、参与者模型与上下文字段，作为后续事件体系、控制动作、UI API 和会话详情 projection 的共同约束。

本文只覆盖任务 6 范围，不展开任务 7 的 run 级事件命名，不展开任务 9 的动作幂等与冲突语义，也不展开任务 15 的页面布局细节。

## 冻结结论

1. 通信寻址的主边界固定为 `participant`、`thread`、`message` 三层，禁止继续用 `laneId` 或自由文本目标描述通信对象。
2. 每个参与者必须拥有稳定 `participantId`，推荐采用 `type:id` 形式，例如 `user:operator`、`session:<sessionId>`、`system:coordinator`。
3. `session_primary` 线程是每个 `taskSession` 的默认主线程，用于承载该 session 与用户/系统的主对话；跨 session 通信不得直接写入对方的主线程。
4. `session <-> session` 通信只能通过 `direct`、`group` 或 `broadcast` 线程完成；目标必须能解析到明确参与者或明确受众范围。
5. 广播不是“把正文发给所有人”的弱约定，而是带有显式 `audience` 的线程或消息目标；发送时必须记录解析后的实际接收者集合，保证审计可追溯。
6. 群组线程是稳定成员边界的通信容器，广播线程是稳定受众规则的通信容器；二者不能互相混用。
7. 单条消息必须同时记录 `sender`、`target`、`resolvedRecipients`；即使目标是群组或广播范围，也不能省略落地后的实际接收者。
8. 回复链最少冻结 `replyToMessageId`、`rootMessageId`、`conversationTurnId` 三个字段，用于支持局部追问、分支讨论和 UI 折叠展示。
9. 求助消息不是特殊线程类型，而是普通 `sessionMessage` 上的 `intent = "help_request"` 变体；其升级、响应和关闭都通过消息链表达。
10. 上下文字段只负责“关联”和“审计”，不替代 `taskId`、`sessionId`、`threadId` 等主关联键；消息正文不得成为唯一上下文真源。
11. `taskId` 可以作为通信上下文，但不能单独作为消息接收目标；真正可投递的对象只能是参与者、线程或广播范围。
12. 后续 `interact` 动作必须直接落到 `threadId` 或显式 `sessionId`，由 coordinator 按本文冻结规则解析到具体线程与目标。

## 寻址原则

### 1. 执行归属与通信归属分离

- `taskSession` 负责执行归属。
- `messageThread` 负责通信容器。
- `sessionMessage` 负责通信事实。
- 同一 `taskSession` 可以参与多个线程；同一线程也可以承载多个 `taskSession` 之间的通信。

### 2. 线程先于消息被定义

- 发送消息前必须已经存在目标线程，或由 coordinator 根据显式规则创建线程。
- adapter 不得自行创建匿名线程，也不得用 stdout/stderr 文本片段隐式发明通信边界。

### 3. 目标必须可解析

- `target` 必须能被解析为单个参与者、多个明确参与者、线程内成员集合或广播受众范围。
- 不能使用“通知相关 agent”“发给当前 lane”这类不可审计的模糊目标。

### 4. 审计必须可回放

- 任一消息都必须能从 `sender`、`target`、`resolvedRecipients`、`threadId`、`contextRefs` 重建发送时语义。
- UI 可以做简化映射，但底层记录必须保留完整结构。

## 参与者模型冻结

### 参与者类型

| 类型 | `participantId` 形状 | 含义 | 必备关联 |
| --- | --- | --- | --- |
| `user` | `user:<userId>` | 人类操作者或审批人 | `runId` |
| `session` | `session:<sessionId>` | 一个 `taskSession` 的通信身份 | `runId`、`taskId`、`sessionId` |
| `system` | `system:<systemId>` | coordinator、approval-service、validator 等系统参与者 | `runId` |

冻结规则：

1. `session` 参与者与 `taskSession` 一一对应，不允许一个参与者跨多个 session 复用。
2. `system` 参与者只能发送系统通知、控制反馈、验证结论等系统消息，不能冒充用户或 session。
3. `user` 参与者可以是单操作者模型下的固定 `user:operator`，也可以在多人协作场景下扩展为多个用户标识，但同一 run 内必须稳定。

### 参与者最小字段

每个参与者至少需要以下字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `participantId` | 是 | 参与者稳定主键 |
| `type` | 是 | `user`、`session`、`system` |
| `runId` | 是 | 所属 run |
| `label` | 是 | 展示名称 |
| `taskId` | 否 | 与单 task 强关联时填写 |
| `sessionId` | 否 | 参与者为 session 时必填 |
| `capabilities` | 否 | 参与者声明的能力标签 |
| `role` | 否 | 例如 `operator`、`executor`、`coordinator`、`reviewer` |
| `active` | 是 | 当前是否仍可接收消息 |

## 线程类型与使用规则

### 1. `session_primary`

用途：

- 作为单个 `taskSession` 的默认主线程。
- 承载 `user <-> session` 的主对话。
- 承载与该 session 直接相关的系统通知。

约束：

1. 每个 `taskSession` 启动时必须创建一个 `session_primary` 线程。
2. 该线程必须包含对应 `session` 参与者，且通常包含 `user:operator` 与必要的 `system` 参与者。
3. 其他 session 不能作为普通成员写入该线程；跨 session 沟通必须改走 `direct`、`group` 或 `broadcast`。

### 2. `direct`

用途：

- 承载两个明确参与者之间的点对点沟通。
- 适用于 `user <-> session` 的私有分支线程，或 `session <-> session` 的一对一沟通。

约束：

1. `direct` 线程必须恰好包含两个非系统主参与者。
2. 至少一方必须是 `session`。
3. 同一对参与者在同一 run 下可以有多个 `direct` 线程，但必须通过 `title` 或 `contextRefs.subject` 区分主题。

### 3. `group`

用途：

- 承载三个及以上明确参与者的稳定协作线程。
- 适用于多 session 协同、用户介入的 triage 讨论、任务小组沟通。

约束：

1. `group` 线程创建时必须冻结初始成员列表。
2. 后续增删成员必须显式记录系统消息，不能静默改写线程边界。
3. 群组线程的成员变化不会改写历史消息的已解析接收者。

### 4. `broadcast`

用途：

- 承载面向一个稳定受众规则的广播消息流。
- 适用于 run 范围公告、某 task 相关 session 广播、风险通告或停机通知。

约束：

1. `broadcast` 线程必须定义 `audience.kind`，初始冻结为 `run_sessions`、`task_sessions`、`explicit_sessions` 三类。
2. `broadcast` 线程发送消息时必须记录 `resolvedRecipients`，用于审计当时实际收到该广播的 session 集合。
3. 广播线程默认不接受自由回复；需要讨论时应由接收者转入 `direct` 或 `group` 线程。

## 目标模型冻结

`sessionMessage.target` 至少采用以下结构之一：

| `target.kind` | 说明 | 必填字段 |
| --- | --- | --- |
| `participant` | 单个明确参与者 | `participantId` |
| `participants` | 多个明确参与者 | `participantIds[]` |
| `thread_members` | 当前线程内除发送者外的全部活跃成员 | 无 |
| `broadcast_audience` | 线程定义的广播受众 | `audience` |

冻结规则：

1. `taskId`、`sessionId` 可以出现在 `target` 的解析参数中，但最终必须归约为参与者或受众范围。
2. 若 `target.kind = "participant"` 且目标是 `session`，必须同步在消息上写入 `recipientSessionIds`。
3. 若 `target.kind = "participants"` 或广播范围，必须写入去重后的 `resolvedRecipients`。
4. `thread_members` 只允许在 `group` 或 `broadcast` 线程中使用，不允许在 `session_primary` 中替代明确指向。

## 用户与会话通信规则

### `user <-> session`

1. 默认落在目标 session 的 `session_primary` 线程。
2. 如需隔离某个子话题，可创建独立 `direct` 线程，但仍必须保留 `sessionId` 级上下文。
3. 用户发送控制性消息时，正文之外还应通过 `intent` 表达 `instruction`、`clarification`、`decision` 等语义。
4. session 向用户发出的阻塞说明、求助和状态澄清，必须显式写出关联 `taskId`、`sessionId` 和上下文引用，不能只依赖文本描述。

### `session <-> session`

1. 必须通过 `direct` 或 `group` 线程进行，不得写入另一方的 `session_primary`。
2. 发送方和接收方都必须是明确的 `session` 参与者。
3. 如果消息用于任务交接、依赖请求或结果同步，必须携带 `contextRefs.relatedTaskIds` 或等价任务关联。
4. 任何跨 session 通信都必须保留原发 `senderSessionId` 和目标 `recipientSessionIds`，禁止退化为“某 task 发给某 task”。

## 广播与群组规则

### 广播

- `audience.kind = "run_sessions"`：发给当前 run 中满足过滤条件的所有活跃 session。
- `audience.kind = "task_sessions"`：发给某个 `taskId` 关联的全部 session。
- `audience.kind = "explicit_sessions"`：发给显式列出的 session 集合，但沿用广播线程展示语义。

广播附加字段至少需要：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `audience.kind` | 是 | 广播受众类型 |
| `audience.taskId` | 否 | `task_sessions` 时必填 |
| `audience.sessionIds` | 否 | `explicit_sessions` 时必填 |
| `resolvedRecipients` | 是 | 发送时实际命中的参与者列表 |

### 群组

- 群组线程必须保存稳定成员列表。
- 群组线程可以接受回复、子话题和求助升级。
- 当群组成员中含多个 session 时，每条消息仍必须精确记录发送 session 和解析后的接收 session。

## 回复链冻结

`sessionMessage` 至少补齐以下回复字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `replyToMessageId` | 否 | 直接回复的上一条消息 |
| `rootMessageId` | 是 | 所属讨论根消息；首条消息等于自身 |
| `conversationTurnId` | 是 | 同一轮问答或处理链的稳定标识 |

冻结规则：

1. `replyToMessageId` 一旦存在，必须指向同一 `threadId` 下已存在消息。
2. `rootMessageId` 用于 UI 组织折叠和分支，不允许跨线程引用。
3. 转发或跨线程引用必须创建新消息，并通过 `contextRefs.relatedMessageIds` 表达，不得直接篡改原回复链。

## 求助消息冻结

求助消息采用普通 `sessionMessage` 扩展字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `intent` | 是 | 固定为 `help_request` |
| `helpRequestId` | 是 | 本次求助标识 |
| `urgency` | 是 | `low`、`medium`、`high`、`critical` |
| `blocking` | 是 | 是否阻塞当前 session 执行 |
| `requestedCapabilities` | 否 | 希望获得的能力标签 |
| `suggestedParticipantIds` | 否 | 建议协助对象 |
| `deadlineAt` | 否 | 期望响应时间 |

冻结规则：

1. 只有 `session` 或 `user` 可以发出 `help_request`；`system` 只能转发或生成系统级告警，不作为求助发起主体。
2. 求助消息必须附带 `contextRefs`，至少能定位到当前 `taskId`、`sessionId` 和触发原因。
3. 求助关闭采用后续消息表达，`intent` 可为 `help_response`、`help_declined`、`help_resolved`，并通过 `helpRequestId` 关联。
4. `blocking = true` 的求助后续应能被 Workspace、Approvals、Inspect 投影消费，但投影规则留给后续任务。

## 上下文字段冻结

`sessionMessage.contextRefs` 至少允许以下字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `subject` | 否 | 当前消息主题 |
| `taskId` | 否 | 关联主 task |
| `sessionId` | 否 | 关联主 session |
| `relatedTaskIds` | 否 | 关联其他 task |
| `relatedSessionIds` | 否 | 关联其他 session |
| `approvalRequestId` | 否 | 关联审批 |
| `toolCallId` | 否 | 关联工具调用 |
| `artifactIds` | 否 | 关联产物 |
| `validationId` | 否 | 关联验证 |
| `eventId` | 否 | 关联审计事件 |
| `relatedMessageIds` | 否 | 跨线程引用的消息 |
| `reasonCode` | 否 | 结构化原因码，如 `blocked.dependency` |

冻结规则：

1. `contextRefs` 是附加关联，不替代桥接信封外层的 `runId`、`taskId`、`sessionId`、`threadId`。
2. `contextRefs.sessionId` 与外层 `sessionId` 不一致时，必须被视为“关联对象”，而非发送方归属。
3. 页面可以展示 `subject`、`reasonCode` 的友好文案，但其准源仍是结构化上下文字段。

## `sessionMessage` 追加字段冻结

在任务 5 的最小字段基础上，任务 6 补充如下字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `intent` | 是 | `instruction`、`question`、`answer`、`status_update`、`help_request`、`help_response`、`handoff`、`system_notice` |
| `resolvedRecipients` | 是 | 实际接收者参与者列表 |
| `rootMessageId` | 是 | 讨论根消息 |
| `conversationTurnId` | 是 | 同轮沟通链标识 |
| `helpRequestId` | 否 | 求助链标识 |
| `contextRefs` | 否 | 结构化上下文引用 |

## 典型场景映射

| 场景 | 线程类型 | 发送方 | 目标 | 关键上下文 |
| --- | --- | --- | --- | --- |
| 用户给某个 session 下新指令 | `session_primary` | `user:operator` | `participant(session:<sessionId>)` | `taskId`、`sessionId`、`intent=instruction` |
| session 向用户求助 | `session_primary` 或 `direct` | `session:<sessionId>` | `participant(user:operator)` | `intent=help_request`、`helpRequestId`、`blocking` |
| session A 请求 session B 提供依赖结果 | `direct` | `session:<sessionA>` | `participant(session:<sessionB>)` | `relatedTaskIds`、`reasonCode` |
| 多个 session 联合排查阻塞问题 | `group` | 任一成员 | `thread_members` | `subject`、`relatedTaskIds` |
| coordinator 发布 run 级暂停通知 | `broadcast` | `system:coordinator` | `broadcast_audience(run_sessions)` | `reasonCode=run.paused`、`resolvedRecipients` |

## 与当前仓库实现的差距

1. [`src/domain/models.ts`](../src/domain/models.ts) 当前 `RunEvent` 只显式携带 `taskId`，尚未具备参与者、线程、接收者和回复链字段。
2. [`src/ui-read-models/models.ts`](../src/ui-read-models/models.ts) 与 [`apps/console/src/types.ts`](../apps/console/src/types.ts) 当前仍使用 `laneId` 组织工作台与审批队列，无法表达 `thread` 和 `participant` 级寻址。
3. 当前仓库还没有 `messageThread`、`sessionMessage`、`participant` 的真源存储，也没有广播受众解析与回复链记录。
4. [`apps/console/src/pages/LaneConsolePage.vue`](../apps/console/src/pages/LaneConsolePage.vue) 当前展示的是 lane 视图和 terminal preview，不是基于真实线程寻址的会话通信视图。

## 对后续任务的直接约束

1. 任务 7 必须把 `participantId`、`sender`、`target`、`resolvedRecipients`、`helpRequestId`、`contextRefs` 等字段映射进去 UI 化后的事件体系。
2. 任务 9 的 `interact` 动作必须支持“指定 `threadId` 发送”和“指定 `sessionId` 发送后解析到默认线程”两种入口。
3. 任务 12、15、17 的 projection 设计必须以 `threadId`、`participantId`、`resolvedRecipients` 和回复链为准源，而不是从 terminal 文本反推。
4. 任务 19 的一致性规则必须覆盖同一消息在 Workspace、Session Detail、Approvals、Inspect 中的固定映射与可追溯性。