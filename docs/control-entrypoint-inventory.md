# 控制入口盘点

## 任务目标

盘点当前仓库已经存在的 CLI 命令、UI API 控制入口、运行状态与事件落点，形成 `run`、`resume`、`inspect`、`approvals`、`approve`、`reject` 以及新增 `interact`、`requeue`、`cancel`、`interrupt` 的输入输出与差距基线，为后续桥接协议、事件扩展和动作契约冻结提供事实依据。

## 当前控制面边界

### 已有 CLI 命令

- `run`
- `resume`
- `inspect`
- `approvals`
- `approve`
- `reject`

命令解析仅定义在 `src/cli/command-parser.ts`，不存在 `interact`、`requeue`、`cancel`、`interrupt` 的 CLI 入口。

### 已有 UI API 路由

- `GET /api/runs`
- `POST /api/runs`
- `GET /api/approvals`
- `GET /api/runs/:runId/workspace`
- `GET /api/runs/:runId/inspect`
- `GET /api/runs/:runId/approvals`
- `POST /api/runs/:runId/resume`
- `POST /api/runs/:runId/approvals/:requestId/approve`
- `POST /api/runs/:runId/approvals/:requestId/reject`

当前 UI API 同样没有 `interact`、`requeue`、`cancel`、`interrupt` 的动作端点。

## 当前状态模型

### Run 状态

`run` 当前支持以下状态：

- `created`
- `planning`
- `ready`
- `running`
- `waiting_approval`
- `replanning`
- `paused`
- `completed`
- `failed`
- `cancelled`

与任务4直接相关的控制门禁如下：

- `run` 创建结束后会从 `planning` 进入 `ready`。
- `resume` 在 `completed`、`failed`、`cancelled` 上直接返回，不再执行。
- `resume` 在检测到工作区漂移时把 `run` 置为 `paused`。
- `resume` 在检测到待审批任务时把 `run` 置为 `waiting_approval`。
- `approve` 仅在存在 pending approval request 时继续推进；批准后通常把 `waiting_approval` 恢复到 `running`。
- `reject` 会把关联任务置为 `blocked`，并把 `run` 收敛到 `failed`。

### Task 状态

`task` 当前支持以下状态：

- `pending`
- `ready`
- `routing`
- `context_building`
- `awaiting_approval`
- `queued`
- `running`
- `validating`
- `completed`
- `failed_retryable`
- `failed_terminal`
- `blocked`
- `cancelled`

当前所有执行控制都仍然围绕 `task` 而非 `taskSession`。这意味着：

- 审批挂载在 `taskId` 上。
- 运行时执行键是 `runId + taskId`。
- 中断能力虽然存在于 runtime/adapter 层，但还没有提升为会话级控制动作。

## 控制入口对照表

