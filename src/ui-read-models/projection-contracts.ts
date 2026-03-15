export type UiProjectionKey =
  | "run_list"
  | "workspace"
  | "task_board"
  | "task_detail"
  | "session_detail"
  | "approval_queue"
  | "audit_timeline";

export type UiProjectionPage =
  | "runs"
  | "workspace"
  | "task_board"
  | "task_detail"
  | "session_detail"
  | "approvals"
  | "inspect";

export type UiProjectionPrimaryEntity =
  | "run"
  | "task_graph"
  | "task"
  | "task_session"
  | "approval_request"
  | "audit_timeline";

export type UiProjectionSource =
  | "run_record"
  | "run_graph"
  | "task_record"
  | "task_session"
  | "approval_request"
  | "approval_record"
  | "run_event"
  | "artifact_record"
  | "validation_record"
  | "message_thread"
  | "session_message"
  | "legacy_run_inspection";

export type UiProjectionLifecycle = "planned" | "transitional" | "active";

export interface UiProjectionContract {
  key: UiProjectionKey;
  page: UiProjectionPage;
  primaryEntity: UiProjectionPrimaryEntity;
  lifecycle: UiProjectionLifecycle;
  primarySources: UiProjectionSource[];
  transitionalInputs: UiProjectionSource[];
  forbiddenResponsibilities: string[];
}

export const UI_PROJECTION_CONTRACTS: UiProjectionContract[] = [
  {
    key: "run_list",
    page: "runs",
    primaryEntity: "run",
    lifecycle: "transitional",
    primarySources: ["run_record", "run_graph", "task_session", "approval_request"],
    transitionalInputs: ["legacy_run_inspection"],
    forbiddenResponsibilities: [
      "task-level drilldown payloads",
      "session transcript details",
      "full audit timeline payloads",
    ],
  },
  {
    key: "workspace",
    page: "workspace",
    primaryEntity: "run",
    lifecycle: "transitional",
    primarySources: [
      "run_record",
      "run_graph",
      "task_record",
      "task_session",
      "approval_request",
      "validation_record",
      "message_thread",
      "session_message",
      "run_event",
    ],
    transitionalInputs: ["legacy_run_inspection"],
    forbiddenResponsibilities: [
      "full task board payloads",
      "full session transcript payloads",
      "inspect-only audit history",
    ],
  },
  {
    key: "task_board",
    page: "task_board",
    primaryEntity: "task_graph",
    lifecycle: "transitional",
    primarySources: [
      "run_graph",
      "task_record",
      "task_session",
      "approval_request",
      "validation_record",
      "run_event",
    ],
    transitionalInputs: ["legacy_run_inspection"],
    forbiddenResponsibilities: [
      "workspace focus state",
      "approval history details unrelated to the board",
      "full session transcript payloads",
    ],
  },
  {
    key: "task_detail",
    page: "task_detail",
    primaryEntity: "task",
    lifecycle: "transitional",
    primarySources: [
      "task_record",
      "run_graph",
      "task_session",
      "approval_request",
      "approval_record",
      "artifact_record",
      "validation_record",
      "run_event",
    ],
    transitionalInputs: ["legacy_run_inspection"],
    forbiddenResponsibilities: [
      "whole-run workspace summaries",
      "sibling task payloads outside task context",
      "full audit timeline payloads",
    ],
  },
  {
    key: "session_detail",
    page: "session_detail",
    primaryEntity: "task_session",
    lifecycle: "transitional",
    primarySources: [
      "task_record",
      "run_graph",
      "task_session",
      "message_thread",
      "session_message",
      "approval_request",
      "approval_record",
      "artifact_record",
      "validation_record",
      "run_event",
    ],
    transitionalInputs: ["legacy_run_inspection"],
    forbiddenResponsibilities: [
      "whole-run workspace summaries",
      "task board layout payloads",
      "approval queue aggregation unrelated to the session",
    ],
  },
  {
    key: "approval_queue",
    page: "approvals",
    primaryEntity: "approval_request",
    lifecycle: "transitional",
    primarySources: [
      "approval_request",
      "approval_record",
      "task_session",
      "task_record",
      "run_graph",
      "run_event",
      "artifact_record",
    ],
    transitionalInputs: ["legacy_run_inspection"],
    forbiddenResponsibilities: [
      "workspace focus selection",
      "terminal transcript payloads",
      "full audit replay payloads",
    ],
  },
  {
    key: "audit_timeline",
    page: "inspect",
    primaryEntity: "audit_timeline",
    lifecycle: "transitional",
    primarySources: ["run_event", "artifact_record", "validation_record", "approval_record"],
    transitionalInputs: ["legacy_run_inspection"],
    forbiddenResponsibilities: [
      "workspace control state",
      "run list summary cards",
      "task board layout payloads",
    ],
  },
];

