import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir } from "node:fs/promises";
import { URL } from "node:url";
import { createApp } from "../app/create-app.js";
import type { RunInspection, RunRecord } from "../domain/models.js";
import { createStateLayout, getRunStatePaths } from "../storage/state-layout.js";
import { pathExists, readJsonFile } from "../shared/runtime.js";
import {
  buildApprovalQueue,
  buildRunListItemView,
  buildWorkspaceView,
} from "../ui-read-models/build-views.js";

export interface UiApiServerOptions {
  host?: string;
  port?: number;
  stateRootDir?: string;
}

interface JsonRequestBody {
  goal?: string;
  configPath?: string;
  actor?: string;
  note?: string;
  autoResume?: boolean;
}

export function createUiApiServer(options: UiApiServerOptions = {}) {
  const app = createApp(options.stateRootDir ? { stateRootDir: options.stateRootDir } : {});
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(app, request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: message });
    }
  });

  return {
    server,
    listen: () =>
      new Promise<void>((resolve) => {
        server.listen(options.port ?? 4318, options.host ?? "127.0.0.1", () => resolve());
      }),
  };
}

async function handleRequest(
  app: ReturnType<typeof createApp>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  setCorsHeaders(response);
  if (!request.url || !request.method) {
    sendJson(response, 400, { error: "Missing request url." });
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
    const inspections = await loadCompleteInspections(app);
    sendJson(response, 200, inspections.map((inspection) => buildRunListItemView(inspection)));
    return;
  }

  if (request.method === "GET" && path === "/api/approvals") {
    const inspections = await loadCompleteInspections(app);
    sendJson(
      response,
      200,
      inspections.flatMap((inspection) => buildApprovalQueue(inspection)),
    );
    return;
  }

  if (request.method === "POST" && path === "/api/runs") {
    if (!body?.goal || body.goal.trim().length === 0) {
      sendJson(response, 400, { error: "Field \"goal\" is required." });
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
      body?.actor?.trim() || "console-user",
      body?.note?.trim() || undefined,
      config ? { config } : {},
    );
    sendJson(response, 200, run);
    return;
  }

  sendJson(response, 404, { error: `Route not found: ${request.method} ${path}` });
}

async function loadCompleteInspections(
  app: ReturnType<typeof createApp>,
): Promise<RunInspection[]> {
  const runs = await listCompleteRuns();
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

async function listCompleteRuns(): Promise<RunRecord[]> {
  const layout = createStateLayout();
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
