# 桥接通讯协议冻结

## 目标

冻结 adapter 到 coordinator 的统一桥接通讯协议，定义线程化事件信封、桥接事件类型和 `messageThread` / `sessionMessage` 的最小字段集，作为后续通信寻址、事件体系扩展、控制动作和页面 projection 的共同前提。

本文只覆盖任务 5 范围，不展开任务 6 的完整寻址模型，不展开任务 7 的 run 级事件体系扩展，也不展开任务 15 的页面展示细节。

## 冻结结论

1. adapter 与 coordinator 之间的桥接流不再直接输出散乱的 `agent_message` 或 `task_*` 片段，而是统一输出 `BridgeEnvelope`。
2. `BridgeEnvelope` 以 `runId`、`taskId`、`sessionId`、`threadId` 为标准关联键，禁止继续以 `laneId` 表达通信上下文。
3. coordinator 在启动 `taskSession` 前必须先分配 `sessionId` 与默认主线程 `threadId`，adapter 只消费这些标识，不自行发明运行实体命名。
4. 本轮冻结的桥接事件类型只有六类：`session_started`、`bridge_message`、`tool_called`、`tool_finished`、`artifact_recorded`、`validation_finished`。
5. `messageThread` 是通信容器，`sessionMessage` 是线程中的消息事实；二者必须独立持久化，不能继续退化为仅靠 `events.jsonl` 中的文本片段拼装。
6. 桥接协议必须支持流式输出，但流式只是消息投递方式，不改变 `threadId`、`sessionId`、`toolCallId`、`artifactId` 等领域关联键的稳定性。
7. coordinator 收到桥接事件后，必须先写入线程/消息/工具调用/artifact/validation 真源，再追加 run 级审计事件；run 级事件扩展命名留到任务 7 冻结。

## 角色边界

### coordinator

- 分配 `runId`、`taskId`、`sessionId`、默认主线程 `threadId`
- 把线程上下文和会话上下文传给 adapter
- 接收 `BridgeEnvelope`
- 负责幂等写入、事件补链、审计追加和 projection 原料沉淀

### adapter

- 负责把底层 CLI 进程、终端窗口、工具执行和输出流翻译成统一桥接事件
- 不负责定义新的领域主键
- 不负责决定任务级或 run 级状态归约

### messageThread

- 表示一条独立通信线程
- 负责承载参与者边界、线程类型和上下文归属
- 不替代 `taskSession` 的执行归属语义

### sessionMessage

- 表示线程中的单条消息事实
- 负责记录发送方、目标范围、正文、回复链和上下文关联
- 当消息涉及会话时，必须显式回链到 `sessionId`

## 协议总流程

1. coordinator 为待执行的 `task` 创建 `taskSession`。
2. coordinator 为该 `taskSession` 分配默认主线程 `threadId`，并把 `runId`、`taskId`、`sessionId`、`threadId` 注入 adapter 运行上下文。
3. adapter 启动底层 CLI 实例后，首先发出 `session_started`。
4. adapter 在执行过程中持续发出 `bridge_message`、`tool_called`、`tool_finished`、`artifact_recorded`、`validation_finished`。
5. coordinator 按 `envelopeId` 和 `sessionSequence` 去重，按会话内顺序落盘。
6. coordinator 将这些桥接事实投影到 run 级审计事件和页面 projection。

## 统一事件信封

