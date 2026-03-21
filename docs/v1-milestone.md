# V1 里程碑

## 背景与目标

V1 的目标是把当前仓库从以 `lane` 为中心的过渡性 UI/聚合实现，收敛为面向 `run`、`task`、`taskSession` 的可视化 CLI 任务编排系统基础版本，为后续 V2 的继续开发提供稳定的模型边界、控制契约、projection 体系和 console 入口。

本里程碑文档用于替代根目录旧的任务拆解与逐任务成果文件，保留 V1 的已完成范围、关键产物、验证结果和进入 V2 前的交接结论。

## V1 完成范围

### 1. 核心模型与状态契约

- 完成 `run`、`task`、`taskSession`、`approvalRequest`、`artifact`、`messageThread`、`sessionMessage` 等核心实体边界冻结。
- 明确 `task` 与 `taskSession` 的一对多关系，固定“恢复原会话”和“重派新建会话”的语义边界。
- 冻结三层状态机与聚合归约规则，明确 `taskSession` 的活动态、终态、可恢复态和归档态。
- 统一控制动作对象粒度：`resume -> run`、`approve/reject -> approvalRequest`、`interact -> thread/taskSession`、`requeue/cancel -> task`、`interrupt -> taskSession`。

对应任务：1-9

关键文档：
- `docs/core-entity-freeze.md`
- `docs/task-session-relationship-freeze.md`
- `docs/task-session-lifecycle-freeze.md`
- `docs/bridge-protocol-freeze.md`
- `docs/communication-addressing-freeze.md`
- `docs/run-event-system-freeze.md`
- `docs/state-machine-freeze.md`
- `docs/control-entrypoint-inventory.md`
- `docs/control-action-contract-freeze.md`

### 2. Projection、UI API 与一致性设计

- 拆分 `RunInspection`，冻结 Runs、Workspace、Task Board、Task Detail、Session Detail、Approvals、Inspect 七类 projection。
- 为各页面定义独立 projection 契约、字段来源、兼容期 backfill 规则和边界职责。
- 冻结 UI API 的读模型 REST 接口与显式动作端点，不再依赖模糊命令分发。
- 明确多页面的一致性规则，要求状态、审批、artifact、timeline、message 能追溯到同一源事实。

对应任务：10-19

关键文档：
- `docs/projection-split-freeze.md`
- `docs/run-list-projection-freeze.md`
- `docs/workspace-projection-freeze.md`
- `docs/task-board-projection-freeze.md`
- `docs/task-detail-projection-freeze.md`
- `docs/session-detail-projection-freeze.md`
- `docs/approval-queue-projection-freeze.md`
- `docs/audit-timeline-projection-freeze.md`
- `docs/ui-api-freeze.md`
- `docs/projection-consistency-freeze.md`

### 3. 后端 projection 与 console 页面落地

- 后端已补齐专用 projection builder、projection contracts、UI API contracts 和相应测试入口。
- console 端类型系统开始从 `lane` 语义迁移到 task/session/approval/timeline 语义。
- Workspace、Task Board、Task Detail、Session Detail、Approvals、Inspect 页面已按真实 projection 重构。
- 原 `LaneConsolePage` 已降级为兼容入口，真实详情页改为 task/session 路由。

对应任务：20-26

关键代码产物：
- `src/ui-read-models/build-*.ts`
- `src/ui-read-models/projection-contracts.ts`
- `src/ui-api/contracts.ts`
- `src/ui-api/server.ts`
- `apps/console/src/pages/TaskDetailPage.vue`
- `apps/console/src/pages/SessionDetailPage.vue`
- `apps/console/src/pages/ApprovalsPage.vue`
- `apps/console/src/pages/InspectPage.vue`

### 4. 回归验证与桥接链路收口

- 补齐 projection contract 测试、approval/audit projection 测试和跨 projection 一致性回归。
- 增加桥接会话单链路场景，验证会话启动、消息流、工具调用、artifact、验证结果的完整链路。
- 文档已集中说明桥接协议、页面职责、兼容路由策略和调试入口，作为 V1 封板资料。

对应任务：27-28

关键测试与文档：
- `src/ui-read-models/projection-consistency-regression.test.ts`
- `src/ui-read-models/projection-contracts.test.ts`
- `src/ui-api/contracts.test.ts`
- `src/ui-api/server.test.ts`
- `docs/bridge-protocol-freeze.md`

## 里程碑清单

1. 完成从 `lane` 过渡模型到 `task` / `taskSession` 目标模型的命名和职责冻结。
2. 完成桥接通信、寻址、事件关联键和控制动作契约的统一定义。
3. 完成七类页面 projection 拆分，明确每个页面只依赖唯一主 projection。
4. 完成 UI API 资源路径与显式动作端点冻结，为 CLI/console 对齐打下基础。
5. 完成后端 projection 构建链路与 console 主要页面重构，替换旧的 summary-only 或 lane-centric 页面。
6. 完成多 projection 一致性回归和桥接链路回归，形成 V1 封板测试基础。

