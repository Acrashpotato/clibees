import path from "node:path";
import type { AgentProfileConfig } from "../domain/config.js";
import type {
  ActionPlan,
  AgentCapability,
  ContextBundle,
  InvocationPlan,
  RunEvent,
  TaskSpec,
} from "../domain/models.js";
import type { AgentSelection } from "../decision/router.js";
import type { AgentAdapter } from "../execution/agent-adapter.js";
import { createId } from "../shared/runtime.js";

export interface StructuredAdapterOptions {
  command: string;
  profiles: AgentProfileConfig[];
  capability: Omit<AgentCapability, "agentId" | "supportedCapabilities" | "defaultProfileId"> &
    Partial<Pick<AgentCapability, "supportedCapabilities" | "defaultProfileId">>;
}

export abstract class StructuredAdapter implements AgentAdapter {
  protected readonly command: string;
  private readonly capability: AgentCapability;
  private readonly profiles = new Map<string, AgentProfileConfig>();

  constructor(
    public readonly agentId: string,
    options: StructuredAdapterOptions,
  ) {
    this.command = options.command;

    for (const profile of options.profiles) {
      this.profiles.set(profile.id, {
        ...profile,
        defaultArgs: profile.defaultArgs ?? [],
      });
    }

    if (this.profiles.size === 0) {
      throw new Error(`Adapter "${agentId}" must define at least one profile.`);
    }

    const supportedCapabilities =
      options.capability.supportedCapabilities ??
      [...new Set(options.profiles.flatMap((profile) => profile.capabilities))];

    this.capability = {
      agentId,
      ...options.capability,
      supportedCapabilities,
      defaultProfileId:
        options.capability.defaultProfileId ?? options.profiles[0]?.id,
    };
  }

  async probe(): Promise<AgentCapability> {
    return this.capability;
  }

  protected getProfile(profileId: string): AgentProfileConfig {
    const profile = this.profiles.get(profileId);

    if (!profile) {
      throw new Error(
        `Adapter "${this.agentId}" does not define profile "${profileId}".`,
      );
    }

    return profile;
  }

  protected createInvocationPlan(
    task: TaskSpec,
    selection: AgentSelection,
    options: {
      args?: string[];
      stdin?: string;
      cwd?: string;
      env?: Record<string, string>;
      actionPlans?: ActionPlan[];
    } = {},
  ): InvocationPlan {
    if (selection.agentId !== this.agentId) {
      throw new Error(
        `Adapter "${this.agentId}" cannot build an invocation for "${selection.agentId}".`,
      );
    }

    const profile = this.getProfile(selection.profileId);
    const args = [...(profile.defaultArgs ?? []), ...(options.args ?? [])];
    const cwd = options.cwd ?? profile.defaultCwd ?? task.workingDirectory;

    return {
      taskId: task.id,
      agentId: this.agentId,
      command: this.command,
      args,
      ...(typeof options.stdin === "string" ? { stdin: options.stdin } : {}),
      cwd,
      ...(options.env ? { env: options.env } : {}),
      actionPlans:
        options.actionPlans ??
        [
          this.createCommandActionPlan(task, {
            command: this.command,
            args,
            cwd,
          }),
        ],
    };
  }

  protected createCommandActionPlan(
    task: TaskSpec,
    commandSpec: {
      command: string;
      args: string[];
      cwd: string;
    },
    reason?: string,
  ): ActionPlan {
    const kind = classifyActionKind(commandSpec.command, commandSpec.args);
    const riskLevel = classifyActionRisk(task.riskLevel, kind);

    return {
      id: createId("action"),
      kind,
      command: commandSpec.command,
      args: commandSpec.args,
      cwd: commandSpec.cwd,
      riskLevel,
      requiresApproval: riskLevel === "high",
      reason:
        reason ??
        `Run ${this.agentId} for task "${task.id}" using profile-selected CLI arguments.`,
    };
  }

  abstract planInvocation(
    task: TaskSpec,
    context: ContextBundle,
    selection: AgentSelection,
  ): Promise<InvocationPlan>;

  abstract run(
    runId: string,
    invocation: InvocationPlan,
  ): AsyncIterable<RunEvent>;

  async interrupt(_runId: string, _taskId: string): Promise<void> {
    return Promise.resolve();
  }
}

function classifyActionKind(command: string, args: string[]): string {
  const executable = path.basename(command).toLowerCase();
  const normalizedArgs = args.map((arg) => arg.toLowerCase());
  const commandArg = firstNonFlagArg(normalizedArgs);

  if (executable === "git" && commandArg === "push") {
    return "git_push";
  }

  if (isShellExecutable(executable) && normalizedArgs.some((arg) => /\bgit\s+push\b/.test(arg))) {
    return "git_push";
  }

  if (
    executable === "rm" ||
    executable === "del" ||
    executable === "unlink"
  ) {
    return "delete_file";
  }

  if (isShellExecutable(executable) && normalizedArgs.some((arg) => /\bremove-item\b/.test(arg))) {
    return "delete_file";
  }

  if (
    (executable === "npm" || executable === "pnpm" || executable === "yarn") &&
    normalizedArgs.some((arg) => /\bpublish\b/.test(arg))
  ) {
    return "package_publish";
  }

  return "command";
}

function firstNonFlagArg(args: string[]): string | undefined {
  return args.find((arg) => arg.length > 0 && !arg.startsWith("-"));
}

function isShellExecutable(executable: string): boolean {
  return (
    executable === "bash" ||
    executable === "sh" ||
    executable === "zsh" ||
    executable === "fish" ||
    executable === "pwsh" ||
    executable === "powershell" ||
    executable === "powershell.exe" ||
    executable === "cmd" ||
    executable === "cmd.exe"
  );
}

function classifyActionRisk(
  fallbackRisk: TaskSpec["riskLevel"],
  kind: string,
): TaskSpec["riskLevel"] {
  if (kind === "git_push" || kind === "delete_file" || kind === "package_publish") {
    return "high";
  }

  return fallbackRisk;
}
