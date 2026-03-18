import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { InvocationPlan, RunEvent, TaskSpec } from "../domain/models.js";
import { SCHEMA_VERSION } from "../domain/models.js";
import { createId, ensureDirectory, isoNow } from "../shared/runtime.js";
import type { EventStore } from "../storage/event-store.js";
import {
  createStateLayout,
  getTaskTranscriptPath,
  type StateLayout,
} from "../storage/state-layout.js";

export interface ExecutionRuntime {
  execute(
    runId: string,
    task: TaskSpec,
    invocation: InvocationPlan,
  ): AsyncIterable<RunEvent>;
  interrupt(runId: string, taskId: string): Promise<void>;
}

export interface ProcessExecutionRuntimeDependencies {
  eventStore: EventStore;
  spawnProcess?: typeof spawn;
  now?: () => Date;
  stateRootDir?: string;
  killGraceMs?: number;
}

interface ActiveExecution {
  child: ChildProcess;
  timeoutHandle?: NodeJS.Timeout;
  forceKillHandle?: NodeJS.Timeout;
}

type TranscriptStream = "stdout" | "stderr";

export class ProcessExecutionRuntime implements ExecutionRuntime {
  private readonly activeExecutions = new Map<string, ActiveExecution>();
  private readonly spawnProcess: typeof spawn;
  private readonly now: () => Date;
  private readonly layout: StateLayout;
  private readonly killGraceMs: number;

  constructor(private readonly dependencies: ProcessExecutionRuntimeDependencies) {
    this.spawnProcess = dependencies.spawnProcess ?? spawn;
    this.now = dependencies.now ?? (() => new Date());
    this.layout = createStateLayout(dependencies.stateRootDir);
    this.killGraceMs = dependencies.killGraceMs ?? 250;
  }

  async *execute(
    runId: string,
    task: TaskSpec,
    invocation: InvocationPlan,
  ): AsyncIterable<RunEvent> {
    const executionKey = getExecutionKey(runId, invocation.taskId);
    const transcriptPath = getTaskTranscriptPath(this.layout, runId, invocation.taskId);
    await ensureDirectory(path.dirname(transcriptPath));
    const executionCwd = await ensureExecutionCwd(invocation.cwd);

    const queue = new AsyncEventQueue<RunEvent>();
    const child = spawnWithWindowsShellFallback(
      this.spawnProcess,
      invocation.command,
      invocation.args,
      {
        cwd: executionCwd,
        env: {
          ...process.env,
          ...invocation.env,
        },
        stdio: [typeof invocation.stdin === "string" ? "pipe" : "ignore", "pipe", "pipe"],
      },
    );
    const activeExecution: ActiveExecution = {
      child,
    };
    this.activeExecutions.set(executionKey, activeExecution);
    if (typeof invocation.stdin === "string") {
      child.stdin?.end(invocation.stdin);
    }

    let settled = false;
    let timedOut = false;
    let transcriptError: string | undefined;
    let transcriptWrites = Promise.resolve();
    let stdoutOutput = "";
    let stderrOutput = "";

    const appendTranscript = (stream: TranscriptStream, chunk: string): void => {
      transcriptWrites = transcriptWrites
        .then(() =>
          appendFile(
            transcriptPath,
            `${JSON.stringify({
              timestamp: isoNow(this.now()),
              stream,
              chunk,
            })}\n`,
            "utf8",
          ),
        )
        .catch((error: unknown) => {
          transcriptError = error instanceof Error ? error.message : String(error);
        });
    };

    const enqueue = (event: RunEvent): void => {
      queue.push(event);
    };

    const finalize = (event: RunEvent): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(activeExecution.timeoutHandle);
      clearTimeout(activeExecution.forceKillHandle);
      void transcriptWrites.finally(() => {
        queue.push(event);
        queue.close();
        this.activeExecutions.delete(executionKey);
      });
    };

