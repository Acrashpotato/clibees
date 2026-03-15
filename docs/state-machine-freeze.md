# run、task、taskSession 状态机冻结

## 目标

冻结 `run`、`task`、`taskSession` 三层状态机，补齐状态转移表、非法转移约束、`task` 对多 `session` 的聚合规则、当前活动 `session` 选择规则和状态映射规则。

本文只覆盖任务 8 范围，不展开任务 9 的控制动作端点，也不展开任务 10 之后的 projection 拆分。

## 冻结结论

1. `run`、`task`、`taskSession` 必须拥有各自独立状态机，页面只能做固定映射，不能再把 `lane` 当成事实状态来源。
2. `run.status` 是面向整个运行闭环的聚合状态；`task.status` 是工作目标的调度与结果状态；`taskSession.status` 是单个 CLI 会话实例的绑定与执行状态。
3. `task` 与 `taskSession` 不是一一对应关系；一个 `task` 可以同时拥有多个并发 `taskSession`，因此 `task.status` 不得再偷换成“当前唯一执行器状态”。
4. `taskSession` 的终态与 `task` 的终态不同步锁死；同一 `task` 可以在某个 `session` 失败后，通过新 `session` 继续推进，直到 `task` 自身进入终态。
5. `resume` 只恢复 `run` 内既有可恢复 `taskSession`；`requeue` 总是创建新 `taskSession`。因此“恢复旧会话”和“为 task 再建一次执行实例”必须走不同状态路径。
6. `blocked` 对 `task` 是非终态阻塞态，不再冻结为永远不可移动的死态；解除阻塞后可以重新进入 `routing` 或 `queued`。`completed`、`failed_terminal`、`cancelled` 才是 `task` 终态。
7. `archived` 只属于 `taskSession` 可见性终态，不属于 `task` 或 `run` 状态值。

## 状态集合冻结

### `run`

`run` 状态集合冻结为：

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

说明：

1. `waiting_approval` 是 `run` 级可操作状态，表示当前运行的首要阻塞原因是审批，而不是普通暂停。
2. `paused` 表示运行被显式暂停，或当前只剩可恢复会话但没有活跃执行。
3. `completed`、`failed`、`cancelled` 是 `run` 终态。

### `task`

`task` 状态集合冻结为：

- `pending`
- `ready`
- `routing`
- `context_building`
- `queued`
- `running`
- `awaiting_approval`
- `validating`
- `blocked`
- `failed_retryable`
- `completed`
- `failed_terminal`
- `cancelled`

说明：

1. `routing`、`context_building`、`queued` 是调度态，不表达具体会话绑定。
2. `awaiting_approval` 是 `task` 聚合态，表示当前代表性执行路径被审批阻塞。
3. `failed_retryable` 不是终态，表示当前尝试失败但 `task` 仍允许继续执行。
4. `blocked` 不是终态，表示当前没有可继续推进的活跃执行路径，必须等待外部解除阻塞、重规划或重派。
5. `completed`、`failed_terminal`、`cancelled` 是 `task` 终态。

### `taskSession`

`taskSession` 状态集合冻结为：

- `provisioning`
- `launching`
- `attached`
- `waiting_approval`
- `waiting_message`
- `interrupted`
- `restorable`
- `completed`
- `failed`
- `cancelled`
- `archived`

说明：

1. `provisioning` 对应任务 3 中已冻结的 Provisioned 检查点。
2. `attached` 表示会话已真实绑定 CLI 进程、窗口或适配器原生句柄。
3. `waiting_approval` 与 `waiting_message` 都属于会话级阻塞态，但会保留原 `sessionId` 作为恢复目标。
4. `interrupted` 表示中断请求已生效，但是否可恢复尚未判定。
5. `restorable` 表示当前没有活跃进程，但存在有效恢复句柄。
6. `completed`、`failed`、`cancelled` 是执行终态；`archived` 是终态后的可见性整理态。

## `run` 状态转移冻结

| 当前状态 | 允许迁移到 |
| --- | --- |
| `created` | `planning`、`cancelled` |
| `planning` | `ready`、`failed`、`cancelled` |
| `ready` | `running`、`replanning`、`paused`、`cancelled` |
| `running` | `waiting_approval`、`replanning`、`paused`、`completed`、`failed`、`cancelled` |
| `waiting_approval` | `running`、`paused`、`failed`、`cancelled` |
| `replanning` | `ready`、`running`、`failed`、`cancelled` |
| `paused` | `ready`、`running`、`failed`、`cancelled` |
| `completed` | 无 |
| `failed` | 无 |
| `cancelled` | 无 |

非法转移约束：

1. `completed`、`failed`、`cancelled` 不得恢复到任何非终态。
2. `waiting_approval` 不得直接跳到 `completed`；必须先通过审批决定回到 `running`，再由后续事实完成收敛。
3. `paused` 不得直接跳到 `completed`；必须先重新进入 `ready` 或 `running`。
4. `replanning` 不得绕过 `ready` 或 `running` 直接进入 `waiting_approval`。

## `task` 状态转移冻结

