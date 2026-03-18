import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import type { MultiAgentConfig } from "../domain/config.js";
import type {
  AgentCapability,
  InvocationPlan,
  RunEvent,
  TaskSpec,
} from "../domain/models.js";
import type { Planner, PlannerInput, ReplanInput } from "../decision/planner.js";
import { createApp } from "../app/create-app.js";
import { AdapterRegistry } from "../execution/adapter-registry.js";
import type { AgentAdapter } from "../execution/agent-adapter.js";
import { FileEventStore } from "../storage/event-store.js";

export function buildTask(workspaceDir: string, overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "task-phase8",
    title: "Phase 8 task",
    kind: "execute",
    goal: "Exercise validation and artifact archival",
    instructions: ["Execute", "Archive artifacts", "Validate outputs"],
    inputs: [],
    dependsOn: [],
    requiredCapabilities: ["planning"],
    workingDirectory: workspaceDir,
    expectedArtifacts: [],
    acceptanceCriteria: ["Validation runs after execution"],
    validator: { mode: "none" },
    riskLevel: "low",
    allowedActions: [],
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: ["validation_fail"],
    },
    status: "ready",
    ...overrides,
  };
}

function buildConfig(workspaceDir: string): MultiAgentConfig {
  return {
    version: 1,
    agents: [
      {
        id: "codex",
        command: "node",
        priority: 1,
        profiles: [
          {
            id: "default",
            label: "Default",
            capabilities: ["planning"],
            defaultArgs: [],
            defaultCwd: workspaceDir,
            costTier: "low",
          },
        ],
      },
    ],
    planner: {
      mode: "static",
      agentId: "codex",
    },
    routing: {
      defaultAgentId: "codex",
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

class SingleTaskPlanner implements Planner {
  constructor(private readonly task: TaskSpec) {}

  async createInitialPlan(_input: PlannerInput): Promise<TaskSpec[]> {
    return [{ ...this.task }];
  }

  async replan(_input: ReplanInput) {
    return {
      operation: "append_tasks" as const,
      reason: "Phase 8 tests do not replan.",
      tasks: [],
    };
  }
}

class ValidationTestAdapter implements AgentAdapter {
  constructor(public readonly agentId: string) {}

  async probe(): Promise<AgentCapability> {
    return {
      agentId: this.agentId,
      supportsNonInteractive: true,
      supportsStructuredOutput: true,
      supportsCwd: true,
      supportsAutoApproveFlags: false,
      supportsStreaming: false,
      supportsActionPlanning: true,
      supportsResume: false,
      supportedCapabilities: ["planning"],
      defaultProfileId: "default",
    };
  }

  async planInvocation(task: TaskSpec): Promise<InvocationPlan> {
    return {
      taskId: task.id,
      agentId: this.agentId,
      command: "node",
      args: ["-e", "process.stdout.write('phase8');"],
      cwd: task.workingDirectory,
      actionPlans: [],
    };
  }

  async *run(_runId: string, _invocation: InvocationPlan): AsyncIterable<RunEvent> {
    return;
  }

  async interrupt(): Promise<void> {
    return;
  }
}

function buildExecutionRuntime(options: {
  eventStore: FileEventStore;
  onExecute?: (task: TaskSpec) => Promise<void>;
  finalPayload?: Record<string, unknown>;
  terminalEventsByTaskId?: Record<
    string,
    Array<{
      type: "task_completed" | "task_failed";
      payload?: Record<string, unknown>;
    }>
  >;
}) {
  const attemptsByTaskId = new Map<string, number>();

  return {
    async *execute(runId: string, task: TaskSpec, invocation: InvocationPlan): AsyncIterable<RunEvent> {
      await options.onExecute?.(task);
      const sequence = options.terminalEventsByTaskId?.[task.id];
      const attemptIndex = attemptsByTaskId.get(task.id) ?? 0;
      attemptsByTaskId.set(task.id, attemptIndex + 1);
      const configuredTerminalEvent =
        sequence && sequence.length > 0
          ? sequence[Math.min(attemptIndex, sequence.length - 1)]
          : null;
      const terminalType = configuredTerminalEvent?.type ?? "task_completed";
      const terminalPayload = configuredTerminalEvent?.payload ?? options.finalPayload ?? {};
      const events: RunEvent[] = [
        {
          schemaVersion: 1,
          id: `evt-start-${task.id}`,
          type: "task_started",
          runId,
          taskId: task.id,
          timestamp: "2026-03-11T15:00:00.000Z",
          payload: {
            agentId: invocation.agentId,
            command: invocation.command,
            args: invocation.args,
            cwd: invocation.cwd,
          },
        },
        {
          schemaVersion: 1,
          id: `evt-terminal-${task.id}-${attemptIndex + 1}`,
          type: terminalType,
          runId,
          taskId: task.id,
          timestamp: "2026-03-11T15:00:01.000Z",
          payload: {
            agentId: invocation.agentId,
            ...(terminalType === "task_completed" ? { exitCode: 0 } : {}),
            ...terminalPayload,
          },
        },
      ];

      for (const event of events) {
        await options.eventStore.append(event);
        yield event;
      }
    },
    async interrupt(): Promise<void> {
      return;
    },
  };
}

export async function setupPhase8App(options: {
  taskOverrides: Partial<TaskSpec>;
  onExecute?: (task: TaskSpec) => Promise<void>;
  finalPayload?: Record<string, unknown>;
  terminalEventsByTaskId?: Record<
    string,
    Array<{
      type: "task_completed" | "task_failed";
      payload?: Record<string, unknown>;
    }>
  >;
}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase8-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "phase8", "utf8");

  const task = buildTask(workspaceDir, options.taskOverrides);
  const config = buildConfig(workspaceDir);
  const registry = new AdapterRegistry();
  registry.register(new ValidationTestAdapter("codex"));
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    planner: new SingleTaskPlanner(task),
    adapterRegistry: registry,
    eventStore,
    executionRuntime: buildExecutionRuntime({
      eventStore,
      onExecute: options.onExecute,
      finalPayload: options.finalPayload,
      terminalEventsByTaskId: options.terminalEventsByTaskId,
    }),
    configLoader: {
      async load(): Promise<MultiAgentConfig> {
        return config;
      },
    },
    projectMemoryStore: {
      async recall() {
        return [];
      },
      async persist() {
        return;
      },
    },
  });

  return {
    app,
    stateRootDir,
    task,
  };
}