所有桥接事件都必须采用统一信封：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schemaVersion` | 是 | 当前桥接协议 schema 版本，初始冻结为 `1` |
| `protocolVersion` | 是 | 逻辑协议版本，初始冻结为 `"bridge.v1"` |
| `envelopeId` | 是 | 单条桥接事件唯一标识，用于幂等写入 |
| `eventType` | 是 | 桥接事件类型，限定为六类冻结值 |
| `runId` | 是 | 顶层运行标识 |
| `taskId` | 是 | 所属任务标识 |
| `sessionId` | 是 | 所属执行会话标识 |
| `threadId` | 是 | 所在线程标识；非消息事件也必须显式携带线程上下文 |
| `sessionSequence` | 是 | 会话内单调递增序号，用于恢复顺序 |
| `occurredAt` | 是 | 事件在 adapter 侧产生的时间 |
| `adapterId` | 是 | 发出事件的 adapter 标识 |
| `agentId` | 是 | 当前会话绑定的 agent 标识 |
| `correlation` | 否 | 跨事件关联对象，至少预留 `invocationId`、`toolCallId`、`approvalRequestId`、`artifactId`、`validationId` |
| `payload` | 是 | 对应事件类型的变体负载 |

冻结规则：

1. `sessionSequence` 在同一 `sessionId` 内必须严格递增。
2. 同一 `envelopeId` 重放时，coordinator 必须按幂等处理。
3. `threadId` 不允许省略；如果事件来自默认主线程，也必须显式写入该主线程。
4. `payload` 只允许承载该事件自己的事实，不得混入 run 级摘要拼装字段。

## 事件类型冻结

### 1. `session_started`

用途：声明 adapter 已经成功附着到一个真实 `taskSession`，并给出绑定快照。

最小负载字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `binding.kind` | 是 | 绑定类型，如 `process`、`terminal`、`pty` |
| `binding.processId` | 否 | 底层进程标识 |
| `binding.windowId` | 否 | 窗口或终端句柄 |
| `binding.terminalSessionId` | 否 | 终端会话句柄 |
| `binding.cwd` | 否 | 实际工作目录 |
| `binding.startedCommand` | 否 | 实际启动命令 |
| `binding.startedArgs` | 否 | 实际启动参数 |
| `startedAt` | 是 | 会话实际开始时间 |
| `resumeCapability` | 是 | 当前会话是否可恢复 |

约束：

- `session_started` 是 `taskSession` 从 provisioned 进入 attached 事实链的起点。
- 同一 `sessionId` 只允许一个有效首个 `session_started`；后续若出现同类事件，必须显式标记为重附着或恢复语义。

### 2. `bridge_message`

用途：承载线程中的文本消息、流式输出片段、系统提示或跨会话通信内容。

最小负载字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `messageId` | 是 | 消息唯一标识 |
| `messageKind` | 是 | `user_text`、`agent_text`、`system_notice`、`stream_chunk` 之一 |
| `sender` | 是 | 发送方引用 |
| `target` | 是 | 目标范围引用 |
| `body` | 是 | 文本正文 |
| `bodyFormat` | 是 | 初始冻结为 `plain_text` 或 `markdown` |
| `createdAt` | 是 | 消息创建时间 |
| `replyToMessageId` | 否 | 回复链引用 |
| `contextKey` | 否 | 上下文关联键 |
| `streamChannel` | 否 | `stdout`、`stderr`、`chat`、`system` |

约束：

- 流式输出必须通过 `messageKind = "stream_chunk"` 表达，而不是继续复用旧 `agent_message`。
- `bridge_message` 只表达消息事实，不直接替代 `tool_called`、`artifact_recorded` 等结构化事件。

### 3. `tool_called`

用途：声明某个工具调用已经开始或已被提交执行。

最小负载字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `toolCallId` | 是 | 工具调用唯一标识 |
| `toolName` | 是 | 工具名称 |
| `arguments` | 否 | 结构化参数快照 |
| `command` | 否 | 命令行工具时的实际命令 |
| `cwd` | 否 | 工具执行目录 |
| `requestedAt` | 是 | 调用发起时间 |
| `approvalRequestId` | 否 | 若由审批放行产生则显式关联 |

约束：

- `tool_called` 是独立事实，不得依赖正文文本解析恢复。
- 同一 `toolCallId` 后续必须由 `tool_finished` 收口，除非会话异常终止并由任务 8 的状态机显式判定为中断未完成。

### 4. `tool_finished`

用途：声明某个工具调用已经结束并给出结果。

最小负载字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `toolCallId` | 是 | 对应开始事件的调用标识 |
| `status` | 是 | `succeeded`、`failed`、`cancelled` |
| `finishedAt` | 是 | 调用结束时间 |
| `durationMs` | 否 | 执行时长 |
| `exitCode` | 否 | 进程退出码 |
| `errorMessage` | 否 | 失败摘要 |
| `outputSummary` | 否 | 结果摘要 |
| `artifactIds` | 否 | 调用直接产出的 artifact 标识列表 |

约束：

- `tool_finished` 必须与既有 `toolCallId` 对齐，不允许另起新主键。
- 调用结果是否影响任务状态由 coordinator 和后续状态机决定，不能由 adapter 直接改写 task/run 状态。

### 5. `artifact_recorded`

用途：声明会话链路产生了一条可持久化证据。

最小负载字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `artifactId` | 是 | artifact 唯一标识 |
| `kind` | 是 | artifact 类型 |
| `uri` | 是 | artifact 定位地址 |
| `summary` | 是 | 摘要 |
| `createdAt` | 是 | 产出时间 |
| `metadata` | 否 | 扩展元数据 |
| `toolCallId` | 否 | 来源工具调用 |
| `approvalRequestId` | 否 | 来源审批请求 |

约束：

- `artifact_recorded` 是 artifact 真源写入信号，不再要求页面从 `artifact_created` 文本细节反推上下文。
- artifact 必须显式携带 `sessionId` 和 `threadId` 的外层上下文，保证会话与线程视图可追溯。

### 6. `validation_finished`

用途：声明某次验证已经收敛到明确结果。

最小负载字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `validationId` | 是 | 验证唯一标识 |
| `validatorKind` | 是 | 验证器类型 |
| `outcome` | 是 | `pass`、`fail_retryable`、`fail_replan_needed`、`blocked` |
| `summary` | 是 | 验证结论摘要 |
| `details` | 否 | 详细说明列表 |
| `finishedAt` | 是 | 验证结束时间 |
| `artifactIds` | 否 | 关联产物 |

约束：

- 任务 5 只冻结结束事件 `validation_finished`，不再要求 adapter 补发单独的 `validation_started` 桥接事件。
- coordinator 后续可投影为 run 级 `validation_started` / `validation_passed` / `validation_failed` 等审计事件，但桥接输入层只认 `validation_finished`。

## `messageThread` 最小字段集

`messageThread` 至少需要以下字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schemaVersion` | 是 | 记录 schema 版本 |
| `threadId` | 是 | 线程主键 |
| `runId` | 是 | 所属 run |
| `threadType` | 是 | 初始冻结为 `session_primary`、`direct`、`group`、`broadcast` |
| `participants` | 是 | 参与者引用列表 |
| `createdAt` | 是 | 创建时间 |
| `lastActivityAt` | 是 | 最后活动时间 |
| `createdBy` | 是 | 创建线程的参与者引用 |
| `taskId` | 否 | 若线程聚焦单 task，则显式关联 |
| `sourceSessionId` | 否 | 若线程由某个会话创建，则显式关联 |
| `title` | 否 | 供 UI 展示的稳定标题 |