| 动作 | 当前入口 | 输入 | 输出 | 当前作用对象 | 当前状态门禁 | 失败返回 | 事件落点 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `run` | CLI: `run <goal> [--config <path>]`。UI: `POST /api/runs` | 必填 `goal`。可选 `configPath`。UI 额外支持 `autoResume`。 | `RunRecord`。CLI `run` 返回新建且进入 `ready` 的 run；UI `autoResume=true` 时可能直接返回执行后的 run 状态。 | `run` | 无前置对象；直接创建新 run。 | 缺少 `goal`、未知参数、配置加载失败、planner/createGraph/store 失败。 | 追加 `run_started`、`memory_recalled`、`task_planned` 到 `events.jsonl`，同步投影到 blackboard，并写入 `run.json`、`graph.json`。 |
| `resume` | CLI: `resume <runId> [--config <path>]`。UI: `POST /api/runs/:runId/resume` | 必填 `runId`。可选 `configPath`。 | `RunRecord`。可能返回 `paused`、`waiting_approval`、`running`、`completed`、`failed`，终态 run 会原样返回。 | `run` | `completed`、`failed`、`cancelled` 直接短路返回；其余状态走恢复与继续执行。 | `run` 或 `graph` 不存在时抛错；执行阶段还可能透传配置、存储、适配器、验证错误。 | 检测到漂移时记录 `workspace_drift_detected`；继续执行时还会产生 `agent_selected`、`context_built`、`invocation_planned`、`task_queued`、`approval_requested`、`validation_*`、`run_finished` 等事件，统一写入 `events.jsonl` 并投影 blackboard。 |
| `inspect` | CLI: `inspect <runId>`。UI: `GET /api/runs/:runId/inspect` | 必填 `runId`。 | `RunInspection`。 | `run` | 仅要求 run 与 graph 完整存在。 | run 或 graph 缺失时抛错。 | 只读，不追加事件；从 `run.json`、`graph.json`、`events.jsonl`、approvals、artifacts、blackboard 聚合读模型。 |
| `approvals` | CLI: `approvals <runId>`。UI: `GET /api/runs/:runId/approvals`，另有全局 `GET /api/approvals` | 必填 `runId`；全局列表无需输入。 | CLI 返回 `ApprovalRequest[]`；UI scoped 返回审批队列视图；全局接口返回跨 run 汇总列表。 | 当前是 `run` 作用域下的 pending approval request 列表，单条审批实体仍是 `approvalRequest`。 | 只要求 run 存在；不会校验 run 必须处于 `waiting_approval`。 | scoped 命令在 run 不存在时抛错；全局接口会跳过读取失败或不完整 run。 | 只读，不追加事件；数据真源来自 `approvals.json`，页面视图经 inspection/queue projection 聚合。 |
| `approve` | CLI: `approve <runId> <requestId> [--actor <actor>] [--note <note>]`。UI: `POST /api/runs/:runId/approvals/:requestId/approve` | 必填 `runId`、`requestId`。可选 `actor`、`note`。 | `RunRecord`。若审批后任务继续执行，返回推进后的 run；可能直接收敛到 `completed` 或 `failed`。 | `approvalRequest` | 请求必须仍为 pending；关联 task 必须仍存在。代码未强制要求 run.status 一定等于 `waiting_approval`。 | run 不存在、request 不存在、request 不再 pending、关联 task 缺失时抛错。 | 记录 `approval_decided` 到 `events.jsonl` 与 blackboard；写入 approval decision artifact；同时追加 `artifact_created`。批准后继续触发任务执行事件，可能最终追加 `run_finished`。 |
| `reject` | CLI: `reject <runId> <requestId> [--actor <actor>] [--note <note>]`。UI: `POST /api/runs/:runId/approvals/:requestId/reject` | 与 `approve` 相同。 | `RunRecord`，通常收敛为 `failed`。 | `approvalRequest` | 与 `approve` 相同。 | 与 `approve` 相同。 | 记录 `approval_decided`、approval artifact、`artifact_created`；随后把任务置为 `blocked`，追加 `task_blocked`，最后追加 `run_finished(status=failed)`。 |
| `interact` | 当前不存在 CLI、coordinator、UI API 入口。 | 未来至少需要 `runId + threadId` 或 `sessionId` + `message` + `actor`，并允许 `replyToMessageId`/上下文键。 | 当前无输出定义；未来应返回消息确认或更新后的 thread/session 读模型。 | 目标应是 `thread` 或 `taskSession`，不应再落回 `run` 或模糊 `lane`。 | 当前无。 | 当前 CLI 会报 `Unsupported command`，UI API 会返回 `404 Route not found`。 | 当前无事件落点；后续至少要落到 run 级 `events.jsonl`，并新增 thread/message 真源存储。精确事件名留到任务5和任务7冻结。 |
| `requeue` | 当前不存在 CLI、coordinator、UI API 入口。 | 未来至少需要 `runId + taskId`，以及操作者和原因。 | 当前无输出定义；未来应返回新的 task/session 调度结果或更新后的 task 读模型。 | 目标应是 `task`，且语义应明确“创建新 `taskSession`”。 | 当前无。 | 当前 CLI 会报 `Unsupported command`，UI API 会返回 `404 Route not found`。 | 当前无显式事件落点；只能看到内部 replan 生成的 `replan_*` 事实，不能表达用户主动重派。后续必须补控制事件并落到 `events.jsonl`。 |
| `cancel` | 当前不存在 CLI、coordinator、UI API 入口。仅存在 `GraphPatchOperation.cancel_pending_tasks` 供重规划内部使用。 | 未来至少需要 `runId + taskId`，以及操作者和原因。 | 当前无输出定义；未来应返回 task 或 run 的最新状态。 | 目标应是 `task`，不是 `run`，也不是历史 `lane`。 | 当前无用户态门禁；内部 patch 只允许处理可修改的 pending 子图。 | 当前 CLI 会报 `Unsupported command`，UI API 会返回 `404 Route not found`。 | 当前没有独立 `task_cancelled` 控制事件；内部取消只体现在 graph/task 状态更新与 `replan_applied` 结果中。后续必须补显式 cancel 事件。 |
| `interrupt` | 当前不存在 CLI、coordinator、UI API 入口，但 `ExecutionRuntime.interrupt(runId, taskId)` 与 `ConfiguredCliAdapter.interrupt(runId, taskId)` 已有底层能力。 | 当前底层方法接受 `runId + taskId`；未来应改为 `runId + sessionId`。 | 当前无对外输出；底层方法为 `Promise<void>`。 | 当前隐藏对象其实是 `runId + taskId` 对应的活动执行槽位；目标应升级为 `taskSession`。 | 当前无 coordinator 门禁；底层若找不到活动执行则直接 no-op。 | 当前 CLI 会报 `Unsupported command`，UI API 会返回 `404 Route not found`；直接调用底层方法也不会返回领域态错误。 | 当前没有控制事件落点，也没有状态收敛规则；后续至少需要写入 run 级 `events.jsonl` 并把 session/task 状态变化显式化。 |

## 关键盘点结论

1. 当前真正对外可用的控制动作只有 `run`、`resume`、`approve`、`reject`，其余都是只读查询或尚未实现。
2. 当前外部控制对象只有 `run` 和 `approvalRequest` 两类，还没有 `task`、`taskSession`、`thread` 级显式动作入口。
3. `interrupt` 已经有 runtime/adapter 底层杀进程能力，但完全没有 coordinator 契约、CLI/API 入口、状态收敛与事件审计，因此仍然不能视为已实现控制动作。
4. `cancel` 只以内部 graph patch 的形式存在，不能表达“用户主动取消某个 task”。
5. `requeue`、`interact` 目前完全缺席，说明“多 CLI 会话协作”和“会话级桥接通信”还没有进入真实控制面。
6. 事件体系目前只有 `approval_decided` 能直接表达用户控制结果；其他新增动作都还没有对应的控制事实事件。
7. 所有事件仍然只携带 `taskId`，没有 `sessionId`、`threadId`，这会直接限制任务5、任务6、任务7中的桥接协议和事件扩展。

## 对后续任务的约束

### 对任务5

桥接协议必须补齐 `threadId` 与消息实体，否则 `interact` 不可能拥有稳定的输入输出与事件落点。

### 对任务7

事件体系必须从“执行事实”扩展到“控制事实”，至少覆盖用户主动 `cancel`、`interrupt`、`requeue`、`interact` 的审计落点。

### 对任务9

动作契约冻结时不能把 `interrupt` 视为“从零开始设计”，而应明确其当前已有底层执行能力、但缺少 coordinator/API/状态语义这一断层。
