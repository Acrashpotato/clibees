# taskSession 生命周期与持久化冻结
## 目标

冻结 `taskSession` 的生命周期边界，明确创建、恢复、重派新建、归档、失败、中断、完成的规则，并补齐持久化位置与 CLI 进程/窗口绑定字段。

本文只覆盖任务 3 范围，不展开任务 8 的完整状态机，也不展开任务 9 的动作契约。

## 冻结结论

1. `taskSession` 是一次具体执行实例，不是可复用资源槽位。
2. `taskSession` 只能在 `task` 首次分配执行，或显式 `requeue` 时创建。
3. 每次创建都必须生成新的 `sessionId`，不允许覆写旧会话。
4. `resume` 只能恢复已存在且仍可恢复的旧会话；不可恢复时必须显式失败，不能隐式新建。
5. `requeue` 总是创建新的 `taskSession`；旧会话保留为审计历史。
6. `interrupt` 只作用于当前活跃的既有会话，不负责补建新会话。
7. `completed`、`failed` 后的 `taskSession` 进入终态语义，不可再次被 `resume`；如需再次执行，只能 `requeue`。
8. `archived` 是终态后的可见性整理动作，不删除历史事实，不改变 `sessionId`、`taskId`、`runId` 归属。

## 生命周期检查点

### Provisioned

- 会话记录已创建，`sessionId`、`taskId`、`runId` 已固定。
- 会话目录与 transcript 路径已分配。
- 尚未绑定活跃 CLI 进程或窗口。

### Attached

- 已绑定活跃 CLI 进程、终端窗口或适配器原生会话句柄。
- 运行输出开始写入 `session` 级 transcript。
- 审批、artifact、消息、工具调用都必须以 `sessionId` 作为主归属键。

### Restorable

- 当前没有活跃进程，但仍保留有效恢复句柄，或适配器声明该会话可继续恢复。
- `resume` 只能作用于该类既有会话。
- 若适配器不支持恢复，则不会进入该检查点。

### Terminal

- 会话已经以完成、失败、显式中断失败或其他终止结果结束。
- transcript、退出信息、绑定快照都必须封存到会话记录中。
- 后续只允许审计、聚合展示、归档，不允许重新附着到同一 `sessionId`。

### Archived

- 仅作用于非活跃会话。
- 归档后的会话默认不再参与 Workspace 等活跃执行面板。
- Task Detail、Session Detail、Inspect、Approvals 等审计视图仍必须可追溯到归档会话。

## 规则冻结

### 创建

- 创建 `taskSession` 时必须同步落盘会话主记录。
- 创建时即固定 `runId`、`taskId`、`sessionId`。
- 可继承 `task` 级上下文和依赖结果，但不能继承旧会话的进程绑定。
- 同一 `task` 可以同时存在多个会话，不能继续靠 `TaskRecord.attempts` 充当真源。

### 恢复

- `resume` 的目标是“恢复既有会话”，不是“重新为 task 找一个执行器”。
- 恢复前必须检查会话仍属于原 `task` 与原 `run`，且存在活跃绑定或有效恢复句柄。
- 条件不成立时必须显式失败，不能退化为自动新建会话。
- 当前 [`src/adapters/configured-cli-adapter.ts`](../src/adapters/configured-cli-adapter.ts) 默认 `supportsResume: false`，因此默认 CLI 适配器应把中断后的会话视为不可恢复，除非后续显式补齐恢复能力。

### 重派

- `requeue` 永远创建新的 `taskSession`。
- 新会话可以复制旧会话的上下文引用，但不能复用旧会话的运行时绑定字段。
- 旧会话必须保留在 `task` 的历史执行列表中。

### 中断

- `interrupt` 只能针对当前活跃且已绑定的 `taskSession`。
- 中断必须记录请求时间、请求来源、中断原因和中断后的绑定结果。
- 中断不会隐式触发 `requeue`。
- 是否进入可恢复检查点取决于适配器恢复能力，具体状态名留待任务 8 冻结。

### 完成、失败、归档

- 完成或失败都必须封存最终 transcript 路径、退出码或等价结果。
- 完成与失败后的会话都不得重新附着为活跃执行会话。
- 归档不是删除，也不是迁移归属；归档后仍必须保留 transcript、事件、artifact、审批和消息链路可追溯性。

## 持久化位置冻结

结合当前 `.multi-agent/state/runs/<runId>/` 布局，`taskSession` 的目标持久化位置冻结如下：

```text
.multi-agent/state/
└── runs/<runId>/
    ├── run.json
    ├── graph.json
    ├── events.jsonl
    ├── approvals.json
    ├── tasks/
    │   └── <taskId>.json
    ├── sessions/
    │   ├── <sessionId>.json
    │   └── <sessionId>.transcript.jsonl
    ├── artifacts/
    ├── blackboard/
    └── workspace/
```

冻结约束如下：

1. `tasks/` 保留为 `task` 聚合记录目录，不再承担会话级 transcript 真源。
2. 新增 `sessions/` 作为 `taskSession` 真源目录。
3. transcript 真源从当前按 `taskId` 命名，冻结为未来按 `sessionId` 命名。
4. `events.jsonl`、`artifacts/`、`approvals` 后续凡涉及会话事实时都必须显式写入 `sessionId`。
5. 归档先通过 `archivedAt` 和可见性字段表达，不单独迁目录。

## 最小字段冻结

`taskSession` 主记录至少需要：

- `schemaVersion`
- `sessionId`
- `runId`
- `taskId`
- `status`
- `adapterId`
- `agentId`
- `profileId?`
- `workingDirectory`
- `createdAt`
- `attachedAt?`
- `startedAt?`
- `lastActiveAt?`
- `interruptedAt?`
- `finishedAt?`
- `archivedAt?`
- `archiveVisibility`
- `resumeCapability`
- `resumeHandle?`
- `latestTranscriptPath`
- `binding`

其中 `binding` 至少需要：

- `kind`
- `processId?`
- `windowId?`
- `terminalSessionId?`
- `startedCommand?`
- `startedArgs?`
- `cwd?`
- `attachedAt`
- `lastSeenAt?`
- `detachedAt?`
- `exitCode?`
- `signal?`
- `failureReason?`

## 与当前仓库实现的直接约束

1. [`src/storage/state-layout.ts`](../src/storage/state-layout.ts) 后续必须新增 `sessionsDir` 及 `session` 级路径辅助函数。
2. [`src/execution/execution-runtime.ts`](../src/execution/execution-runtime.ts) 当前把活跃执行和 transcript 绑定到 `runId + taskId`；后续必须改为 `runId + sessionId`。
3. [`src/adapters/configured-cli-adapter.ts`](../src/adapters/configured-cli-adapter.ts) 后续若要支持 `resume`，必须把恢复句柄和绑定快照写入 `taskSession` 记录。
4. [`src/domain/models.ts`](../src/domain/models.ts) 后续必须补齐独立 `TaskSessionRecord` 以及 `sessionId` 级关联字段。
5. 当前 `tasks/<taskId>.json` 中的 `attempts` 只能视为过渡期计数，不能继续作为多会话生命周期真源。

