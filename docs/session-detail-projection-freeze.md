# 会话详情 projection 冻结

## 目标

冻结 `sessionDetailProjection` 的结构与过渡期 `sessionId` 规则，使原 `LaneConsolePage` 后续能升级为真正的 session 详情页，而不是继续把 terminal preview 当成会话真源。

## 冻结结论

1. `sessionDetailProjection` 是会话详情页唯一主 projection，正式入口必须是 `sessionId`。
2. 在 `taskSession` 真源未落地前，允许按 `task_started` 事件窗口回填 session，并生成稳定兼容 id：`backfill:${encodeURIComponent(taskId)}:attempt:${n}`；没有 `task_started` 时退化为 `backfill:${encodeURIComponent(taskId)}:status`。
3. 会话详情必须拆开 `messages` 与 `terminalPreview`：消息流展示真实事件消息，terminal preview 只做片段预览。
4. 工具调用子视图长期应切到 `tool_call` 真源；当前过渡期优先用 `command_result` artifact，补不上再用 `invocation_planned` 事件回填。
5. 会话详情允许展示该 session 的审批、验证和 artifact，但不承担全局审批队列、task board 或 inspect 全量时间线职责。

## projection 结构

```ts
interface SessionDetailProjectionView {
  projection: "session_detail";
  generatedAt: string;
  runId: string;
  graphRevision: number;
  sessionId: string;
  overview: SessionDetailOverviewView;
  messages: SessionDetailMessageItemView[];
  toolCalls: SessionDetailToolCallItemView[];
  approvals: SessionDetailApprovalItemView[];
  validation: SessionDetailValidationSummaryView;
  artifacts: SessionDetailArtifactSummaryView;
  terminalPreview: SessionDetailTerminalPreviewView;
}
```

## 直接约束

1. `src/ui-read-models/models.ts` 必须新增 `session_detail` 类型。
2. `src/ui-read-models/build-session-detail-projection.ts` 必须作为会话详情 projection 的专用 builder。
3. `src/ui-read-models/build-task-detail-projection.ts` 中的 `sessions` 摘要必须带稳定兼容期 `sessionId`，以便后续从 task detail 跳转到 session detail。
4. `src/ui-read-models/projection-contracts.ts` 中 `session_detail` 的 primary sources 必须覆盖 `task_record`、`run_graph`、`approval_record`、`artifact_record`、`run_event`。

## 非目标

- 审批 `actionPlans` 明细
- inspect 页全量审计时间线
- 最终 REST 路径与分页策略
- console 页面与兼容路由重构
