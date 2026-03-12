import { spawn, type ChildProcess } from "node:child_process";
import { appendFile } from "node:fs/promises";
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

    const queue = new AsyncEventQueue<RunEvent>();
    const child = this.spawnProcess(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: {
        ...process.env,
        ...invocation.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const activeExecution: ActiveExecution = {
      child,
    };
    this.activeExecutions.set(executionKey, activeExecution);

    let settled = false;
    let timedOut = false;
    let transcriptError: string | undefined;
    let transcriptWrites = Promise.resolve();

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
        cwd: invocation.cwd,
        transcriptPath,
      }),
    );

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const message = normalizeChunk(chunk);
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
