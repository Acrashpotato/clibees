import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { createApp } from "../app/create-app.js";
import { createDefaultConfig } from "../config/default-config.js";
import type { RunInspection, RunRecord } from "../domain/models.js";
import { createStateLayout, getRunStatePaths } from "../storage/state-layout.js";
import { FileArtifactStore } from "../storage/artifact-store.js";
import { createId, pathExists, readJsonFile } from "../shared/runtime.js";
import { buildApprovalQueue, buildWorkspaceView } from "../ui-read-models/build-views.js";
import {
  SELECTED_CLI_VALUES,
  buildActionEnvelope,
  buildNotSupportedResponse,
  buildProjectionEnvelope,
  paginateItems,
} from "./contracts.js";
import { TerminalGateway } from "./terminal-gateway.js";
import { buildRunListProjection } from "../ui-read-models/build-run-list-projection.js";
import { buildWorkspaceProjection } from "../ui-read-models/build-workspace-projection.js";
import { buildTaskBoardProjection } from "../ui-read-models/build-task-board-projection.js";
import { buildTaskDetailProjection } from "../ui-read-models/build-task-detail-projection.js";
import { buildSessionDetailProjection } from "../ui-read-models/build-session-detail-projection.js";
import { buildApprovalQueueProjection } from "../ui-read-models/build-approval-queue-projection.js";
import { buildAuditTimelineProjection } from "../ui-read-models/build-audit-timeline-projection.js";
import { buildManagerChatProjection } from "../ui-read-models/build-manager-chat-projection.js";
import { buildWorkerpollProjection } from "../ui-read-models/build-workerpoll-projection.js";

export interface UiApiServerOptions {
  host?: string;
  port?: number;
  stateRootDir?: string;
  buildRootDir?: string;
}

interface JsonRequestBody {
  goal?: string;
  cli?: string;
  configPath?: string;
  allowOutsideWorkspaceWrites?: boolean;
  actor?: string;
  actorId?: string;
  note?: string;
  autoResume?: boolean;
  clientRequestId?: string;
  reasonCode?: string;
  body?: string;
  replyToMessageId?: string;
  cols?: number;
  rows?: number;
  launchCli?: boolean;
  launchCodex?: boolean;
}