| 当前状态 | 允许迁移到 |
| --- | --- |
| `pending` | `ready`、`cancelled` |
| `ready` | `routing`、`cancelled` |
| `routing` | `context_building`、`blocked`、`failed_terminal`、`cancelled` |
| `context_building` | `queued`、`awaiting_approval`、`blocked`、`failed_terminal`、`cancelled` |
| `queued` | `running`、`awaiting_approval`、`blocked`、`cancelled` |
| `running` | `awaiting_approval`、`validating`、`blocked`、`failed_retryable`、`failed_terminal`、`cancelled` |
| `awaiting_approval` | `queued`、`running`、`blocked`、`cancelled` |
| `validating` | `completed`、`failed_retryable`、`failed_terminal`、`blocked`、`cancelled` |
| `blocked` | `routing`、`queued`、`cancelled`、`failed_terminal` |
| `failed_retryable` | `routing`、`queued`、`cancelled`、`failed_terminal` |
| `completed` | 无 |
| `failed_terminal` | 无 |
| `cancelled` | 无 |

非法转移约束：

1. `completed`、`failed_terminal`、`cancelled` 是不可逆终态。
2. `failed_retryable` 不得直接跳到 `completed`；必须先重新进入 `routing` 或 `queued` 并形成新的执行或验证链路。
3. `blocked` 不得直接跳到 `completed` 或 `failed_retryable`；必须先恢复到可调度态。
4. `awaiting_approval` 不得直接跳到 `completed`；审批决定只能恢复执行或将其导向阻塞、取消。
5. `queued` 与 `running` 之间的往返不代表同一 `session` 必须重建；如果存在可恢复旧 `session`，可以由该 `session` 继续推进。

## `taskSession` 状态转移冻结

| 当前状态 | 允许迁移到 |
| --- | --- |
| `provisioning` | `launching`、`failed`、`cancelled` |
| `launching` | `attached`、`failed`、`cancelled` |
| `attached` | `waiting_approval`、`waiting_message`、`interrupted`、`completed`、`failed`、`cancelled` |
| `waiting_approval` | `attached`、`interrupted`、`failed`、`cancelled` |
| `waiting_message` | `attached`、`interrupted`、`failed`、`cancelled` |
| `interrupted` | `restorable`、`failed`、`cancelled` |
| `restorable` | `launching`、`failed`、`cancelled` |
| `completed` | `archived` |
| `failed` | `archived` |
| `cancelled` | `archived` |
| `archived` | 无 |

非法转移约束：

1. `completed`、`failed`、`cancelled` 不得重新回到 `launching`、`attached` 或 `restorable`；如需再次执行，只能新建 `taskSession`。
2. `archived` 只允许从会话终态进入，不能从 `attached`、`waiting_approval`、`waiting_message`、`restorable` 直接进入。
3. `interrupted` 只是中断结果确认态，不代表一定可恢复；只有显式拿到恢复句柄时才能进入 `restorable`。
4. `waiting_message` 不得直接映射为 `task.awaiting_approval`；它表示通信阻塞，不是审批阻塞。

## `task` 对多 `session` 的聚合规则

### 聚合总则

1. `task` 是 `taskSession` 的聚合根，但 `task.status` 不能简单等于某个 `session.status`。
2. 同一 `task` 可以同时存在多个非终态 `taskSession`；它们共同构成 `task` 的可执行路径集合。
3. `task` 的准源是 `task` 主记录加全部关联 `taskSession` 与事件链，不能只看 `latestSessionId` 或 `attempts`。

### 聚合归约

`task.status` 的归约规则冻结如下：

1. 若 `task` 自身尚未进入调度链，保持 `pending` 或 `ready`，此时不要求已有 `session`。
2. 若正在选 agent、组装上下文或形成执行计划，保持 `routing` 或 `context_building`；`session` 即使已 provision，也不能把 `task` 提前映射为 `running`。
3. 若存在至少一个代表性 `session` 处于 `waiting_approval`，则 `task.status = awaiting_approval`。
4. 若不存在审批阻塞，且存在至少一个 `session` 处于 `attached` 或 `waiting_message`，则 `task.status = running`。
5. 若当前执行事实已经结束，且正在执行验证链，则 `task.status = validating`。
6. 若所有活跃路径都已停止，且当前存在可继续尝试的执行路径但尚未重新派发，则进入 `failed_retryable` 或 `blocked`：
   - 有明确重试预算与可继续执行计划时用 `failed_retryable`
   - 需要人工解阻、补上下文、恢复会话或等待外部条件时用 `blocked`
7. 若至少一条执行路径完成且最终验证通过，且不存在更高优先级的非终态路径，则 `task.status = completed`。
8. 若已经确认无法继续推进，且失败不是通过 `requeue` 或 `resume` 可恢复的，则 `task.status = failed_terminal`。
9. 若用户显式取消 `task`，则 `task.status = cancelled`，并要求所有非终态 `session` 收敛为 `cancelled` 或后续归档。

## 当前活动 `session` 选择规则

### 活动集合

