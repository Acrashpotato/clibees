import type { RunRecord } from "../domain/models.js";
import type { AuditTimelineProjectionView } from "../ui-read-models/audit-timeline-models.js";
import type {
  ApprovalQueueProjectionView,
  ManagerChatProjectionView,
  SessionDetailProjectionView,
  TaskBoardProjectionView,
  TaskDetailProjectionView,
  WorkspaceProjectionView,
} from "../ui-read-models/models.js";
import type { RunListProjection } from "../ui-read-models/build-run-list-projection.js";
import type { SelectedCli } from "./selected-cli.js";

export type UiApiReadRouteId =
  | "run_list_projection"
  | "workspace_projection"
  | "task_board_projection"
  | "task_detail_projection"
  | "session_detail_projection"
  | "approval_queue_projection"
  | "audit_timeline_projection"
  | "manager_chat_projection";

export type UiApiActionRouteId =
  | "create_run"
  | "resume_run"
  | "delete_run"
  | "approve_request"
  | "reject_request"
  | "post_thread_message"
  | "interact_session"
  | "requeue_task"
  | "cancel_task"
  | "interrupt_session";

export type UiApiErrorCode =
  | "bad_request"
  | "not_found"
  | "state_conflict"
  | "not_supported"
  | "internal_error";

export type UiApiCursorMode = "opaque_offset";

export { SELECTED_CLI_VALUES } from "./selected-cli.js";
export type { SelectedCli } from "./selected-cli.js";

export interface UiApiErrorResponse {
  error: {
    code: UiApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface UiApiProjectionEnvelope<TProjection> {
  data: TProjection;
}

export interface UiApiPageInfo {
  limit: number;
  returnedCount: number;
  totalCount: number;
  cursorMode: UiApiCursorMode;
  nextCursor?: string;
}

export interface UiApiPaginatedProjectionEnvelope<TProjection>
  extends UiApiProjectionEnvelope<TProjection> {
  page: UiApiPageInfo;
}

export interface UiApiActionEnvelope<TResult> {
  action: UiApiActionRouteId;
  target: {
    type: "run" | "task" | "task_session" | "approval_request" | "thread";
    runId: string;
    targetId: string;
  };
  data: TResult;
}

export interface UiApiReadRouteDefinition {
  id: UiApiReadRouteId;
  method: "GET";
  path: string;
  pagination:
    | {
        mode: UiApiCursorMode;
        defaultLimit: number;
        maxLimit: number;
      }
    | null;
}

export interface UiApiActionRouteDefinition {
  id: UiApiActionRouteId;
  method: "POST";
  path: string;
  implementationStatus: "active" | "stubbed";
}

export interface CreateRunRequest {
  goal: string;
  cli: SelectedCli;
  allowOutsideWorkspaceWrites?: boolean;
  configPath?: string;
  autoResume?: boolean;
}

export interface ResumeRunRequest {
  configPath?: string;
  actorId?: string;
  clientRequestId?: string;
  note?: string;
  reasonCode?: string;
}

export interface ApprovalDecisionRequest {
  actorId: string;
  note?: string;
  clientRequestId?: string;
}

export interface ThreadMessageCreateRequest {
  actorId: string;
  body: string;
  clientRequestId: string;
  note?: string;
  replyToMessageId?: string;
}

export interface SessionInteractRequest {
  actorId: string;
  body: string;
  clientRequestId: string;
  note?: string;
  reasonCode?: string;
}

export interface TaskMutationRequest {
  actorId: string;
  clientRequestId?: string;
  note?: string;
  reasonCode?: string;
}

export interface SessionInterruptRequest extends TaskMutationRequest {}

export type UiApiProjectionDocument =
  | RunListProjection
  | WorkspaceProjectionView
  | TaskBoardProjectionView
  | TaskDetailProjectionView
  | SessionDetailProjectionView
  | ApprovalQueueProjectionView
  | AuditTimelineProjectionView
  | ManagerChatProjectionView;

export const UI_API_READ_ROUTES: UiApiReadRouteDefinition[] = [
  {
    id: "run_list_projection",
    method: "GET",
    path: "/api/projections/run-list",
    pagination: {
      mode: "opaque_offset",
      defaultLimit: 20,
      maxLimit: 100,
    },
  },
  {
    id: "workspace_projection",
    method: "GET",
    path: "/api/runs/:runId/projections/workspace",
    pagination: null,
  },
  {
    id: "task_board_projection",
    method: "GET",
    path: "/api/runs/:runId/projections/task-board",
    pagination: null,
  },
  {
    id: "task_detail_projection",
    method: "GET",
    path: "/api/runs/:runId/tasks/:taskId/projection",
    pagination: null,
  },
  {
    id: "session_detail_projection",
    method: "GET",
    path: "/api/runs/:runId/sessions/:sessionId/projection",
    pagination: null,
  },
  {
    id: "approval_queue_projection",
    method: "GET",
    path: "/api/projections/approval-queue",
    pagination: {
      mode: "opaque_offset",
      defaultLimit: 20,
      maxLimit: 100,
    },
  },
  {
    id: "audit_timeline_projection",
    method: "GET",
    path: "/api/runs/:runId/projections/audit-timeline",
    pagination: null,
  },
  {
    id: "manager_chat_projection",
    method: "GET",
    path: "/api/runs/:runId/projections/manager-chat",
    pagination: null,
  },
];

export const UI_API_ACTION_ROUTES: UiApiActionRouteDefinition[] = [
  {
    id: "create_run",
    method: "POST",
    path: "/api/runs",
    implementationStatus: "active",
  },
  {
    id: "resume_run",
    method: "POST",
    path: "/api/runs/:runId/resume",
    implementationStatus: "active",
  },
  {
    id: "delete_run",
    method: "POST",
    path: "/api/runs/:runId/delete",
    implementationStatus: "active",
  },
  {
    id: "approve_request",
    method: "POST",
    path: "/api/runs/:runId/approvals/:requestId/approve",
    implementationStatus: "active",
  },
  {
    id: "reject_request",
    method: "POST",
    path: "/api/runs/:runId/approvals/:requestId/reject",
    implementationStatus: "active",
  },
  {
    id: "post_thread_message",
    method: "POST",
    path: "/api/runs/:runId/threads/:threadId/messages",
    implementationStatus: "active",
  },
  {
    id: "interact_session",
    method: "POST",
    path: "/api/runs/:runId/sessions/:sessionId/interact",
    implementationStatus: "active",
  },
  {
    id: "requeue_task",
    method: "POST",
    path: "/api/runs/:runId/tasks/:taskId/requeue",
    implementationStatus: "stubbed",
  },
  {
    id: "cancel_task",
    method: "POST",
    path: "/api/runs/:runId/tasks/:taskId/cancel",
    implementationStatus: "stubbed",
  },
  {
    id: "interrupt_session",
    method: "POST",
    path: "/api/runs/:runId/sessions/:sessionId/interrupt",
    implementationStatus: "stubbed",
  },
];

export function buildProjectionEnvelope<TProjection>(
  projection: TProjection,
): UiApiProjectionEnvelope<TProjection> {
  return { data: projection };
}

export function parsePageLimit(
  rawLimit: string | null,
  fallback: number,
  maxLimit: number,
): number {
  if (!rawLimit) {
    return fallback;
  }

  const parsed = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid limit "${rawLimit}".`);
  }

  return Math.min(parsed, maxLimit);
}

export function encodeOpaqueCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

export function decodeOpaqueCursor(rawCursor: string | null): number {
  if (!rawCursor) {
    return 0;
  }

  try {
    const parsed = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")) as {
      offset?: unknown;
    };
    if (typeof parsed.offset !== "number" || !Number.isInteger(parsed.offset) || parsed.offset < 0) {
      throw new Error("Cursor offset must be a non-negative integer.");
    }
    return parsed.offset;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid cursor "${rawCursor}": ${message}`);
  }
}

