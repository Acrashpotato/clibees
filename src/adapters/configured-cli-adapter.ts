import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { AgentConfig } from "../domain/config.js";
import type {
  AgentCapability,
  ContextBundle,
  InvocationPlan,
  RunEvent,
  TaskSpec,
} from "../domain/models.js";
import type { AgentSelection } from "../decision/router.js";
import { createId, isoNow } from "../shared/runtime.js";
import { StructuredAdapter } from "./structured-adapter.js";

export interface ConfiguredCliAdapterDependencies {
  spawnProcess?: typeof spawn;
  now?: () => Date;
  pathEnv?: string;
}

export class ConfiguredCliAdapter extends StructuredAdapter {
  private readonly runningProcesses = new Map<string, ChildProcess>();
  private readonly spawnProcess: typeof spawn;
  private readonly now: () => Date;
  private readonly pathEnv: string;

  constructor(
    private readonly agent: AgentConfig,
    dependencies: ConfiguredCliAdapterDependencies = {},
  ) {
    super(agent.id, {
      command: agent.command,
      profiles: agent.profiles,
      capability: buildCapability(agent),
    });

    this.spawnProcess = dependencies.spawnProcess ?? spawn;
    this.now = dependencies.now ?? (() => new Date());
    this.pathEnv = dependencies.pathEnv ?? (process.env.PATH ?? "");
  }

  override async probe(): Promise<AgentCapability> {
    const available = await commandExists(this.agent.command, this.pathEnv);

    if (!available) {
      throw new Error(
        `Command "${this.agent.command}" for adapter "${this.agent.id}" was not found in PATH.`,
      );
    }

    return super.probe();
  }

  async planInvocation(
    task: TaskSpec,
    context: ContextBundle,
    selection: AgentSelection,
  ): Promise<InvocationPlan> {
    const profile = this.getProfile(selection.profileId);
    const prompt = compilePrompt(task, context);
    const profileArgs = profile.defaultArgs ?? [];
    const useStdinPrompt = shouldPassPromptViaStdin(this.agent.command);
    const stdinSentinelArgs =
      useStdinPrompt && !profileArgs.some((arg) => arg.trim() === "-")
        ? ["-"]
        : [];
    const args = useStdinPrompt ? stdinSentinelArgs : [prompt];
    const cwd = task.workingDirectory || profile.defaultCwd || process.cwd();
    const commandArgs = [...profileArgs, ...args];

    return this.createInvocationPlan(task, selection, {
      args,
      ...(useStdinPrompt ? { stdin: prompt } : {}),
      cwd,
      actionPlans: [
        this.createCommandActionPlan(
          task,
          {
            command: this.command,
            args: commandArgs,
            cwd,
          },
          `Run ${this.agent.id} with profile "${selection.profileId}" for task "${task.id}".`,
        ),
      ],
    });
  }

  async *run(runId: string, invocation: InvocationPlan): AsyncIterable<RunEvent> {
    const queue = new AsyncEventQueue<RunEvent>();
    const child = spawnWithWindowsShellFallback(
      this.spawnProcess,
      invocation.command,
      invocation.args,
      {
        cwd: invocation.cwd,
        env: {
          ...process.env,
          ...invocation.env,
        },
        stdio: [typeof invocation.stdin === "string" ? "pipe" : "ignore", "pipe", "pipe"],
      },
    );
    const executionKey = getExecutionKey(runId, invocation.taskId);
    this.runningProcesses.set(executionKey, child);
    if (typeof invocation.stdin === "string") {
      child.stdin?.end(invocation.stdin);
    }

    let settled = false;
    const finish = (event: RunEvent): void => {
      if (settled) {
        return;
      }

      settled = true;
      queue.push(event);
      queue.close();
      this.runningProcesses.delete(executionKey);
    };

    queue.push(
      this.createEvent("task_started", runId, invocation.taskId, {
        agentId: this.agentId,
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.cwd,
      }),
    );

    child.stdout?.on("data", (chunk: Buffer) => {
      queue.push(
        this.createEvent("agent_message", runId, invocation.taskId, {
          agentId: this.agentId,
          stream: "stdout",
          message: chunk.toString("utf8"),
        }),
      );
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      queue.push(
        this.createEvent("agent_message", runId, invocation.taskId, {
          agentId: this.agentId,
          stream: "stderr",
          message: chunk.toString("utf8"),
        }),
      );
    });

    child.once("error", (error: Error) => {
      finish(
        this.createEvent("task_failed", runId, invocation.taskId, {
          agentId: this.agentId,
          error: error.message,
        }),
      );
    });

    child.once("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (exitCode === 0) {
        finish(
          this.createEvent("task_completed", runId, invocation.taskId, {
            agentId: this.agentId,
            exitCode,
          }),
        );
        return;
      }

      finish(
        this.createEvent("task_failed", runId, invocation.taskId, {
          agentId: this.agentId,
          exitCode,
          signal,
        }),
      );
    });

    try {
      for await (const event of queue) {
        yield event;
      }
    } finally {
      this.runningProcesses.delete(executionKey);
      if (child.exitCode === null && child.signalCode === null && !child.killed) {
        child.kill();
      }
    }
  }

  async interrupt(runId: string, taskId: string): Promise<void> {
    const child = this.runningProcesses.get(getExecutionKey(runId, taskId));

    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    child.kill();
  }

  private createEvent(
    type: RunEvent["type"],
    runId: string,
    taskId: string,
    payload: Record<string, unknown>,
  ): RunEvent {
    return {
      schemaVersion: 1,
      id: createId("event", this.now()),
      type,
      runId,
      taskId,
      timestamp: isoNow(this.now()),
      payload,
    };
  }
}