export type UiConsistencyEntity =
  | "task"
  | "task_session"
  | "approval_request"
  | "artifact_record"
  | "validation_record"
  | "timeline_entry"
  | "session_message";

export interface UiProjectionConsistencyContract {
  entity: UiConsistencyEntity;
  identityKeys: string[];
  canonicalSources: UiProjectionSource[];
  traceabilityKeys: string[];
  requiredProjections: UiProjectionKey[];
  transitionalBackfills: string[];
  invariants: string[];
}

export const UI_PROJECTION_CONSISTENCY_CONTRACTS: UiProjectionConsistencyContract[] = [
  {
    entity: "task",
    identityKeys: ["runId", "taskId"],
    canonicalSources: ["task_record", "run_graph", "run_event"],
    traceabilityKeys: ["taskId", "runId", "graphRevision", "eventId"],
    requiredProjections: ["workspace", "task_board", "task_detail", "audit_timeline"],
    transitionalBackfills: [
      "allow latestActivity and statusReason to reuse run_event summaries during migration",
      "do not synthesize task identity from laneId or page-local ordering",
    ],
    invariants: [
      "task status is canonically owned by task_record and state-machine rules",
      "dependency shape must come from run_graph rather than page-local DAG reconstruction",
      "all page-level task summaries must map back to the same runId/taskId pair",
    ],
  },
  {
    entity: "task_session",
    identityKeys: ["runId", "sessionId"],
    canonicalSources: ["task_session", "run_event", "session_message", "artifact_record"],
    traceabilityKeys: ["sessionId", "taskId", "threadId", "eventId", "artifactId"],
    requiredProjections: ["workspace", "task_board", "task_detail", "session_detail", "audit_timeline"],
    transitionalBackfills: [
      "allow backfill sessionId derived from task_started windows until task_session records exist",
      "status backfill from task status must be marked with an explicit sourceMode field",
    ],
    invariants: [
      "resume and interrupt target the original session identity instead of creating a replacement session",
      "requeue creates a new session identity and must not overwrite historical session references",
      "approvals, artifacts, validations, and messages shown for a session must retain the same sessionId across projections",
    ],
  },
  {
    entity: "approval_request",
    identityKeys: ["runId", "requestId"],
    canonicalSources: ["approval_request", "approval_record", "artifact_record", "run_event"],
    traceabilityKeys: ["requestId", "sessionId", "taskId", "actionPlanId", "eventId"],
    requiredProjections: ["workspace", "task_detail", "session_detail", "approval_queue", "audit_timeline"],
    transitionalBackfills: [
      "allow session binding to reuse run_event backfill when approval_request does not yet persist sessionId",
      "actionPlans may be hydrated from approval artifacts during migration, but only as immutable snapshots",
    ],
    invariants: [
      "approval state is canonically owned by the approval request plus decision record, not by page-local badges",
      "the same requestId must expose the same riskLevel, decision state, actor, note, and actionPlan snapshot in every projection",
      "page-specific summaries may differ in wording, but not in decision facts or linked session/task identity",
    ],
  },
  {
    entity: "artifact_record",
    identityKeys: ["runId", "artifactId"],
    canonicalSources: ["artifact_record", "run_event"],
    traceabilityKeys: ["artifactId", "taskId", "sessionId", "eventId"],
    requiredProjections: ["task_detail", "session_detail", "approval_queue", "audit_timeline"],
    transitionalBackfills: [
      "artifact summaries may reuse inspect-era labels while storage metadata is being normalized",
    ],
    invariants: [
      "artifact identity, kind, uri, and createdAt must stay stable across all projections",
      "artifact ownership must resolve to the same taskId/sessionId binding wherever it is displayed",
    ],
  },
  {
    entity: "validation_record",
    identityKeys: ["runId", "taskId", "validationKey"],
    canonicalSources: ["validation_record", "run_event", "task_record"],
    traceabilityKeys: ["taskId", "sessionId", "eventId", "validationKey"],
    requiredProjections: ["workspace", "task_board", "task_detail", "session_detail", "audit_timeline"],
    transitionalBackfills: [
      "allow task status derived validation fallback when dedicated validation records are absent",
    ],
    invariants: [
      "validation outcome must not disagree across workspace risk summaries, task detail, session detail, and inspect views",
      "fallback summaries must clearly mark sourceMode instead of masquerading as recorded validation facts",
    ],
  },
  {
    entity: "timeline_entry",
    identityKeys: ["runId", "eventId"],
    canonicalSources: ["run_event", "approval_record", "validation_record", "artifact_record"],
    traceabilityKeys: ["eventId", "taskId", "sessionId", "threadId", "approvalRequestId", "artifactId"],
    requiredProjections: ["workspace", "task_board", "task_detail", "session_detail", "approval_queue", "audit_timeline"],
    transitionalBackfills: [
      "allow inspect compatibility text to be reused while event titles and summaries are normalized",
    ],
    invariants: [
      "timeline ordering must be derived from event timestamps instead of per-page sort heuristics",
      "the same eventId must always resolve to the same linked task, session, approval, thread, and artifact references",
      "audit_timeline is the only page allowed to show the full timeline; other pages may only surface scoped excerpts",
    ],
  },
  {
    entity: "session_message",
    identityKeys: ["runId", "threadId", "messageId"],
    canonicalSources: ["session_message", "message_thread", "run_event"],
    traceabilityKeys: ["messageId", "threadId", "sessionId", "replyToMessageId", "eventId"],
    requiredProjections: ["workspace", "session_detail", "audit_timeline"],
    transitionalBackfills: [
      "allow message previews to be reconstructed from run_event agent_message entries before session_message storage lands",
    ],
    invariants: [
      "message identity and reply chain must remain stable across workspace summaries, session detail, and inspect entries",
      "recipient resolution must come from thread/message addressing fields rather than page-specific lane labels",
    ],
  },
];

