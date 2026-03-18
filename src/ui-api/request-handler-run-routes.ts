import type { IncomingMessage, ServerResponse } from "node:http";
import type { URL } from "node:url";
import type { createApp } from "../app/create-app.js";
import { createDefaultConfig } from "../config/default-config.js";
import { buildApprovalQueue, buildWorkspaceView } from "../ui-read-models/build-views.js";
import { buildWorkspaceProjection } from "../ui-read-models/build-workspace-projection.js";
import { buildTaskBoardProjection } from "../ui-read-models/build-task-board-projection.js";
import { buildTaskDetailProjection } from "../ui-read-models/build-task-detail-projection.js";
import { buildSessionDetailProjection } from "../ui-read-models/build-session-detail-projection.js";
import { buildApprovalQueueProjection } from "../ui-read-models/build-approval-queue-projection.js";
import { buildAuditTimelineProjection } from "../ui-read-models/build-audit-timeline-projection.js";
import { buildManagerChatProjection } from "../ui-read-models/build-manager-chat-projection.js";
import { buildWorkerpollProjection } from "../ui-read-models/build-workerpoll-projection.js";
import {
  buildNotSupportedResponse,
  buildProjectionEnvelope,
  paginateItems,
} from "./contracts.js";
import type { JsonRequestBody, UiApiServerOptions } from "./server.js";
import { TerminalGateway } from "./terminal-gateway.js";
import type { RequestRouteHelpers } from "./request-handler.js";

interface RunRouteContext {
  app: ReturnType<typeof createApp>;
  options: UiApiServerOptions;
  terminalGateway: TerminalGateway;
  request: IncomingMessage;
  response: ServerResponse;
  path: string;
  url: URL;
  body: JsonRequestBody | undefined;
  helpers: Pick<
    RequestRouteHelpers,
    | "filterApprovalProjectionItems"
    | "buildApprovalQueueSummary"
    | "deleteRunState"
    | "readArtifactContentPreview"
    | "sendJson"
    | "sendApiError"
  >;
}

export async function tryHandleRunRoutes(context: RunRouteContext): Promise<boolean> {
  const { app, options, terminalGateway, request, response, path, url, body, helpers } = context;
  const {
    filterApprovalProjectionItems,
    buildApprovalQueueSummary,
    deleteRunState,
    readArtifactContentPreview,
    sendJson,
    sendApiError,
  } = helpers;

  const runWorkspaceMatch = path.match(/^\/api\/runs\/([^/]+)\/workspace$/);
  if (request.method === "GET" && runWorkspaceMatch) {
    const runId = decodeURIComponent(runWorkspaceMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, buildWorkspaceView(inspection));
    return true;
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
    return true;
  }

  const taskBoardProjectionMatch = path.match(/^\/api\/runs\/([^/]+)\/projections\/task-board$/);
  if (request.method === "GET" && taskBoardProjectionMatch) {
    const runId = decodeURIComponent(taskBoardProjectionMatch[1]!);
    const [inspection, sessions] = await Promise.all([
      app.runCoordinator.inspectRun(runId),
      app.dependencies.sessionStore.listSessions(runId),
    ]);
    sendJson(
      response,
      200,
      buildProjectionEnvelope(
        buildTaskBoardProjection(inspection, {
          sessions,
        }),
      ),
    );
    return true;
  }

  const taskDetailProjectionMatch = path.match(/^\/api\/runs\/([^/]+)\/tasks\/([^/]+)\/projection$/);
  if (request.method === "GET" && taskDetailProjectionMatch) {
    const runId = decodeURIComponent(taskDetailProjectionMatch[1]!);
    const taskId = decodeURIComponent(taskDetailProjectionMatch[2]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, buildProjectionEnvelope(buildTaskDetailProjection(inspection, taskId)));
    return true;
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
    return true;
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
        return true;
      }
      if (message.includes("outside the workspace root")) {
        sendApiError(response, 400, "bad_request", message);
        return true;
      }
      throw error;
    }
    return true;
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
    return true;
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
    return true;
  }

  const auditTimelineProjectionMatch = path.match(/^\/api\/runs\/([^/]+)\/projections\/audit-timeline$/);
  if (request.method === "GET" && auditTimelineProjectionMatch) {
    const runId = decodeURIComponent(auditTimelineProjectionMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, buildProjectionEnvelope(buildAuditTimelineProjection(inspection)));
    return true;
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
    return true;
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
    return true;
  }

  const runInspectMatch = path.match(/^\/api\/runs\/([^/]+)\/inspect$/);
  if (request.method === "GET" && runInspectMatch) {
    const runId = decodeURIComponent(runInspectMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, inspection);
    return true;
  }

  const runApprovalsMatch = path.match(/^\/api\/runs\/([^/]+)\/approvals$/);
  if (request.method === "GET" && runApprovalsMatch) {
    const runId = decodeURIComponent(runApprovalsMatch[1]!);
    const inspection = await app.runCoordinator.inspectRun(runId);
    sendJson(response, 200, buildApprovalQueue(inspection));
    return true;
  }

  const resumeMatch = path.match(/^\/api\/runs\/([^/]+)\/resume$/);
  if (request.method === "POST" && resumeMatch) {
    const runId = decodeURIComponent(resumeMatch[1]!);
    const config = body?.configPath
      ? await app.dependencies.configLoader.load(body.configPath)
      : undefined;
    const run = await app.runCoordinator.resumeRun(runId, config ? { config } : {});
    sendJson(response, 200, run);
    return true;
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
        return true;
      }
      throw error;
    }
    return true;
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
    return true;
  }

  const taskMutationMatch = path.match(/^\/api\/runs\/([^/]+)\/tasks\/([^/]+)\/(requeue|cancel)$/);
  if (request.method === "POST" && taskMutationMatch) {
    const runId = decodeURIComponent(taskMutationMatch[1]!);
    const taskId = decodeURIComponent(taskMutationMatch[2]!);
    const action = taskMutationMatch[3]!;
    sendJson(response, 501, buildNotSupportedResponse(
      `Task action "${action}" is blocked until taskSession persistence and action coordinators land.`,
      {
        runId,
        taskId,
        action,
        missingEntities: ["taskSession"],
      },
    ));
    return true;
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
    return true;
  }

  return false;
}
