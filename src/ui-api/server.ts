import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir } from "node:fs/promises";
import { URL } from "node:url";
import { createApp } from "../app/create-app.js";
import type { RunInspection, RunRecord } from "../domain/models.js";
import { createStateLayout, getRunStatePaths } from "../storage/state-layout.js";
import { pathExists, readJsonFile } from "../shared/runtime.js";
import { buildApprovalQueue, buildWorkspaceView } from "../ui-read-models/build-views.js";
import {
  buildActionEnvelope,
  buildNotSupportedResponse,
  buildProjectionEnvelope,
  paginateItems,
} from "./contracts.js";
import { buildRunListProjection } from "../ui-read-models/build-run-list-projection.js";
import { buildWorkspaceProjection } from "../ui-read-models/build-workspace-projection.js";
import { buildTaskBoardProjection } from "../ui-read-models/build-task-board-projection.js";
import { buildTaskDetailProjection } from "../ui-read-models/build-task-detail-projection.js";
import { buildSessionDetailProjection } from "../ui-read-models/build-session-detail-projection.js";
import { buildApprovalQueueProjection } from "../ui-read-models/build-approval-queue-projection.js";
import { buildAuditTimelineProjection } from "../ui-read-models/build-audit-timeline-projection.js";

export interface UiApiServerOptions {
  host?: string;
  port?: number;
  stateRootDir?: string;
}

interface JsonRequestBody {
  goal?: string;
  configPath?: string;
  actor?: string;
  actorId?: string;
  note?: string;
  autoResume?: boolean;
  clientRequestId?: string;
  reasonCode?: string;
  body?: string;
  replyToMessageId?: string;
}