`task` 的活动 `session` 集合冻结为状态属于以下任一值的记录：

- `launching`
- `attached`
- `waiting_approval`
- `waiting_message`

`interrupted` 与 `restorable` 不属于活动集合，只属于可恢复候选集合。

### 代表性活动 `session`

当一个 `task` 同时存在多个活动 `session` 时，代表性活动 `session` 按以下优先级选择：

1. `waiting_approval`
2. `waiting_message`
3. `attached`
4. `launching`

同优先级下的排序规则：

1. `lastActiveAt` 较新者优先
2. 若无 `lastActiveAt`，则 `attachedAt` 较新者优先
3. 若仍相同，则 `createdAt` 较新者优先
4. 若仍相同，则按 `sessionId` 字典序稳定排序

### 可恢复候选 `session`

当活动集合为空时，可恢复候选 `session` 按以下优先级选择：

1. `restorable`
2. `interrupted`

这组选择结果只用于 `resume` 和 UI 引导，不代表 `task` 重新回到 `running`。

## 状态映射规则

### `taskSession` 到 `task`

| `taskSession` 代表状态 | `task` 映射约束 |
| --- | --- |
| `launching` | `task` 至少保持 `queued`，不得直接映射为 `completed` |
| `attached` | 若无审批阻塞，`task` 应为 `running` |
| `waiting_approval` | `task` 必须为 `awaiting_approval` |
| `waiting_message` | `task` 应为 `running`，并通过消息或阻塞摘要表达等待通信 |
| `interrupted` / `restorable` | `task` 不直接映射为新的终态；通常保留在 `blocked`、`queued` 或由 `run.paused` 体现 |
| `completed` | 仅表示该 `session` 成功结束，不足以单独推出 `task.completed`，还要看验证结果与其他并发 `session` |
| `failed` | 仅表示该 `session` 失败，不足以单独推出 `task.failed_terminal`，还要看重试预算和其他并发 `session` |
| `cancelled` | 仅表示该 `session` 被取消；`task` 是否取消由 `task` 级控制结果决定 |
| `archived` | 不参与活动态映射，只保留历史与审计可见性 |

### `task` 到 `run`

`run.status` 的归约优先级冻结如下：

1. 若 `run` 已进入终态，则保持 `completed`、`failed` 或 `cancelled`
2. 若存在任一 `task.status = awaiting_approval`，则 `run.status = waiting_approval`
3. 若 coordinator 正在应用图补丁或等待新的图补丁结果，则 `run.status = replanning`
4. 若存在任一 `task.status = running` 或 `validating`，或存在任一活动 `session`，则 `run.status = running`
5. 若不存在活动 `session`，且存在可恢复候选 `session` 或用户显式暂停，则 `run.status = paused`
6. 若存在可继续调度的 `task`，包括 `ready`、`routing`、`context_building`、`queued`、`failed_retryable`，则 `run.status = ready`
7. 若全部 `task` 已收敛为 `completed` 或 `cancelled`，则 `run.status = completed`
8. 若不存在可继续推进的 `task`，且至少一个 `task` 已 `failed_terminal` 或长期 `blocked`，则 `run.status = failed`

## 与当前仓库实现的直接约束

1. [`src/domain/models.ts`](../src/domain/models.ts) 后续必须补齐 `TaskSessionStatus`、`TaskSessionRecord` 与三层状态转移常量，不能继续只有 `run` / `task` 两层状态机。
2. [`src/storage/run-store.ts`](../src/storage/run-store.ts) 与 [`src/control/graph-manager.ts`](../src/control/graph-manager.ts) 后续必须把 `blocked` 视为可恢复阻塞态，而不是永久死态。
3. [`src/control/run-coordinator.ts`](../src/control/run-coordinator.ts) 后续必须基于 `taskSession` 集合做 `task` / `run` 状态归约，而不是继续用单 `task` 执行路径近似代替。
4. [`src/storage/event-store.ts`](../src/storage/event-store.ts) 和 [`src/control/inspection-aggregator.ts`](../src/control/inspection-aggregator.ts) 后续必须区分“会话终态”和“任务终态”，不能再把单次执行失败直接折叠成任务最终失败。
5. [`src/ui-read-models/build-views.ts`](../src/ui-read-models/build-views.ts) 与 [`apps/console/src/types.ts`](../apps/console/src/types.ts) 后续必须把 `paused`、`blocked`、`awaiting_approval` 的来源拆清到 `run` / `task` / `taskSession`，不能继续用单一 `lane` 状态承接三层语义。

## 对后续任务的直接约束

1. 任务 9 的动作契约必须严格遵守本状态机，不得让 `requeue` 复活旧 `sessionId`，也不得让 `interrupt` 直接操作 `task`。
2. 任务 10 到任务 17 的 projection 设计必须分别选择 `run`、`task`、`taskSession` 中哪一层作为主状态来源，不能再依赖混合 inspection 状态。
3. 任务 20 之后的后端重构必须让状态归约可测试，至少能验证多 `session` 竞争、审批阻塞、恢复旧会话和重派新会话这四类路径。
