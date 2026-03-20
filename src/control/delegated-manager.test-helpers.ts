import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { MultiAgentConfig } from "../domain/config.js";
import type {
  AgentCapability,
  InvocationPlan,
  RunEvent,
  RunRecord,
  TaskSpec,
} from "../domain/models.js";
import { createApp } from "../app/create-app.js";
import { AdapterRegistry } from "../execution/adapter-registry.js";
import type { AgentAdapter } from "../execution/agent-adapter.js";
import { FileEventStore } from "../storage/event-store.js";

class DelegationAdapter implements AgentAdapter {
  constructor(
    public readonly agentId: string,
    private readonly capability: AgentCapability,
  ) {}

  async probe(): Promise<AgentCapability> {
    return this.capability;
  }

  async planInvocation(task: TaskSpec): Promise<InvocationPlan> {
    return {
      taskId: task.id,
      agentId: this.agentId,
      command: "node",
      args: ["-e", "process.stdout.write('ok');"],
      cwd: task.workingDirectory,
      actionPlans: [],
    };
  }

  async *run(
    _runId: string,
    _invocation: InvocationPlan,
  ): AsyncIterable<RunEvent> {
    return;
  }

  async interrupt(): Promise<void> {
    return;
  }
}

export function buildExecutionRuntime(
  eventStore: FileEventStore,
  options: {
    managerShouldFail?: boolean;
    managerNoMoreTasks?: boolean;
      managerDelegatedTasks?: Array<{
        title: string;
        goal: string;
        skillId?: string;
        skillArgs?: Record<string, unknown>;
        preferredAgent?: string;
        dependsOn?: string[];
        requiredCapabilities?: string[];
        instructions?: string[];
        expectedArtifacts?: string[];
      acceptanceCriteria?: string[];
    }>;
  } = {},
) {
  return {
    async *execute(
      runId: string,
      task: TaskSpec,
      invocation: InvocationPlan,
    ): AsyncIterable<RunEvent> {
      const isManagerTask =
        task.kind === "plan" && task.requiredCapabilities.includes("delegation");
      const managerDelegationPayload =
        isManagerTask
          ? {
              structuredOutput: {
                ...(options.managerNoMoreTasks
                  ? {
                      managerReply: "No additional delegated work is required.",
                      managerDecision: "no_more_tasks",
                      delegatedTasks: [],
                    }
                  : {
                      managerReply: "Delegating work to the worker agent.",
                      managerDecision: "continue",
                      delegatedTasks: options.managerDelegatedTasks ?? [
                        {
                          title: "Worker implementation",
                          goal: "Implement the delegated user goal end-to-end.",
                          preferredAgent: "cli-worker",
                          dependsOn: [],
                          requiredCapabilities: ["planning"],
                          instructions: ["Implement the requested goal in the workspace."],
                          expectedArtifacts: ["Concrete implementation output."],
                          acceptanceCriteria: ["Delegated goal is completed."],
                        },
                      ],
                    }),
              },
            }
          : {};
      const events: RunEvent[] = [
        {
          schemaVersion: 1,
          id: `evt-start-${task.id}`,
          type: "task_started",
          runId,
          taskId: task.id,
          timestamp: "2026-03-16T10:00:00.000Z",
          payload: {
            agentId: invocation.agentId,
            command: invocation.command,
            args: invocation.args,
            cwd: invocation.cwd,
          },
        },
      ];
      if (isManagerTask && options.managerShouldFail) {
        events.push({
          schemaVersion: 1,
          id: `evt-fail-${task.id}`,
          type: "task_failed",
          runId,
          taskId: task.id,
          timestamp: "2026-03-16T10:00:01.000Z",
          payload: {
            agentId: invocation.agentId,
            exitCode: 1,
            output: "manager failed before producing delegation json",
          },
        });
      } else {
        events.push({
          schemaVersion: 1,
          id: `evt-complete-${task.id}`,
          type: "task_completed",
          runId,
          taskId: task.id,
          timestamp: "2026-03-16T10:00:01.000Z",
          payload: {
            agentId: invocation.agentId,
            exitCode: 0,
            ...managerDelegationPayload,
          },
        });
      }

      for (const event of events) {
        await eventStore.append(event);
        yield event;
      }
    },
    async interrupt(): Promise<void> {
      return;
    },
  };
}

export function createDelegatedConfig(workspaceDir: string): MultiAgentConfig {
  return {
    version: 1,
    agents: [
      {
        id: "cli-manager",
        command: "node",
        priority: 1,
        profiles: [
          {
            id: "default",
            label: "Manager",
            capabilities: ["planning", "delegation"],
            defaultArgs: [],
            defaultCwd: workspaceDir,
            costTier: "low",
          },
        ],
      },
      {
        id: "cli-worker",
        command: "node",
        priority: 2,
        profiles: [
          {
            id: "default",
            label: "Worker",
            capabilities: ["planning"],
            defaultArgs: [],
            defaultCwd: workspaceDir,
            costTier: "low",
          },
        ],
      },
    ],
    planner: {
      mode: "delegated",
      agentId: "cli-manager",
    },
    routing: {
      defaultAgentId: "cli-worker",
      preferLowCost: true,
    },
    safety: {
      approvalThreshold: "high",
      blockedActions: [],
    },
    memory: {
      enabled: false,
      rootDir: path.join(workspaceDir, ".multi-agent", "memory"),
    },
    workspace: {
      rootDir: workspaceDir,
      allowOutsideWorkspaceWrites: false,
    },
    validation: {
      defaultTimeoutMs: 60_000,
      enableBuildChecks: true,
    },
    logging: {
      level: "info",
      persistEvents: true,
    },
  };
}

export function createDelegatedRegistry(): AdapterRegistry {
  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.register(
    new DelegationAdapter("cli-manager", {
      agentId: "cli-manager",
      supportsNonInteractive: true,
      supportsStructuredOutput: true,
      supportsCwd: true,
      supportsAutoApproveFlags: false,
      supportsStreaming: true,
      supportsActionPlanning: true,
      supportsResume: false,
      supportedCapabilities: ["planning", "delegation"],
      defaultProfileId: "default",
    }),
  );
  adapterRegistry.register(
    new DelegationAdapter("cli-worker", {
      agentId: "cli-worker",
      supportsNonInteractive: true,
      supportsStructuredOutput: true,
      supportsCwd: true,
      supportsAutoApproveFlags: false,
      supportsStreaming: true,
      supportsActionPlanning: true,
      supportsResume: false,
      supportedCapabilities: ["planning"],
      defaultProfileId: "default",
    }),
  );
  return adapterRegistry;
}