冻结规则：

1. 每个 `taskSession` 启动时至少拥有一个 `threadType = "session_primary"` 的默认主线程。
2. `threadId` 一经创建不得改写归属 `runId`。
3. `participants` 是线程边界真源；具体寻址和参与者规则在任务 6 继续冻结。
4. 线程是否可见、是否归档属于后续状态和 projection 范围，不在本任务内展开。

## `sessionMessage` 最小字段集

`sessionMessage` 至少需要以下字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schemaVersion` | 是 | 记录 schema 版本 |
| `messageId` | 是 | 消息主键 |
| `runId` | 是 | 所属 run |
| `threadId` | 是 | 所属线程 |
| `messageKind` | 是 | 消息类型 |
| `sender` | 是 | 发送方引用 |
| `target` | 是 | 目标范围引用 |
| `body` | 是 | 正文 |
| `bodyFormat` | 是 | 正文格式 |
| `createdAt` | 是 | 创建时间 |
| `taskId` | 否 | 若与单 task 强关联则显式冗余 |
| `senderSessionId` | 否 | 发送方为 session 时必须显式填写 |
| `recipientSessionIds` | 否 | 明确目标 session 时填写 |
| `replyToMessageId` | 否 | 回复链 |
| `contextKey` | 否 | 上下文关联键 |
| `streamChannel` | 否 | 流式来源通道 |

冻结规则：

1. `sender` 与 `target` 不能退化为纯字符串；至少需要结构化参与者引用。
2. 只要消息涉及 `taskSession`，就必须显式保留 `senderSessionId` 或 `recipientSessionIds`。
3. `replyToMessageId` 可为空，但一旦存在必须指向同一 `runId` 下已存在消息。
4. 单条消息是不可变事实；编辑、撤回、合并等后续操作必须以新事件表达，而不是覆写旧记录。

## 参与者引用最小形状

为避免桥接层继续退化为文本拼接，`sender`、`target`、`participants` 至少采用以下引用形状：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `type` | 是 | `user`、`session`、`system` |
| `id` | 是 | 参与者稳定标识 |
| `sessionId` | 否 | 参与者为会话时填写 |
| `taskId` | 否 | 与单 task 直接绑定时填写 |
| `label` | 否 | 展示名称 |

说明：

- 任务 5 只冻结最小引用形状。
- `user <-> session`、`session <-> session`、群组和广播的精确寻址规则留到任务 6。

## 与当前仓库实现的差距

1. [`src/domain/models.ts`](../src/domain/models.ts) 当前 `RunEvent` 只有 `taskId`，尚未具备 `sessionId`、`threadId`、`toolCallId`、`approvalRequestId` 等关联键。
2. [`src/adapters/configured-cli-adapter.ts`](../src/adapters/configured-cli-adapter.ts) 当前仍把 stdout/stderr 发成 `agent_message`，需要改为发出统一 `BridgeEnvelope`，并纳入 `sessionSequence`。
3. [`src/storage/event-store.ts`](../src/storage/event-store.ts) 当前恢复逻辑只按 `taskId` 聚合，尚未识别会话和线程维度。
4. [`src/control/run-coordinator.ts`](../src/control/run-coordinator.ts) 当前直接消费 `RunEvent` 并归约任务状态，后续需要先引入桥接输入层再投影到 run 级事件。
5. 当前仓库还没有 `messageThread`、`sessionMessage`、`toolCall` 的真源存储。

## 对后续任务的直接约束

1. 任务 6 必须在本协议的 `sender` / `target` / `participants` 形状之上冻结完整寻址模型，不得回退为 `laneId` 或自由文本目标。
2. 任务 7 必须把本协议的六类桥接事件映射到去 UI 化的 run 级事件体系，并补齐 `sessionId`、`threadId`、`toolCallId`、`approvalRequestId` 等关联键。
3. 任务 15 的会话详情页必须以 `messageThread` 和 `sessionMessage` 真源为基础，terminal preview 只能作为附属视图。
4. 任务 18 的 `interact` 动作接口必须直接落到 `threadId` 或 `sessionId`，并复用本协议冻结的消息结构。

## 任务28补充：当前桥接会话回归与调试

### 当前实现与目标命名的关系

任务 5 / 任务 7 已冻结目标桥接事件名：`session_started`、`bridge_message`、`tool_called`、`tool_finished`、`artifact_recorded`、`validation_finished`。

但当前仓库仍处于过渡期，projection 主要从现有 `RunEvent` 回填会话语义：

- `task_started`：兼容期会话启动事实
- `agent_message`：兼容期消息流事实
- `invocation_planned`：兼容期工具调用开始事实
- `artifact_created`：兼容期 artifact 落盘事实
- `validation_passed` / `validation_failed`：兼容期验证结束事实

因此当前页面里出现的 `sessionId` 仍主要来自 `session-backfill.ts`，格式为 `backfill:<taskId>:attempt:<n>`，而不是真实持久化的 `taskSession` 记录。

### 模型命名

- `run`：一次完整编排运行，对应 `.multi-agent/state/runs/<runId>/` 目录。
- `task`：图上的工作目标，是任务板与任务详情的主实体。
- `taskSession`：task 的一次具体 CLI 执行实例；当前尚未落地真实存储，先用兼容期 `sessionId` 回填。
- `approvalRequest`：审批请求，当前已在 projection 中展示 `actionPlans` 快照。
- `messageThread` / `sessionMessage`：目标中的桥接通信真源，当前尚未正式落地。
- `lane`：仅保留为历史 UI 命名，不再是正式运行实体。

### 页面职责

- Runs：展示 `run` 列表和运行级摘要。
- Workspace：展示 `run` 总控、focus task、活动 session 摘要、动作队列、风险摘要和待处理消息。
- Task Board：展示 task DAG、依赖边、活动 session 与重试信息。
- Task Detail：展示单个 `task` 的概览、上下游依赖、sessions、验证和 artifacts。
- Session Detail：展示单个 `sessionId` 的消息流、工具调用、审批、验证、artifact 与 terminal preview。
- Approvals：展示 `approvalRequest` 队列与 `actionPlans` 快照明细。
- Inspect：展示审计时间线、验证记录、审批历史、artifact 摘要和关键 session 事件。
- Legacy Lane Route：只做兼容跳转，不再承担真实详情页职责。

### API 入口

当前 UI API 定义集中在 [`src/ui-api/contracts.ts`](../src/ui-api/contracts.ts)。

读模型接口：

- `GET /api/projections/run-list`
- `GET /api/runs/:runId/projections/workspace`
- `GET /api/runs/:runId/projections/task-board`
- `GET /api/runs/:runId/tasks/:taskId/projection`
- `GET /api/runs/:runId/sessions/:sessionId/projection`
- `GET /api/projections/approval-queue`
- `GET /api/runs/:runId/projections/audit-timeline`

控制接口：

- 已启用：`POST /api/runs`、`POST /api/runs/:runId/resume`、`POST /api/runs/:runId/approvals/:requestId/approve`、`POST /api/runs/:runId/approvals/:requestId/reject`
- 占位未落地：`threads/:threadId/messages`、`sessions/:sessionId/interact`、`tasks/:taskId/requeue`、`tasks/:taskId/cancel`、`sessions/:sessionId/interrupt`

占位接口当前统一返回 `501 not_supported`，这是刻意保留的契约。

### 状态目录

当前状态目录布局由 [`src/storage/state-layout.ts`](../src/storage/state-layout.ts) 定义：

```text
.multi-agent/state/
  runs/
    <runId>/
      run.json
      graph.json
      events.jsonl
      approvals.json
      artifacts/
      blackboard/
      tasks/
      workspace/
