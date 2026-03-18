import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createApp } from "../app/create-app.js";
import type { MultiAgentConfig } from "../domain/config.js";
import type {
  ActionPlan,
  AgentCapability,
  ContextBundle,
  InvocationPlan,
  RunEvent,
  TaskSpec,
} from "../domain/models.js";
import type { Planner, PlannerInput, ReplanInput } from "../decision/planner.js";
import type { Validator } from "../decision/validator.js";
import { AdapterRegistry } from "../execution/adapter-registry.js";
import type { AgentAdapter } from "../execution/agent-adapter.js";
import { FileEventStore } from "../storage/event-store.js";

export function buildTask(workspaceDir: string, overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "task-default",
    title: "Phase 9 task",
    kind: "execute",
    goal: "Exercise Phase 9",
    instructions: ["Execute the task"],
    inputs: [],
    dependsOn: [],
    requiredCapabilities: ["planning"],
    workingDirectory: workspaceDir,
    expectedArtifacts: [],
    acceptanceCriteria: ["Task completes"],
    validator: { mode: "none" },
    riskLevel: "low",
    allowedActions: [],
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 0,
      retryOn: ["validation_fail"],
    },
    status: "ready",
    ...overrides,
  };
}

function buildConfig(
  workspaceDir: string,
  overrides: Partial<MultiAgentConfig> = {},
): MultiAgentConfig {
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
    ...overrides,
  };
}

class Phase9Planner implements Planner {
  constructor(
    private readonly tasks: TaskSpec[],
    private readonly replanPatch = {
      operation: "append_tasks" as const,
      reason: "No replanning configured.",
      tasks: [] as TaskSpec[],
    },
  ) {}

  async createInitialPlan(_input: PlannerInput): Promise<TaskSpec[]> {
    return this.tasks.map((task) => ({ ...task }));
  }

  async replan(_input: ReplanInput) {
    return {
      ...this.replanPatch,
      tasks: this.replanPatch.tasks.map((task) => ({ ...task })),
    };
  }
}

class Phase9Adapter implements AgentAdapter {
  constructor(
    public readonly agentId: string,
    private readonly actionPlansByTaskId: Record<string, ActionPlan[]> = {},
  ) {}

  async probe(): Promise<AgentCapability> {
    return {
      agentId: this.agentId,
      supportsNonInteractive: true,
      supportsStructuredOutput: true,
      supportsCwd: true,
      supportsAutoApproveFlags: false,
      supportsStreaming: true,
      supportsActionPlanning: true,
      supportsResume: false,
      supportedCapabilities: ["planning"],
      defaultProfileId: "default",
    };
  }

  async planInvocation(
    task: TaskSpec,
    _context: ContextBundle,
  ): Promise<InvocationPlan> {
    return {
      taskId: task.id,
      agentId: this.agentId,
      command: "node",
      args: ["-e", `process.stdout.write(${JSON.stringify(task.id)});`],
      cwd: task.workingDirectory,
      actionPlans: (this.actionPlansByTaskId[task.id] ?? []).map((action) => ({
        ...action,
      })),
    };
  }

  async *run(): AsyncIterable<RunEvent> {
    return;
  }

  async interrupt(): Promise<void> {
    return;
  }
}

function buildExecutionRuntime(options: {
  eventStore: FileEventStore;
  onExecute?: (task: TaskSpec) => Promise<void>;
  finalPayloadByTaskId?: Record<string, Record<string, unknown>>;
  executionCounter?: { count: number };
}): NonNullable<ReturnType<typeof createApp>["dependencies"]["executionRuntime"]> {
  return {
    async *execute(runId, task, invocation): AsyncIterable<RunEvent> {
      options.executionCounter && (options.executionCounter.count += 1);
      await options.onExecute?.(task);
      const finalPayload = options.finalPayloadByTaskId?.[task.id] ?? {};
      const events: RunEvent[] = [
        {
          schemaVersion: 1,
          id: `evt-start-${task.id}`,
          type: "task_started",
          runId,
          taskId: task.id,
          timestamp: "2026-03-12T10:00:00.000Z",
          payload: {
            agentId: invocation.agentId,
            command: invocation.command,
            args: invocation.args,
            cwd: invocation.cwd,
          },
        },
        {
          schemaVersion: 1,
          id: `evt-complete-${task.id}`,
          type: "task_completed",
          runId,
          taskId: task.id,
          timestamp: "2026-03-12T10:00:01.000Z",
          payload: {
            agentId: invocation.agentId,
            exitCode: 0,
            ...finalPayload,
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

export async function setupPhase9App(options: {
  tasks: TaskSpec[];
  replanTasks?: TaskSpec[];
  actionPlansByTaskId?: Record<string, ActionPlan[]>;
  validator?: Validator;
  onExecute?: (task: TaskSpec) => Promise<void>;
  finalPayloadByTaskId?: Record<string, Record<string, unknown>>;
  configOverrides?: Partial<MultiAgentConfig>;
}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase9-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "phase9", "utf8");

  const tasks = options.tasks.map((task) => ({ ...task, workingDirectory: workspaceDir }));
  const replanTasks = options.replanTasks?.map((task) => ({
    ...task,
    workingDirectory: workspaceDir,
  }));
  const config = buildConfig(workspaceDir, options.configOverrides);
  const planner = new Phase9Planner(
    tasks,
    replanTasks
      ? {
          operation: "append_tasks" as const,
          reason: "Validation requested a follow-up task.",
          tasks: replanTasks,
        }
      : undefined,
  );
  const registry = new AdapterRegistry();
  registry.register(
    new Phase9Adapter("codex", options.actionPlansByTaskId),
  );
  const eventStore = new FileEventStore(stateRootDir);
  const executionCounter = { count: 0 };
  const app = createApp({
    stateRootDir,
    planner,
    adapterRegistry: registry,
    eventStore,
    executionRuntime: buildExecutionRuntime({
      eventStore,
      onExecute: options.onExecute,
      finalPayloadByTaskId: options.finalPayloadByTaskId,
      executionCounter,
    }),
    validator: options.validator,
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
    workspaceDir,
    stateRootDir,
    executionCounter,
  };
}

export function workspaceDirPlaceholder(): string {
  return process.cwd();
}