export function createUiApiServer(options: UiApiServerOptions = {}) {
  const app = createApp(options.stateRootDir ? { stateRootDir: options.stateRootDir } : {});
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(app, options, request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendApiError(response, 500, "internal_error", message);
    }
  });

  return {
    server,
    listen: () =>
      new Promise<void>((resolve) => {
        server.listen(options.port ?? 4318, options.host ?? "127.0.0.1", () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    getAddress: () => server.address(),
  };
}

async function handleRequest(
  app: ReturnType<typeof createApp>,
  options: UiApiServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  setCorsHeaders(response);
  if (!request.url || !request.method) {
    sendApiError(response, 400, "bad_request", "Missing request url.");
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url, "http://127.0.0.1");
  const path = url.pathname;
  const body = request.method === "POST" ? await readJsonBody(request) : undefined;

  if (request.method === "GET" && path === "/api/runs") {
    const inspections = await loadCompleteInspections(app, options.stateRootDir);
    sendJson(response, 200, buildRunListProjection(inspections).runs);
    return;
  }

  if (request.method === "GET" && path === "/api/projections/run-list") {
    const inspections = await loadCompleteInspections(app, options.stateRootDir);
    const projection = buildRunListProjection(inspections);
    const filteredRuns = filterRunList(projection.runs, url);
    const paged = paginateItems(filteredRuns, url.searchParams.get("cursor"), url.searchParams.get("limit"), {
      defaultLimit: 20,
      maxLimit: 100,
    });
    sendJson(response, 200, {
      ...buildProjectionEnvelope({
        ...projection,
        runs: paged.items,
      }),
      page: paged.page,
    });
    return;
  }

  if (request.method === "GET" && path === "/api/approvals") {
    const inspections = await loadCompleteInspections(app, options.stateRootDir);
    sendJson(
      response,
      200,
      inspections.flatMap((inspection) => buildApprovalQueue(inspection)),
    );
    return;
  }

  if (request.method === "GET" && path === "/api/projections/approval-queue") {
    const inspections = await loadCompleteInspections(app, options.stateRootDir);
    const projection = buildApprovalQueueProjection(inspections);
    const filtered = filterApprovalProjectionItems(projection.items, url);
    const paged = paginateItems(filtered, url.searchParams.get("cursor"), url.searchParams.get("limit"), {
      defaultLimit: 20,
      maxLimit: 100,
    });
    sendJson(response, 200, {
      ...buildProjectionEnvelope({
        ...projection,
        summary: buildApprovalQueueSummary(filtered),
        items: paged.items,
      }),
      page: paged.page,
    });
    return;
  }

  if (request.method === "POST" && path === "/api/runs") {
    if (!body?.goal || body.goal.trim().length === 0) {
      sendApiError(response, 400, "bad_request", 'Field "goal" is required.');
      return;
    }

    const config = await app.dependencies.configLoader.load(body.configPath);
    const createdRun = await app.runCoordinator.startRun({
      goal: body.goal.trim(),
      workspacePath: config.workspace.rootDir,
      configPath: body.configPath,
      metadata: {
        configVersion: config.version,
      },
    });
    const run = body.autoResume
      ? await app.runCoordinator.resumeRun(createdRun.runId, { config })
      : createdRun;

    sendJson(response, 201, run);
    return;
  }

  const runWorkspaceMatch = path.match(/^\/api\/runs\/([^/]+)\/workspace$/);
  if (request.method === "GET" && runWorkspaceMatch) {
    const runId = decodeURIComponent(runWorkspaceMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, buildWorkspaceView(inspection));
    return;
  }

  const workspaceProjectionMatch = path.match(/^\/api\/runs\/([^/]+)\/projections\/workspace$/);
  if (request.method === "GET" && workspaceProjectionMatch) {
    const runId = decodeURIComponent(workspaceProjectionMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, buildProjectionEnvelope(buildWorkspaceProjection(inspection)));
    return;
  }

  const taskBoardProjectionMatch = path.match(/^\/api\/runs\/([^/]+)\/projections\/task-board$/);
  if (request.method === "GET" && taskBoardProjectionMatch) {
    const runId = decodeURIComponent(taskBoardProjectionMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, buildProjectionEnvelope(buildTaskBoardProjection(inspection)));
    return;
  }

  const taskDetailProjectionMatch = path.match(/^\/api\/runs\/([^/]+)\/tasks\/([^/]+)\/projection$/);
  if (request.method === "GET" && taskDetailProjectionMatch) {
    const runId = decodeURIComponent(taskDetailProjectionMatch[1]!);
    const taskId = decodeURIComponent(taskDetailProjectionMatch[2]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, buildProjectionEnvelope(buildTaskDetailProjection(inspection, taskId)));
    return;
  }

  const sessionDetailProjectionMatch = path.match(/^\/api\/runs\/([^/]+)\/sessions\/([^/]+)\/projection$/);
  if (request.method === "GET" && sessionDetailProjectionMatch) {
    const runId = decodeURIComponent(sessionDetailProjectionMatch[1]!);
    const sessionId = decodeURIComponent(sessionDetailProjectionMatch[2]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, buildProjectionEnvelope(buildSessionDetailProjection(inspection, sessionId)));
    return;
  }

  const runApprovalQueueProjectionMatch = path.match(/^\/api\/runs\/([^/]+)\/projections\/approval-queue$/);
  if (request.method === "GET" && runApprovalQueueProjectionMatch) {
    const runId = decodeURIComponent(runApprovalQueueProjectionMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    const projection = buildApprovalQueueProjection([inspection]);
    const filtered = filterApprovalProjectionItems(projection.items, url);
    const paged = paginateItems(filtered, url.searchParams.get("cursor"), url.searchParams.get("limit"), {
      defaultLimit: 20,
      maxLimit: 100,
    });
    sendJson(response, 200, {
      ...buildProjectionEnvelope({
        ...projection,
        summary: buildApprovalQueueSummary(filtered),
        items: paged.items,
      }),
      page: paged.page,
    });
    return;
  }

  const auditTimelineProjectionMatch = path.match(/^\/api\/runs\/([^/]+)\/projections\/audit-timeline$/);
  if (request.method === "GET" && auditTimelineProjectionMatch) {
    const runId = decodeURIComponent(auditTimelineProjectionMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, buildProjectionEnvelope(buildAuditTimelineProjection(inspection)));
    return;
  }

  const runInspectMatch = path.match(/^\/api\/runs\/([^/]+)\/inspect$/);
  if (request.method === "GET" && runInspectMatch) {
    const runId = decodeURIComponent(runInspectMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, inspection);
    return;
  }

  const runApprovalsMatch = path.match(/^\/api\/runs\/([^/]+)\/approvals$/);
  if (request.method === "GET" && runApprovalsMatch) {
    const runId = decodeURIComponent(runApprovalsMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, buildApprovalQueue(inspection));
    return;
  }

  const resumeMatch = path.match(/^\/api\/runs\/([^/]+)\/resume$/);
  if (request.method === "POST" && resumeMatch) {
    const runId = decodeURIComponent(resumeMatch[1]!);
    const config = body?.configPath
      ? await app.dependencies.configLoader.load(body.configPath)
      : undefined;
    const run = await app.runCoordinator.resumeRun(runId, config ? { config } : {});
    sendJson(response, 200, run);
    return;
  }

  const approvalDecisionMatch = path.match(
    /^\/api\/runs\/([^/]+)\/approvals\/([^/]+)\/(approve|reject)$/,
  );
  if (request.method === "POST" && approvalDecisionMatch) {
    const runId = decodeURIComponent(approvalDecisionMatch[1]!);
    const requestId = decodeURIComponent(approvalDecisionMatch[2]!);
    const decision = approvalDecisionMatch[3] === "approve" ? "approved" : "rejected";
    const config = body?.configPath
      ? await app.dependencies.configLoader.load(body.configPath)
      : undefined;
    const run = await app.runCoordinator.decideApproval(
      runId,
      requestId,
      decision,
      body?.actorId?.trim() || body?.actor?.trim() || "console-user",
      body?.note?.trim() || undefined,
      config ? { config } : {},
    );
    sendJson(response, 200, run);
    return;
  }

  const threadMessageMatch = path.match(/^\/api\/runs\/([^/]+)\/threads\/([^/]+)\/messages$/);
  if (request.method === "POST" && threadMessageMatch) {
    const runId = decodeURIComponent(threadMessageMatch[1]!);
    const threadId = decodeURIComponent(threadMessageMatch[2]!);
    sendJson(response, 501, buildNotSupportedResponse(
      "Thread message posting is blocked until messageThread and sessionMessage persistence land.",
      {
        runId,
        threadId,
        missingEntities: ["messageThread", "sessionMessage"],
      },
    ));
    return;
  }

  const sessionInteractMatch = path.match(/^\/api\/runs\/([^/]+)\/sessions\/([^/]+)\/interact$/);
  if (request.method === "POST" && sessionInteractMatch) {
    const runId = decodeURIComponent(sessionInteractMatch[1]!);
    const sessionId = decodeURIComponent(sessionInteractMatch[2]!);
    sendJson(response, 501, buildNotSupportedResponse(
      "Session interaction is blocked until taskSession and session_primary thread persistence land.",
      {
        runId,
        sessionId,
        missingEntities: ["taskSession", "messageThread", "sessionMessage"],
      },
    ));
    return;
  }

  const taskMutationMatch = path.match(/^\/api\/runs\/([^/]+)\/tasks\/([^/]+)\/(requeue|cancel)$/);
  if (request.method === "POST" && taskMutationMatch) {
    const runId = decodeURIComponent(taskMutationMatch[1]!);
    const taskId = decodeURIComponent(taskMutationMatch[2]!);
    const action = taskMutationMatch[3]!;
    sendJson(response, 501, buildNotSupportedResponse(
      `Task action \"${action}\" is blocked until taskSession persistence and action coordinators land.`,
      {
        runId,
        taskId,
        action,
        missingEntities: ["taskSession"],
      },
    ));
    return;
  }

  const sessionInterruptMatch = path.match(/^\/api\/runs\/([^/]+)\/sessions\/([^/]+)\/interrupt$/);
  if (request.method === "POST" && sessionInterruptMatch) {
    const runId = decodeURIComponent(sessionInterruptMatch[1]!);
    const sessionId = decodeURIComponent(sessionInterruptMatch[2]!);
    sendJson(response, 501, buildNotSupportedResponse(
      "Session interruption is blocked until persisted taskSession binding replaces the current taskId-level runtime hook.",
      {
        runId,
        sessionId,
        missingEntities: ["taskSession"],
      },
    ));
    return;
  }

  sendApiError(response, 404, "not_found", `Route not found: ${request.method} ${path}`);
}

async function loadCompleteInspections(
  app: ReturnType<typeof createApp>,
  stateRootDir?: string,
): Promise<RunInspection[]> {
  const runs = await listCompleteRuns(stateRootDir);
  const inspections: RunInspection[] = [];

  for (const run of runs) {
    try {
      inspections.push(await app.runCoordinator.inspectRun(run.runId));
    } catch {
      continue;
    }
  }

  return inspections.sort((left, right) => right.run.updatedAt.localeCompare(left.run.updatedAt));
}

async function listCompleteRuns(stateRootDir?: string): Promise<RunRecord[]> {
  const layout = createStateLayout(stateRootDir);
  if (!(await pathExists(layout.runsDir))) {
    return [];
  }

  const runIds = (await readdir(layout.runsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const runs: RunRecord[] = [];

  for (const runId of runIds) {
    const paths = getRunStatePaths(layout, runId);
    if (!(await pathExists(paths.runFile)) || !(await pathExists(paths.graphFile))) {
      continue;
    }

    try {
      runs.push(await readJsonFile<RunRecord>(paths.runFile));
    } catch {
      continue;
    }
  }

  return runs;
}

function filterRunList(
  runs: ReturnType<typeof buildRunListProjection>["runs"],
  url: URL,
): ReturnType<typeof buildRunListProjection>["runs"] {
  const status = url.searchParams.get("status");
  if (!status) {
    return runs;
  }
  return runs.filter((run) => run.status === status);
}

function filterApprovalProjectionItems(
  items: ReturnType<typeof buildApprovalQueueProjection>["items"],
  url: URL,
): ReturnType<typeof buildApprovalQueueProjection>["items"] {
  const state = url.searchParams.get("state");
  const riskLevel = url.searchParams.get("riskLevel");

  return items.filter((item) => {
    if (state && item.state !== state) {
      return false;
    }
    if (riskLevel && item.riskLevel !== riskLevel) {
      return false;
    }
    return true;
  });
}

function buildApprovalQueueSummary(
  items: ReturnType<typeof buildApprovalQueueProjection>["items"],
): ReturnType<typeof buildApprovalQueueProjection>["summary"] {
  return {
    totalCount: items.length,
    pendingCount: items.filter((item) => item.state === "pending").length,
    approvedCount: items.filter((item) => item.state === "approved").length,
    rejectedCount: items.filter((item) => item.state === "rejected").length,
    highRiskCount: items.filter((item) => item.riskLevel === "high").length,
    mediumRiskCount: items.filter((item) => item.riskLevel === "medium").length,
    lowRiskCount: items.filter((item) => item.riskLevel === "low").length,
  };
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendApiError(
  response: ServerResponse,
  statusCode: number,
  code: "bad_request" | "not_found" | "state_conflict" | "not_supported" | "internal_error",
  message: string,
  details?: Record<string, unknown>,
): void {
  sendJson(response, statusCode, {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

async function readJsonBody(request: IncomingMessage): Promise<JsonRequestBody | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return undefined;
  }

  return JSON.parse(raw) as JsonRequestBody;
}