    enqueue(
      this.createEvent("task_started", runId, invocation.taskId, {
        agentId: invocation.agentId,
        command: invocation.command,
        args: invocation.args,
        cwd: executionCwd,
        transcriptPath,
      }),
    );

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const message = normalizeChunk(chunk);
      stdoutOutput += message;
      appendTranscript("stdout", message);
      enqueue(
        this.createEvent("agent_message", runId, invocation.taskId, {
          agentId: invocation.agentId,
          stream: "stdout",
          message: stripAnsi(message),
        }),
      );
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const message = normalizeChunk(chunk);
      stderrOutput += message;
      appendTranscript("stderr", message);
      enqueue(
        this.createEvent("agent_message", runId, invocation.taskId, {
          agentId: invocation.agentId,
          stream: "stderr",
          message: stripAnsi(message),
        }),
      );
    });

    child.once("error", (error: Error) => {
      finalize(
        this.createEvent("task_failed", runId, invocation.taskId, {
          agentId: invocation.agentId,
          error: error.message,
          ...buildOutputPayload(stdoutOutput, stderrOutput),
          transcriptPath,
          ...(transcriptError ? { transcriptError } : {}),
        }),
      );
    });

    child.once("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (timedOut) {
        finalize(
          this.createEvent("task_failed", runId, invocation.taskId, {
            agentId: invocation.agentId,
            reason: "timeout",
            timeoutMs: task.timeoutMs,
            exitCode,
            signal,
            ...buildOutputPayload(stdoutOutput, stderrOutput),
            transcriptPath,
            ...(transcriptError ? { transcriptError } : {}),
          }),
        );
        return;
      }

      if (exitCode === 0) {
        finalize(
          this.createEvent("task_completed", runId, invocation.taskId, {
            agentId: invocation.agentId,
            exitCode,
            signal,
            ...buildOutputPayload(stdoutOutput, stderrOutput),
            transcriptPath,
            ...(transcriptError ? { transcriptError } : {}),
          }),
        );
        return;
      }

      finalize(
        this.createEvent("task_failed", runId, invocation.taskId, {
          agentId: invocation.agentId,
          exitCode,
          signal,
          ...buildOutputPayload(stdoutOutput, stderrOutput),
          transcriptPath,
          ...(transcriptError ? { transcriptError } : {}),
        }),
      );
    });

    if (task.timeoutMs > 0) {
      activeExecution.timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill();
        activeExecution.forceKillHandle = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null && !child.killed) {
            child.kill("SIGKILL");
          }
        }, this.killGraceMs);
      }, task.timeoutMs);
    }

    try {
      for await (const event of queue) {
        await this.dependencies.eventStore.append(event);
        yield event;
      }
    } finally {
      clearTimeout(activeExecution.timeoutHandle);
      clearTimeout(activeExecution.forceKillHandle);
      this.activeExecutions.delete(executionKey);

      if (child.exitCode === null && child.signalCode === null && !child.killed) {
        child.kill();
      }

      await transcriptWrites;
    }
  }

  async interrupt(runId: string, taskId: string): Promise<void> {
    const execution = this.activeExecutions.get(getExecutionKey(runId, taskId));

    if (!execution) {
      return;
    }

    clearTimeout(execution.timeoutHandle);

    if (
      execution.child.exitCode === null &&
      execution.child.signalCode === null &&
      !execution.child.killed
    ) {
      execution.child.kill();
    }
  }

  private createEvent(
    type: RunEvent["type"],
    runId: string,
    taskId: string,
    payload: Record<string, unknown>,
  ): RunEvent {
    return {
      schemaVersion: SCHEMA_VERSION,
      id: createId("event", this.now()),
      type,
      runId,
      taskId,
      timestamp: isoNow(this.now()),
      payload,
    };
  }
}

async function ensureExecutionCwd(cwd: string): Promise<string> {
  const resolvedCwd = path.resolve(cwd);

  try {
    const cwdStats = await stat(resolvedCwd);
    if (cwdStats.isDirectory()) {
      return resolvedCwd;
    }

    // If a file path is accidentally passed as cwd, execute from its parent directory.
    const parentDirectory = path.dirname(resolvedCwd);
    await ensureDirectory(parentDirectory);
    return parentDirectory;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }

    await ensureDirectory(resolvedCwd);
    return resolvedCwd;
  }
}

function getExecutionKey(runId: string, taskId: string): string {
  return `${runId}:${taskId}`;
}

function normalizeChunk(chunk: Buffer | string): string {
  return typeof chunk === "string" ? chunk : chunk.toString("utf8");
}

function stripAnsi(value: string): string {
  return value.replace(
    /[\u001B\u009B][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><])/g,
    "",
  );
}

function buildOutputPayload(
  stdoutOutput: string,
  stderrOutput: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const output = stripAnsi(stdoutOutput);
  const stderr = stripAnsi(stderrOutput);
  if (output.length > 0) {
    payload.output = output;
  }
  if (stderr.length > 0) {
    payload.stderr = stderr;
  }

  const structuredOutput = parseStructuredOutput(output);
  if (structuredOutput !== undefined) {
    payload.structuredOutput = structuredOutput;
  }

  return payload;
}

function parseStructuredOutput(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) {
    return undefined;
  }

  const direct = tryParseJson(trimmed);
  if (direct !== undefined) {
    return direct;
  }

  const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) {
    const parsedFence = tryParseJson(fenced.trim());
    if (parsedFence !== undefined) {
      return parsedFence;
    }
  }

  const objectMatch = trimmed.match(/(\{[\s\S]*\})/);
  if (objectMatch?.[1]) {
    const parsedObject = tryParseJson(objectMatch[1]);
    if (parsedObject !== undefined) {
      return parsedObject;
    }
  }

  const arrayMatch = trimmed.match(/(\[[\s\S]*\])/);
  if (arrayMatch?.[1]) {
    const parsedArray = tryParseJson(arrayMatch[1]);
    if (parsedArray !== undefined) {
      return parsedArray;
    }
  }

  return undefined;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function spawnWithWindowsShellFallback(
  spawnProcess: typeof spawn,
  command: string,
  args: string[],
  options: NonNullable<Parameters<typeof spawn>[2]>,
): ChildProcess {
  if (shouldForceWindowsShell(command)) {
    return spawnProcess(command, args, {
      ...options,
      shell: true,
    });
  }

  try {
    return spawnProcess(command, args, options);
  } catch (error) {
    if (!shouldRetryWithWindowsShell(error)) {
      throw error;
    }

    return spawnProcess(command, args, {
      ...options,
      shell: true,
    });
  }
}

function shouldRetryWithWindowsShell(error: unknown): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPERM" || code === "EACCES" || code === "ENOENT";
}

function shouldForceWindowsShell(command: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  const hasPathSegment =
    command.includes(path.sep) || command.includes(path.posix.sep);
  if (hasPathSegment) {
    const ext = path.extname(command).toLowerCase();
    return ext === ".cmd" || ext === ".bat";
  }

  const ext = path.extname(command).toLowerCase();
  return ext.length === 0 || ext === ".cmd" || ext === ".bat";
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value });
      return;
    }

    this.values.push(value);
  }

  close(): void {
    this.closed = true;

    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async (): Promise<IteratorResult<T>> => {
        const value = this.values.shift();
        if (value !== undefined) {
          return {
            done: false,
            value,
          };
        }

        if (this.closed) {
          return {
            done: true,
            value: undefined,
          };
        }

        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}