export function createUiApiServer(options: UiApiServerOptions = {}) {
  const app = createApp(options.stateRootDir ? { stateRootDir: options.stateRootDir } : {});
  const terminalGateway = new TerminalGateway(app.dependencies.runStore);
  const serverStartedAtMs = Date.now();
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(
        app,
        options,
        terminalGateway,
        serverStartedAtMs,
        request,
        response,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendApiError(response, 500, "internal_error", message);
    }
  });
  terminalGateway.attach(server);

  return {
    server,
    listen: () =>
      new Promise<void>((resolve) => {
        server.listen(options.port ?? 4318, options.host ?? "127.0.0.1", () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        terminalGateway.close();
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
  terminalGateway: TerminalGateway,
  serverStartedAtMs: number,
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

  if (
    await rejectIfBuildIsStale(
      response,
      options,
      request.method,
      path,
      serverStartedAtMs,
    )
  ) {
    return;
  }

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
    const goal = body?.goal?.trim();
    if (!goal) {
      sendApiError(response, 400, "bad_request", 'Field "goal" is required.');
      return;
    }

    const cli = body?.cli?.trim();
    if (!cli) {
      sendApiError(
        response,
        400,
        "bad_request",
        "Field \"cli\" is required. Allowed values: " + SELECTED_CLI_VALUES.join(", ") + ".",
      );
      return;
    }

    if (!isSelectedCli(cli)) {
      sendApiError(
        response,
        400,
        "bad_request",
        "Field \"cli\" must be one of: " + SELECTED_CLI_VALUES.join(", ") + ".",
      );
      return;
    }

    const requestedAllowOutsideWorkspaceWrites = body?.allowOutsideWorkspaceWrites;
    if (
      requestedAllowOutsideWorkspaceWrites !== undefined &&
      typeof requestedAllowOutsideWorkspaceWrites !== "boolean"
    ) {
      sendApiError(
        response,
        400,
        "bad_request",
        "Field \"allowOutsideWorkspaceWrites\" must be a boolean when provided.",
      );
      return;
    }

    const config = await app.dependencies.configLoader.load(body?.configPath);
    const effectiveAllowOutsideWorkspaceWrites =
      typeof requestedAllowOutsideWorkspaceWrites === "boolean"
        ? requestedAllowOutsideWorkspaceWrites
        : config.workspace.allowOutsideWorkspaceWrites;
    const createdRun = await app.runCoordinator.startRun({
      goal,
      workspacePath: config.workspace.rootDir,
      configPath: body?.configPath,
      metadata: {
        configVersion: config.version,
        plannerMode: config.planner.mode,
        plannerAgentId: config.planner.agentId,
        agentIds: config.agents.map((agent) => agent.id),
        // Persist the run-bound CLI; resume must trust this source only.
        selectedCli: cli,
        allowOutsideWorkspaceWrites: effectiveAllowOutsideWorkspaceWrites,
      },
    });
    const run = body?.autoResume
      // resumeRun must resolve CLI from persisted RunRecord.metadata.selectedCli.
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
    const messages = await app.dependencies.sessionStore.listRunMessages(runId);
    sendJson(
      response,
      200,
      buildProjectionEnvelope(
        buildWorkspaceProjection(inspection, {
          threadMessages: messages,
        }),
      ),
    );
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
    const session = await app.dependencies.sessionStore.getSession(runId, sessionId);
    const sessionMessages = session
      ? await app.dependencies.sessionStore.listMessages(runId, session.threadId)
      : [];
    sendJson(
      response,
      200,
      buildProjectionEnvelope(
        buildSessionDetailProjection(inspection, sessionId, {
          sessionMessages,
        }),
      ),
    );
    return;
  }

  const artifactContentMatch = path.match(/^\/api\/runs\/([^/]+)\/artifacts\/([^/]+)\/content$/);
  if (request.method === "GET" && artifactContentMatch) {
    const runId = decodeURIComponent(artifactContentMatch[1]!);
    const artifactId = decodeURIComponent(artifactContentMatch[2]!);
    try {
      const payload = await readArtifactContentPreview(app, options, runId, artifactId);
      sendJson(response, 200, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("was not found")) {
        sendApiError(response, 404, "not_found", message);
        return;
      }
      if (message.includes("outside the workspace root")) {
        sendApiError(response, 400, "bad_request", message);
        return;
      }
      throw error;
    }
    return;
  }

  const sessionTerminalMatch = path.match(/^\/api\/runs\/([^/]+)\/sessions\/([^/]+)\/terminal$/);
  if (request.method === "POST" && sessionTerminalMatch) {
    const runId = decodeURIComponent(sessionTerminalMatch[1]!);
    const sessionId = decodeURIComponent(sessionTerminalMatch[2]!);
    const terminal = await terminalGateway.createSession({
      runId,
      sessionId,
      cols: typeof body?.cols === "number" ? body.cols : undefined,
      rows: typeof body?.rows === "number" ? body.rows : undefined,
      launchCli: (body?.launchCli ?? body?.launchCodex) !== false,
    });
    sendJson(response, 201, terminal);
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

  const managerChatProjectionMatch = path.match(/^\/api\/runs\/([^/]+)\/projections\/manager-chat$/);
  if (request.method === "GET" && managerChatProjectionMatch) {
    const runId = decodeURIComponent(managerChatProjectionMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    const [sessions, threads, messages] = await Promise.all([
      app.dependencies.sessionStore.listSessions(runId),
      app.dependencies.sessionStore.listThreads(runId),
      app.dependencies.sessionStore.listRunMessages(runId),
    ]);
    sendJson(
      response,
      200,
      buildProjectionEnvelope(
        buildManagerChatProjection(inspection, {
          sessions,
          threads,
          messages,
        }),
      ),
    );
    return;
  }

  const workerpollProjectionMatch = path.match(/^\/api\/runs\/([^/]+)\/projections\/workerpoll$/);
  if (request.method === "GET" && workerpollProjectionMatch) {
    const runId = decodeURIComponent(workerpollProjectionMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    let configuredAgents = createDefaultConfig(inspection.run.workspacePath).agents;
    try {
      const loadedConfig = await app.dependencies.configLoader.load(inspection.run.configPath);
      configuredAgents = loadedConfig.agents;
    } catch {
      // Fall back to defaults if config loading is unavailable for this run.
    }
    sendJson(
      response,
      200,
      buildProjectionEnvelope(
        buildWorkerpollProjection(inspection, {
          configuredAgents,
        }),
      ),
    );
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

  const deleteRunActionMatch = path.match(/^\/api\/runs\/([^/]+)\/delete$/);
  const deleteRunResourceMatch = path.match(/^\/api\/runs\/([^/]+)$/);
  const deleteRunId =
    request.method === "POST" && deleteRunActionMatch
      ? decodeURIComponent(deleteRunActionMatch[1]!)
      : request.method === "DELETE" && deleteRunResourceMatch
        ? decodeURIComponent(deleteRunResourceMatch[1]!)
        : undefined;
  if (deleteRunId) {
    try {
      await deleteRunState(options.stateRootDir, deleteRunId);
      sendJson(response, 200, { runId: deleteRunId, deleted: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("was not found")) {
        sendApiError(response, 404, "not_found", message);
        return;
      }
      throw error;
    }
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
    const bodyText = body?.body?.trim();
    if (!bodyText) {
      sendApiError(response, 400, "bad_request", 'Field "body" is required.');
      return;
    }

    try {
      const result = await app.runCoordinator.postThreadMessage(runId, threadId, {
        actorId: body?.actorId?.trim() || body?.actor?.trim() || "console-user",
        body: bodyText,
        clientRequestId: body?.clientRequestId?.trim() || createId("request"),
        note: body?.note?.trim(),
        replyToMessageId: body?.replyToMessageId?.trim(),
      });
      sendJson(
        response,
        200,
        buildActionEnvelope(
          "post_thread_message",
          {
            type: "thread",
            runId,
            targetId: threadId,
          },
          {
            runId,
            threadId,
            message: result.message,
            runStatus: result.run.status,
            resumed: result.resumed,
          },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("was not found") ||
        message.includes("Thread") ||
        message.includes("Session")
      ) {
        sendApiError(response, 404, "not_found", message);
        return;
      }
      if (message.includes("cannot accept new messages")) {
        sendApiError(response, 409, "state_conflict", message);
        return;
      }
      throw error;
    }
    return;
  }

  const sessionInteractMatch = path.match(/^\/api\/runs\/([^/]+)\/sessions\/([^/]+)\/interact$/);
  if (request.method === "POST" && sessionInteractMatch) {
    const runId = decodeURIComponent(sessionInteractMatch[1]!);
    const sessionId = decodeURIComponent(sessionInteractMatch[2]!);
    const bodyText = body?.body?.trim();
    if (!bodyText) {
      sendApiError(response, 400, "bad_request", 'Field "body" is required.');
      return;
    }

    try {
      const result = await app.runCoordinator.interactSession(runId, sessionId, {
        actorId: body?.actorId?.trim() || body?.actor?.trim() || "console-user",
        body: bodyText,
        clientRequestId: body?.clientRequestId?.trim() || createId("request"),
        note: body?.note?.trim(),
        replyToMessageId: body?.replyToMessageId?.trim(),
      });
      sendJson(
        response,
        200,
        buildActionEnvelope(
          "interact_session",
          {
            type: "task_session",
            runId,
            targetId: sessionId,
          },
          {
            runId,
            sessionId,
            threadId: result.thread.threadId,
            message: result.message,
            runStatus: result.run.status,
            resumed: result.resumed,
          },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("was not found") ||
        message.includes("Thread") ||
        message.includes("Session")
      ) {
        sendApiError(response, 404, "not_found", message);
        return;
      }
      if (message.includes("cannot accept new messages")) {
        sendApiError(response, 409, "state_conflict", message);
        return;
      }
      throw error;
    }
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

async function deleteRunState(stateRootDir: string | undefined, runId: string): Promise<void> {
  const layout = createStateLayout(stateRootDir);
  const paths = getRunStatePaths(layout, runId);
  if (!(await pathExists(paths.runDir))) {
    throw new Error(`Run "${runId}" was not found.`);
  }

  await rm(paths.runDir, {
    recursive: true,
    force: false,
    maxRetries: 3,
    retryDelay: 100,
  });
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

async function rejectIfBuildIsStale(
  response: ServerResponse,
  options: UiApiServerOptions,
  method: string,
  pathName: string,
  serverStartedAtMs: number,
): Promise<boolean> {
  if (!shouldEnforceFreshBuildForRequest(method, pathName)) {
    return false;
  }

  const buildRootDir = path.resolve(options.buildRootDir ?? "dist");
  if (!(await pathExists(buildRootDir))) {
    return false;
  }

  const latestBuildMtimeMs = await findLatestModifiedTime(buildRootDir);
  if (latestBuildMtimeMs <= serverStartedAtMs) {
    return false;
  }

  sendApiError(
    response,
    409,
    "state_conflict",
    "Build output changed after the UI API process started. Restart the UI API server to load the latest dist files before creating, resuming, or coordinating runs.",
  );
  return true;
}

function shouldEnforceFreshBuildForRequest(
  method: string,
  pathName: string,
): boolean {
  if (method !== "POST") {
    return false;
  }

  return (
    pathName === "/api/runs" ||
    /^\/api\/runs\/[^/]+\/resume$/.test(pathName) ||
    /^\/api\/runs\/[^/]+\/approvals\/[^/]+\/(approve|reject)$/.test(pathName) ||
    /^\/api\/runs\/[^/]+\/threads\/[^/]+\/messages$/.test(pathName) ||
    /^\/api\/runs\/[^/]+\/sessions\/[^/]+\/interact$/.test(pathName)
  );
}

async function findLatestModifiedTime(rootDir: string): Promise<number> {
  let latestMtimeMs = 0;
  const pendingDirectories = [rootDir];

  while (pendingDirectories.length > 0) {
    const directoryPath = pendingDirectories.pop();
    if (!directoryPath) {
      continue;
    }

    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      const entryStat = await stat(absolutePath);
      latestMtimeMs = Math.max(latestMtimeMs, entryStat.mtimeMs);
      if (entry.isDirectory()) {
        pendingDirectories.push(absolutePath);
      }
    }
  }

  return latestMtimeMs;
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
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

function isSelectedCli(value: string): value is (typeof SELECTED_CLI_VALUES)[number] {
  return (SELECTED_CLI_VALUES as readonly string[]).includes(value);
}

const MAX_PREVIEW_BYTES = 64_000;
const MAX_PREVIEW_CHARS = 16_000;

async function readArtifactContentPreview(
  app: ReturnType<typeof createApp>,
  options: UiApiServerOptions,
  runId: string,
  artifactId: string,
): Promise<{
  artifactId: string;
  kind: string;
  uri: string;
  summary: string;
  source: "workspace_file" | "artifact_metadata";
  contentType: "text/plain" | "application/json";
  body: string;
  truncated: boolean;
  filePath?: string;
}> {
  const run = await app.dependencies.runStore.getRun(runId);
  if (!run) {
    throw new Error(`Run "${runId}" was not found.`);
  }

  const artifactStore = new FileArtifactStore(options.stateRootDir);
  const artifact = (await artifactStore.list(runId)).find((item) => item.id === artifactId);
  if (!artifact) {
    throw new Error(`Artifact "${artifactId}" was not found in run "${runId}".`);
  }

  if (artifact.uri.startsWith("workspace://")) {
    const preview = await readWorkspaceFilePreview(run.workspacePath, artifact.uri);
    return {
      artifactId: artifact.id,
      kind: artifact.kind,
      uri: artifact.uri,
      summary: artifact.summary,
      source: "workspace_file",
      contentType: "text/plain",
      body: preview.body,
      truncated: preview.truncated,
      filePath: preview.filePath,
    };
  }

  const metadataBody = JSON.stringify(artifact.metadata, null, 2);
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    uri: artifact.uri,
    summary: artifact.summary,
    source: "artifact_metadata",
    contentType: "application/json",
    body: metadataBody.length > 0 ? metadataBody : "{}",
    truncated: false,
  };
}

async function readWorkspaceFilePreview(
  workspacePath: string,
  artifactUri: string,
): Promise<{ filePath: string; body: string; truncated: boolean }> {
  const normalizedWorkspacePath = path.resolve(workspacePath);
  const rawPath = artifactUri.slice("workspace://".length).replace(/\\/g, "/");
  const relativePath = rawPath.replace(/^\/+/, "");
  const absolutePath = path.resolve(normalizedWorkspacePath, relativePath);
  const traversal = path.relative(normalizedWorkspacePath, absolutePath);
  if (traversal.startsWith("..") || path.isAbsolute(traversal)) {
    throw new Error(`Artifact path "${relativePath}" is outside the workspace root.`);
  }

  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      filePath: relativePath,
      body: `[Artifact preview unavailable] File cannot be read: ${message}`,
      truncated: false,
    };
  }
  if (!fileStat.isFile()) {
    return {
      filePath: relativePath,
      body: "[Artifact preview unavailable] Target is not a regular file.",
      truncated: false,
    };
  }

  let raw: Buffer;
  try {
    raw = await readFile(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      filePath: relativePath,
      body: `[Artifact preview unavailable] File cannot be read: ${message}`,
      truncated: false,
    };
  }
  if (raw.includes(0)) {
    return {
      filePath: relativePath,
      body: `[Artifact preview unavailable] Binary file (${fileStat.size} bytes).`,
      truncated: false,
    };
  }

  const clipped = raw.byteLength > MAX_PREVIEW_BYTES ? raw.subarray(0, MAX_PREVIEW_BYTES) : raw;
  let body = clipped.toString("utf8");
  let truncated = raw.byteLength > MAX_PREVIEW_BYTES;
  if (body.length > MAX_PREVIEW_CHARS) {
    body = body.slice(0, MAX_PREVIEW_CHARS);
    truncated = true;
  }
  if (truncated) {
    body += "\n\n[Preview truncated]";
  }

  return {
    filePath: relativePath,
    body,
    truncated,
  };
}
