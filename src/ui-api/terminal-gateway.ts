import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import process from "node:process";
import * as pty from "node-pty";
import type { RawData, WebSocket } from "ws";
import { WebSocketServer } from "ws";
import { createId } from "../shared/runtime.js";
import type { RunStore } from "../storage/run-store.js";
import { SELECTED_CLI_VALUES, type SelectedCli } from "./selected-cli.js";

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const MIN_COLS = 40;
const MAX_COLS = 300;
const MIN_ROWS = 12;
const MAX_ROWS = 120;
const MAX_BUFFER_CHUNKS = 400;
const DEFAULT_LAUNCHED_CLI: SelectedCli = "codex";

export interface CreateTerminalSessionInput {
  runId: string;
  sessionId: string;
  cols?: number;
  rows?: number;
  launchCli?: boolean;
  launchCodex?: boolean;
}

export interface CreateTerminalSessionResult {
  terminalSessionId: string;
  wsPath: string;
}

interface ClientInputMessage {
  type: "input";
  data: string;
}

interface ClientResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

interface ClientKillMessage {
  type: "kill";
}

type ClientMessage =
  | ClientInputMessage
  | ClientResizeMessage
  | ClientKillMessage;

interface ServerReadyMessage {
  type: "ready";
}

interface ServerOutputMessage {
  type: "output";
  data: string;
}

interface ServerExitMessage {
  type: "exit";
  exitCode: number;
  signal?: number;
}

interface ServerErrorMessage {
  type: "error";
  message: string;
}

type ServerMessage =
  | ServerReadyMessage
  | ServerOutputMessage
  | ServerExitMessage
  | ServerErrorMessage;

interface TerminalSessionRecord {
  terminalSessionId: string;
  token: string;
  runId: string;
  sessionId: string;
  ptyProcess: pty.IPty;
  clients: Set<WebSocket>;
  outputBuffer: string[];
  exited: boolean;
  exitCode?: number;
  signal?: number;
  disposeHandle?: NodeJS.Timeout;
}

export class TerminalGateway {
  private readonly sessions = new Map<string, TerminalSessionRecord>();
  private readonly wsPath = "/api/terminal/stream";
  private readonly wsServer = new WebSocketServer({ noServer: true });

  constructor(private readonly runStore: RunStore) {}

  attach(server: HttpServer): void {
    server.on("upgrade", (request, socket, head) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname !== this.wsPath) {
        return;
      }

      const terminalSessionId = requestUrl.searchParams.get("terminalSessionId");
      const token = requestUrl.searchParams.get("token");
      if (!terminalSessionId || !token) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }

      const session = this.sessions.get(terminalSessionId);
      if (!session || session.token !== token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      this.wsServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.bindClient(session, webSocket, request);
      });
    });
  }

  async createSession(input: CreateTerminalSessionInput): Promise<CreateTerminalSessionResult> {
    const run = await this.runStore.getRun(input.runId);
    if (!run) {
      throw new Error(`Run "${input.runId}" was not found.`);
    }

    const shell = resolveShellCommand();
    const cols = clamp(input.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS);
    const rows = clamp(input.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS);

    const ptyProcess = pty.spawn(shell.command, shell.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: run.workspacePath,
      env: {
        ...process.env,
      },
    });

    const terminalSessionId = createId("terminal");
    const session: TerminalSessionRecord = {
      terminalSessionId,
      token: randomBytes(24).toString("hex"),
      runId: input.runId,
      sessionId: input.sessionId,
      ptyProcess,
      clients: new Set<WebSocket>(),
      outputBuffer: [],
      exited: false,
    };
    this.sessions.set(terminalSessionId, session);

    ptyProcess.onData((chunk) => {
      appendOutputBuffer(session, chunk);
      this.broadcast(session, {
        type: "output",
        data: chunk,
      });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      session.exited = true;
      session.exitCode = exitCode;
      session.signal = signal;
      this.broadcast(session, {
        type: "exit",
        exitCode,
        ...(typeof signal === "number" ? { signal } : {}),
      });
      this.scheduleDispose(session);
    });

    const launchCli = (input.launchCli ?? input.launchCodex) !== false;
    if (launchCli) {
      ptyProcess.write(`${resolveTerminalSelectedCli(run.metadata)}\r`);
    }

    return {
      terminalSessionId,
      wsPath: `${this.wsPath}?terminalSessionId=${encodeURIComponent(terminalSessionId)}&token=${encodeURIComponent(session.token)}`,
    };
  }

  close(): void {
    for (const session of this.sessions.values()) {
      clearTimeout(session.disposeHandle);
      for (const client of session.clients) {
        client.close();
      }
      try {
        session.ptyProcess.kill();
      } catch {
        continue;
      }
    }
    this.sessions.clear();
    this.wsServer.close();
  }

  private bindClient(
    session: TerminalSessionRecord,
    webSocket: WebSocket,
    _request: IncomingMessage,
  ): void {
    clearTimeout(session.disposeHandle);
    session.disposeHandle = undefined;
    session.clients.add(webSocket);

    sendMessage(webSocket, { type: "ready" });
    for (const chunk of session.outputBuffer) {
      sendMessage(webSocket, {
        type: "output",
        data: chunk,
      });
    }
    if (session.exited) {
      sendMessage(webSocket, {
        type: "exit",
        exitCode: session.exitCode ?? 0,
        ...(typeof session.signal === "number" ? { signal: session.signal } : {}),
      });
    }

    webSocket.on("message", (raw) => {
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) {
        sendMessage(webSocket, {
          type: "error",
          message: parsed.message,
        });
        return;
      }

      if (parsed.value.type === "input") {
        session.ptyProcess.write(parsed.value.data);
        return;
      }

      if (parsed.value.type === "resize") {
        session.ptyProcess.resize(
          clamp(parsed.value.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS),
          clamp(parsed.value.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS),
        );
        return;
      }

      if (parsed.value.type === "kill") {
        try {
          session.ptyProcess.kill();
        } catch {
          return;
        }
      }
    });

    webSocket.on("close", () => {
      session.clients.delete(webSocket);
      this.scheduleDispose(session);
    });
  }

  private broadcast(session: TerminalSessionRecord, message: ServerMessage): void {
    for (const client of session.clients) {
      sendMessage(client, message);
    }
  }

  private scheduleDispose(session: TerminalSessionRecord): void {
    if (session.clients.size > 0 || !session.exited) {
      return;
    }
    clearTimeout(session.disposeHandle);
    session.disposeHandle = setTimeout(() => {
      this.sessions.delete(session.terminalSessionId);
    }, 60_000);
  }
}

export function resolveTerminalSelectedCli(
  metadata: Record<string, unknown>,
): SelectedCli {
  const rawValue = metadata.selectedCli;
  if (typeof rawValue !== "string") {
    return DEFAULT_LAUNCHED_CLI;
  }

  const normalizedValue = rawValue.trim();
  return isSelectedCli(normalizedValue) ? normalizedValue : DEFAULT_LAUNCHED_CLI;
}

function isSelectedCli(value: string): value is SelectedCli {
  return (SELECTED_CLI_VALUES as readonly string[]).includes(value);
}

function parseClientMessage(raw: RawData): { ok: true; value: ClientMessage } | { ok: false; message: string } {
  const text = toUtf8String(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      message: "Invalid terminal message JSON payload.",
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {
      ok: false,
      message: "Terminal message payload must be an object.",
    };
  }

  const message = parsed as Partial<ClientMessage>;
  if (message.type === "input" && typeof message.data === "string") {
    return { ok: true, value: message as ClientInputMessage };
  }

  if (
    message.type === "resize" &&
    typeof (message as ClientResizeMessage).cols === "number" &&
    typeof (message as ClientResizeMessage).rows === "number"
  ) {
    return { ok: true, value: message as ClientResizeMessage };
  }

  if (message.type === "kill") {
    return { ok: true, value: message as ClientKillMessage };
  }

  return {
    ok: false,
    message: "Unsupported terminal message type.",
  };
}

function toUtf8String(raw: RawData): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  return raw.toString("utf8");
}

function appendOutputBuffer(session: TerminalSessionRecord, chunk: string): void {
  session.outputBuffer.push(chunk);
  if (session.outputBuffer.length > MAX_BUFFER_CHUNKS) {
    session.outputBuffer.splice(0, session.outputBuffer.length - MAX_BUFFER_CHUNKS);
  }
}

function resolveShellCommand(): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoLogo"],
    };
  }

  return {
    command: process.env.SHELL ?? "bash",
    args: ["-i"],
  };
}

function clamp(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function sendMessage(socket: WebSocket, payload: ServerMessage): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}