export function paginateItems<T>(
  items: T[],
  rawCursor: string | null,
  rawLimit: string | null,
  defaults: {
    defaultLimit: number;
    maxLimit: number;
  },
): {
  items: T[];
  page: UiApiPageInfo;
} {
  const offset = decodeOpaqueCursor(rawCursor);
  const limit = parsePageLimit(rawLimit, defaults.defaultLimit, defaults.maxLimit);
  const pagedItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pagedItems.length;

  return {
    items: pagedItems,
    page: {
      limit,
      returnedCount: pagedItems.length,
      totalCount: items.length,
      cursorMode: "opaque_offset",
      ...(nextOffset < items.length ? { nextCursor: encodeOpaqueCursor(nextOffset) } : {}),
    },
  };
}

export function buildActionEnvelope<TResult>(
  action: UiApiActionRouteId,
  target: UiApiActionEnvelope<TResult>["target"],
  data: TResult,
): UiApiActionEnvelope<TResult> {
  return {
    action,
    target,
    data,
  };
}

export function buildNotSupportedResponse(
  message: string,
  details?: Record<string, unknown>,
): UiApiErrorResponse {
  return {
    error: {
      code: "not_supported",
      message,
      ...(details ? { details } : {}),
    },
  };
}

export type CreateRunResponse = UiApiActionEnvelope<RunRecord>;
export type ResumeRunResponse = UiApiActionEnvelope<RunRecord>;
export type ApprovalDecisionResponse = UiApiActionEnvelope<RunRecord>;