## 关键产出

### 设计冻结

- `docs/` 下已形成一组 V1 冻结文档，覆盖实体、状态机、事件、桥接协议、projection、UI API 和一致性规则。
- 这些文档继续保留，作为 V2 开发时的基线约束，而不再通过根目录任务文件维护。

### 实现落地

- 后端已引入专用 projection builder 和 contracts，避免继续由单一 inspection 聚合对象承担所有页面职责。
- console 已具备 Runs、Workspace、Task Board、Task Detail、Session Detail、Approvals、Inspect 的目标页面骨架与主要投影消费逻辑。
- 审批页面已从 summary-only 视图升级为审批对象视图，支持展示 `actionPlans` 快照明细、task/session 归属和决策信息。
- 旧 `lane` 路由仍保留兼容入口，但已经不再作为真实运行实体。

### 验证结果

- V1 任务总表中的 28 项任务已全部完成。
- 任务推进过程中已多次执行根仓 `npm run check`、根仓 `npm test` 和 `apps/console` 下的 `npm run build` 作为阶段验证。
- 最终回归覆盖已纳入 projection 合同、一致性链路和桥接会话链路。

## V1.2 优化收口（2026-03-18）

### 优化目标

- 在不改变核心行为的前提下，完成 v1.2 的代码优化、抽象、解耦与聚合收口。
- 将核心代码文件控制在 500 行以内，并形成自动化门禁，避免后续回归。
- 清理仓库中的无关测试数据和临时交付产物，保留可追溯的测试与文档资产。

### 已完成范围

1. 运行编排内核解耦
- `src/control/run-coordinator.ts` 从单体文件重构为模块化目录（`core.ts` + `helpers/` + `methods/`），按生命周期、执行、校验、持久化、委派规划/执行分层。
- 通过 `register-methods.ts` 完成方法聚合注册，保持对外接口不变，降低内部耦合和维护成本。

2. 领域模型与配置解析抽象
- `src/domain/models.ts` 拆分为 `status/graph/run-core/session/execution/inspection` 多文件导出。
- `src/config/file-config-loader.ts` 抽离 YAML 解析和值读取工具到 `src/config/file-config-loader/`，减少主加载器复杂度。

3. UI API 与读模型聚合链路收口
- UI API 请求处理从 `server.ts` 拆出 `request-handler.ts`、`request-handler-run-routes.ts`、`request-handler-interactions.ts`，路由职责更清晰。
- 读模型构建过程抽离辅助模块（task/workspace/audit/projection regression helpers），降低单文件复杂度并增强测试可读性。

4. Console 层拆分
- `apps/console/src/i18n.ts` 拆分语言消息定义到 `i18n/messages-*.ts`。
- `RunsPage` 控制逻辑下沉到 `pages/runs/useRunsPageController.ts`。
- 历史遗留 scoped 样式被拆分为多段文件并保留统一入口，便于迁移期按模块维护。

5. 测试与仓库清理
- 测试辅助逻辑抽离到 `phase7/9/10` 和 delegated manager 对应 helper 文件，回归用例结构更清晰。
- 清理无关临时测试数据与交付草稿（`test02/`、`test03/` 及根目录临时文本），并补充 `.multi-agent/*.json` 忽略规则，避免运行临时文件污染变更集。

6. 行数门禁
- 新增 `tools/check-max-lines.mjs`，扫描 `src/` 与 `apps/console/src/` 代码文件并强制 `<= 500` 行。
- `package.json` 的 `npm run check` 已接入 `npm run check:max-lines`，形成默认质量门禁。

### 验证记录（2026-03-18）

- 根仓类型检查：`npm run check` 通过（含 max-lines 门禁）。
- 根仓回归测试：`npm test` 全量通过。
- Console 构建验证：`cd apps/console && npm run build` 通过。
- 代码文件行数约束：`src/` 与 `apps/console/src/` 无超过 500 行文件。

## 进入 V2 前的交接说明

- V2 应以本文件和 `docs/*-freeze.md` 为基线，不再恢复根目录旧任务文档体系。
- 当前仓库仍存在兼容期实现，例如部分 `taskSession`、`messageThread`、`sessionMessage` 仍带有 backfill 或过渡映射，这些应作为 V2 优先收敛对象，而不是继续扩大兼容层。
- 旧成果文件中部分早期记录存在编码异常，已不再作为正式维护载体；本里程碑文档仅保留已确认的事实性结论。
- 新的 V2 任务拆解建议独立建档，避免与 V1 的设计冻结和封板记录混写。
