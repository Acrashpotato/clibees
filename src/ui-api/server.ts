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
import { handleRequest } from "./request-handler.js";
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

export interface JsonRequestBody {
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
        {
          setCorsHeaders,
          loadCompleteInspections,
          filterRunList,
          filterApprovalProjectionItems,
          buildApprovalQueueSummary,
          rejectIfBuildIsStale,
          deleteRunState,
          readArtifactContentPreview,
          sendJson,
          sendApiError,
          readJsonBody,
          isSelectedCli,
        },
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
  // `Date.now()` is millisecond precision while filesystem mtimes can be fractional.
  // Normalize to whole milliseconds to avoid false stale-build positives.
  if (Math.floor(latestBuildMtimeMs) <= serverStartedAtMs) {
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