export interface LegacyRunInspectionContract {
  aggregate: "RunInspection";
  lifecycle: "transitional";
  allowedConsumers: UiProjectionKey[];
  replacementOrder: UiProjectionKey[];
  forbiddenChanges: string[];
}

export const LEGACY_RUN_INSPECTION_CONTRACT: LegacyRunInspectionContract = {
  aggregate: "RunInspection",
  lifecycle: "transitional",
  allowedConsumers: [
    "run_list",
    "workspace",
    "task_board",
    "task_detail",
    "session_detail",
    "approval_queue",
    "audit_timeline",
  ],
  replacementOrder: [
    "run_list",
    "workspace",
    "task_board",
    "task_detail",
    "session_detail",
    "approval_queue",
    "audit_timeline",
  ],
  forbiddenChanges: [
    "do not treat RunInspection as the permanent page contract for any page",
    "do not add lane-specific fields as new canonical data",
    "do not hide taskSession or thread models behind RunInspection-only ad hoc payloads",
  ],
};

export function getUiProjectionContract(key: UiProjectionKey): UiProjectionContract {
  const contract = UI_PROJECTION_CONTRACTS.find((candidate) => candidate.key === key);
  if (!contract) {
    throw new Error(`Unknown UI projection contract: ${key}`);
  }
  return contract;
}

export function getUiProjectionConsistencyContract(
  entity: UiConsistencyEntity,
): UiProjectionConsistencyContract {
  const contract = UI_PROJECTION_CONSISTENCY_CONTRACTS.find(
    (candidate) => candidate.entity === entity,
  );
  if (!contract) {
    throw new Error(`Unknown UI consistency contract: ${entity}`);
  }
  return contract;
}
