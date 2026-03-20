import { URL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { createApp } from "../app/create-app.js";
import type { RunInspection } from "../domain/models.js";
import { createId } from "../shared/runtime.js";
import { buildApprovalQueue } from "../ui-read-models/build-views.js";
import type {
  ApprovalQueueItemDetailView,
  ApprovalQueueSummaryView,
  RunListItemView,
} from "../ui-read-models/models.js";
import { buildRunListProjection } from "../ui-read-models/build-run-list-projection.js";
import { buildApprovalQueueProjection } from "../ui-read-models/build-approval-queue-projection.js";
import {
  SELECTED_CLI_VALUES,
  buildProjectionEnvelope,
  paginateItems,
} from "./contracts.js";
import type { JsonRequestBody, UiApiServerOptions } from "./server.js";
import { TerminalGateway } from "./terminal-gateway.js";
import { tryHandleInteractionRoutes } from "./request-handler-interactions.js";
import { tryHandleRunRoutes } from "./request-handler-run-routes.js";

export interface RequestRouteHelpers {
  setCorsHeaders: (response: ServerResponse) => void;
  loadCompleteInspections: (app: ReturnType<typeof createApp>, stateRootDir?: string) => Promise<RunInspection[]>;
  filterRunList: (runs: RunListItemView[], url: URL) => RunListItemView[];
  filterApprovalProjectionItems: (items: ApprovalQueueItemDetailView[], url: URL) => ApprovalQueueItemDetailView[];
  buildApprovalQueueSummary: (items: ApprovalQueueItemDetailView[]) => ApprovalQueueSummaryView;
  rejectIfBuildIsStale: (response: ServerResponse, options: UiApiServerOptions, method: string, path: string, serverStartedAtMs: number) => Promise<boolean>;
  deleteRunState: (stateRootDir: string | undefined, runId: string) => Promise<void>;
  getMultiAgentSummary: (stateRootDir?: string) => Promise<unknown>;
  cleanupMultiAgentData: (
    stateRootDir: string | undefined,
    options: { keepRunId?: string; clearMemory?: boolean },
  ) => Promise<unknown>;
  readArtifactContentPreview: (app: ReturnType<typeof createApp>, options: UiApiServerOptions, runId: string, artifactId: string) => Promise<unknown>;
  sendJson: (response: ServerResponse, status: number, payload: unknown) => void;
  sendApiError: (
    response: ServerResponse,
    status: number,
    code: "bad_request" | "not_found" | "state_conflict" | "not_supported" | "internal_error",
    message: string,
    details?: Record<string, unknown>,
  ) => void;
  readJsonBody: (request: IncomingMessage) => Promise<JsonRequestBody | undefined>;
  isSelectedCli: (value: string) => boolean;
}

export async function handleRequest(
  app: ReturnType<typeof createApp>,
  options: UiApiServerOptions,
  terminalGateway: TerminalGateway,
  serverStartedAtMs: number,
  helpers: RequestRouteHelpers,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const {
    setCorsHeaders,
    loadCompleteInspections,
    filterRunList,
    filterApprovalProjectionItems,
    buildApprovalQueueSummary,
    rejectIfBuildIsStale,
    deleteRunState,
    getMultiAgentSummary,
    cleanupMultiAgentData,
    readArtifactContentPreview,
    sendJson,
    sendApiError,
    readJsonBody,
    isSelectedCli,
  } = helpers;
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

  if (request.method === "GET" && path === "/api/system/multi-agent/summary") {
    const summary = await getMultiAgentSummary(options.stateRootDir);
    sendJson(response, 200, summary);
    return;
  }

  if (request.method === "POST" && path === "/api/system/multi-agent/cleanup") {
    if (body?.clearMemory !== undefined && typeof body.clearMemory !== "boolean") {
      sendApiError(
        response,
        400,
        "bad_request",
        "Field \"clearMemory\" must be a boolean when provided.",
      );
      return;
    }

    if (body?.keepRunId !== undefined && typeof body.keepRunId !== "string") {
      sendApiError(
        response,
        400,
        "bad_request",
        "Field \"keepRunId\" must be a string when provided.",
      );
      return;
    }

    try {
      const result = await cleanupMultiAgentData(options.stateRootDir, {
        keepRunId: body?.keepRunId,
        clearMemory: body?.clearMemory,
      });
      sendJson(response, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("was not found under")) {
        sendApiError(response, 404, "not_found", message);
        return;
      }
      throw error;
    }
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
    sendJson(response, 201, createdRun);
    if (body?.autoResume) {
      // Do not block create response on execution; resume in background.
      void app.runCoordinator
        // resumeRun must resolve CLI from persisted RunRecord.metadata.selectedCli.
        .resumeRun(createdRun.runId, { config })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            `[ui-api] background autoResume failed for run "${createdRun.runId}": ${message}`,
          );
        });
    }
    return;
  }

  if (
    await tryHandleRunRoutes({
      app,
      options,
      terminalGateway,
      request,
      response,
      path,
      url,
      body,
      helpers: {
        filterApprovalProjectionItems,
        buildApprovalQueueSummary,
        deleteRunState,
        readArtifactContentPreview,
        sendJson,
        sendApiError,
      },
    })
  ) {
    return;
  }

  if (
    await tryHandleInteractionRoutes({
      app,
      request,
      path,
      body,
      response,
      sendJson,
      sendApiError,
    })
  ) {
    return;
  }

  sendApiError(response, 404, "not_found", `Route not found: ${request.method} ${path}`);
}