function buildCapability(agent: AgentConfig): Omit<
  AgentCapability,
  "agentId" | "supportedCapabilities" | "defaultProfileId"
> &
  Partial<Pick<AgentCapability, "supportedCapabilities" | "defaultProfileId">> {
  const supportedCapabilities = [
    ...new Set(agent.profiles.flatMap((profile) => profile.capabilities)),
  ];

  return {
    supportsNonInteractive: true,
    supportsStructuredOutput: supportedCapabilities.includes("structured-output"),
    supportsCwd: true,
    supportsAutoApproveFlags: agent.profiles.some((profile) =>
      (profile.defaultArgs ?? []).some(
        (arg) =>
          arg === "--yes" ||
          arg === "-y" ||
          arg === "--dangerously-skip-permissions",
      ),
    ),
    supportsStreaming: true,
    supportsActionPlanning: true,
    supportsResume: false,
    supportedCapabilities,
    defaultProfileId: agent.profiles[0]?.id,
  };
}

function compilePrompt(task: TaskSpec, context: ContextBundle): string {
  const sections = [
    `Task: ${task.title}`,
    `Goal: ${task.goal}`,
    renderListSection("Instructions", task.instructions),
    renderListSection("Relevant Facts", context.relevantFacts),
    renderListSection("Relevant Decisions", context.relevantDecisions),
    renderListSection("Artifacts", context.artifactSummaries),
    `Workspace Summary:\n${context.workspaceSummary || "(none)"}`,
    renderListSection("Transcript Refs", context.transcriptRefs),
    renderListSection("Agent Hints", context.agentHints),
  ].filter((value) => value.length > 0);

  return sections.join("\n\n");
}

function shouldPassPromptViaStdin(command: string): boolean {
  return isCodexCommand(command);
}

function isCodexCommand(command: string): boolean {
  const executable = path.basename(command).toLowerCase();
  return (
    executable === "codex" ||
    executable === "codex.exe" ||
    executable === "codex.cmd" ||
    executable === "codex.bat"
  );
}

function renderListSection(title: string, values: string[]): string {
  if (values.length === 0) {
    return "";
  }

  return `${title}:\n${values.map((value) => `- ${value}`).join("\n")}`;
}

function getExecutionKey(runId: string, taskId: string): string {
  return `${runId}:${taskId}`;
}

async function commandExists(command: string, pathEnv: string): Promise<boolean> {
  for (const candidate of resolveCommandCandidates(command, pathEnv)) {
    try {
      await access(candidate, constants.F_OK);
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

function resolveCommandCandidates(command: string, pathEnv: string): string[] {
  const hasPathSegment =
    path.isAbsolute(command) ||
    command.includes(path.sep) ||
    command.includes(path.posix.sep);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT?.split(";").filter(Boolean) ?? [
          ".EXE",
          ".CMD",
          ".BAT",
          ".COM",
        ])
      : [""];
  const withExtensions = appendExtensions(command, extensions);

  if (hasPathSegment) {
    return withExtensions;
  }

  return pathEnv
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      withExtensions.map((candidate) => path.join(directory, candidate)),
    );
}

function appendExtensions(command: string, extensions: string[]): string[] {
  const ext = path.extname(command);

  if (process.platform !== "win32" || ext.length > 0) {
    return [command];
  }

  return [command, ...extensions.map((suffix) => `${command}${suffix.toLowerCase()}`)];
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
      const waiter = this.waiters.shift();
      waiter?.({ done: true, value: undefined });
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