```

当前桥接会话链路主要依赖：

- `events.jsonl`：兼容期 session 回填与消息/工具/验证事件准源
- `tasks/<taskId>.json`：任务状态与尝试次数
- `tasks/<taskId>.transcript.jsonl`：当前仍按 `taskId` 命名的 transcript
- `artifacts/<artifactId>.json`：命令结果、验证结果、审批记录等持久化证据

尚未正式落地但已冻结目标的真源包括：`taskSession`、`messageThread`、`sessionMessage`、按 `sessionId` 命名的 transcript。

### 旧路由兼容策略

兼容入口在 [`apps/console/src/router.ts`](../apps/console/src/router.ts) 与 [`apps/console/src/pages/LaneConsolePage.vue`](../apps/console/src/pages/LaneConsolePage.vue)。规则已经固定为：

- `/runs/:runId/lanes/:laneId`：若显式给出 `laneId`，按 `taskId` 兼容映射到 task detail。
- `/runs/:runId/lanes`：若未给出 `laneId`，优先跳转到当前活动 `sessionId` 的 session detail。
- 如果当前 run 还没有可映射的活动 session，则回落到当前 focus task 的 task detail。

`LaneConsolePage` 现在只是兼容路由解析器，不再是长期页面。

### 调试方式

推荐按下面顺序排查桥接会话链路：

1. 运行 `npm test`，确认根测试链路通过。
2. 如只想重放任务 28 回归用例，先运行 `npm run build`，再执行 `node dist/ui-read-models/projection-consistency-regression.test.js`。
3. 如需看 API 返回，运行 `npm run ui-api`，再请求：
   - `GET /api/runs/:runId/sessions/:sessionId/projection`
   - `GET /api/runs/:runId/projections/audit-timeline`
4. 如需核对投影准源，直接查看对应 run 目录下的 `events.jsonl`、`tasks/*.json`、`artifacts/*.json`。
5. 如需核对兼容 `sessionId` 归属，优先检查 [`src/ui-read-models/session-backfill.ts`](../src/ui-read-models/session-backfill.ts)。
6. 如需核对页面消费边界，优先检查：
   - [`src/ui-read-models/build-task-detail-projection.ts`](../src/ui-read-models/build-task-detail-projection.ts)
   - [`src/ui-read-models/build-session-detail-projection.ts`](../src/ui-read-models/build-session-detail-projection.ts)
   - [`src/ui-read-models/build-audit-timeline-projection.ts`](../src/ui-read-models/build-audit-timeline-projection.ts)

### 任务28回归测试

任务 28 在 [`src/ui-read-models/projection-consistency-regression.test.ts`](../src/ui-read-models/projection-consistency-regression.test.ts) 新增了一个独立场景，覆盖以下闭环：

- `task_started` 产生首个兼容期 `sessionId`
- `agent_message` 进入 session detail 消息流与 terminal preview
- `invocation_planned` 与 `command_result` artifact 共同构成工具调用视图
- `validation_passed` + validation record 共同收敛为 task/session/audit 三处一致的验证结论
- audit timeline 中的 session、artifact、validation 记录保持同一 `sessionId`
