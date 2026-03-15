# task 与 taskSession 关系冻结
## 目标

冻结 `task` 与 `taskSession` 的归属、聚合和查询关系，明确一个 `task` 可以对应多个并发或历史 `taskSession`，而每个 `taskSession` 只能归属于一个 `task` 和一个 `run`。本文只覆盖任务2范围，不展开任务3中的生命周期、任务8中的状态机，或任务9中的控制动作契约。

## 关系冻结结论

1. `run` 仍然是唯一顶层聚合根。
2. `task` 是工作目标与依赖节点，不再承担 CLI 会话实例语义。
3. `taskSession` 是 `task` 的执行实例，一个实例只服务于一个 `task`。
4. 一个 `task` 在其整个生命周期内可以拥有零个到多个 `taskSession`。
5. 一个 `task` 可以在同一时刻拥有多个活动中的 `taskSession`，以支持并发执行、重试对比、分工协作或备用接管。
6. 一个 `taskSession` 一旦创建，其 `taskId` 与 `runId` 不可变，不允许迁移到其他 `task` 或其他 `run`。
7. `approvalRequest`、`artifact`、后续 `toolCall` 与会话相关消息都必须以 `taskSession` 为主挂载实体，再向上聚合到 `task` 与 `run`。

## 聚合树

```text
run
└─ task
   └─ taskSession
```

补充约束：

- `run -> task` 是一对多。
- `task -> taskSession` 是一对多。
- `run -> taskSession` 是派生聚合关系，但 `taskSession` 仍需冗余持有 `runId` 以支持直接查询、审计和跨页面检索。

## 实体职责边界

### `task`

- 表示一个待完成的工作目标、依赖关系与任务级状态归纳。
- 负责聚合多个 `taskSession` 的结果，但不直接承载会话输出、审批、工具调用或终端绑定。
- 可以没有任何 `taskSession`。这表示任务尚未被分配、尚未开始执行，或仅存在规划结果。

### `taskSession`

- 表示某个 `task` 的一次具体执行实例，对应一个实际 CLI 会话、控制台窗口或等价的可恢复执行上下文。
- 必须直接记录 `sessionId`、`taskId`、`runId`。
- 是执行事实的主归属点。任何审批、产物、工具调用、验证记录、消息参与关系都必须能回链到唯一 `sessionId`。
- 不是可跨 `task` 复用的资源槽位，也不是抽象的 agent 容器。

## 关系规则

### 1. 归属规则

- 每个 `task` 只能属于一个 `run`。
- 每个 `taskSession` 只能属于一个 `task`。
- 每个 `taskSession` 只能属于一个 `run`。
- `taskSession.runId` 必须与其所属 `task.runId` 一致；不允许出现跨 `run` 挂接。

### 2. 多 session 规则

- 同一个 `task` 允许存在多个历史 `taskSession`。
- 同一个 `task` 允许存在多个并发中的 `taskSession`。
- 并发 `taskSession` 之间是同一任务目标下的多个执行实例，不是多个独立任务。
- `task` 是否需要选出“当前主会话”属于后续状态机与 projection 规则，本文只冻结“允许多会话并存”，不定义选择算法。

### 3. 不可迁移规则

- 已创建的 `taskSession` 不允许改挂到别的 `task`。
- 已创建的 `taskSession` 不允许改挂到别的 `run`。
- 若需要重新分配或重新发起执行，应创建新的 `taskSession`，而不是复用或重写旧 `sessionId` 的归属。

### 4. 溯源规则

- `task` 对 `taskSession` 的聚合必须可由 `taskSession.taskId` 反查得出，不能仅依赖 UI 层缓存列表。
- `run` 对 `taskSession` 的聚合必须可由 `taskSession.runId` 直接检索，不要求先经过 `task` 再间接推导。
- `task` 上如保留 `latestSessionId`、`activeSessionCount`、`sessionCount` 一类字段，只能视为派生缓存，准源仍是 `taskSession` 记录集合与事件流。

### 5. 删除与归档规则

- `taskSession` 即使结束、失败、中断或归档，仍保留在所属 `task` 的历史执行集合中。
- 不允许通过覆盖旧会话来“隐藏”历史。
- `task` 的审计视图必须能看到完整的历史 `taskSession` 列表。

## 最小字段冻结

### `task`

最少需要稳定持有：

- `taskId`
- `runId`
- `status`
- `dependsOn`
- `title` 或等价目标摘要

可以派生但不要求在任务2落库的字段：

- `sessionCount`
- `activeSessionCount`
- `latestSessionId`

### `taskSession`

最少需要稳定持有：

- `sessionId`
- `runId`
- `taskId`
- `status`
- `adapterId`
- `createdAt`
- `updatedAt`

将在任务3继续补齐但本任务先冻结为必需方向的字段：

- 终端或 CLI 进程绑定信息
- 恢复句柄
- 归档可见性标记

## 查询与投影约束

1. 任务详情页必须以 `taskId` 为入口，展示该任务下全部 `taskSession`。
2. 会话详情页必须以 `sessionId` 为入口，且能回链所属 `taskId` 与 `runId`。
3. Workspace 或任务板如果展示“活跃执行者”，展示对象应来自 `taskSession`，不能再把 `task` 或 `lane` 误当作执行实例。
4. Approvals、Artifacts、Timeline 如按任务聚合展示，必须先保留 `sessionId`，再按 `taskId` 汇总。
5. 任何 projection 若出现“当前任务只有一个会话”的假设，都只能作为暂时 UI 假设，不能进入冻结后的领域模型契约。

## 对当前仓库的直接约束

1. [`src/domain/models.ts`](../src/domain/models.ts) 中现有 `TaskRecord` 只有 `attempts` 计数，不足以表达冻结后的多 `taskSession` 关系；后续实现必须补上独立 `taskSession` 实体，而不是继续扩展 `attempts`。
2. [`src/ui-read-models/models.ts`](../src/ui-read-models/models.ts) 与 [`apps/console/src/types.ts`](../apps/console/src/types.ts) 中的 `LaneView`、`laneId` 只能视为兼容期命名，不能继续承载“一个 lane 等于一个执行实例”的模型假设。
3. [`src/control/inspection-aggregator.ts`](../src/control/inspection-aggregator.ts) 若继续输出聚合视图，必须允许一个任务映射多个会话，而不是把任务与执行实例压扁成一条 lane。

## 非范围项

以下内容明确不在任务2内落定：

- `taskSession` 的创建、恢复、重排队、归档和中断生命周期
- `run`、`task`、`taskSession` 三层状态机
- `resume`、`requeue`、`interrupt` 等控制动作的适用对象与前置条件
- `messageThread` 与 `sessionMessage` 的详细字段设计

这些内容分别留给任务3、任务8、任务9及后续通信任务处理。