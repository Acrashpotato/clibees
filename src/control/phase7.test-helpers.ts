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
import { AdapterRegistry } from "../execution/adapter-registry.js";
import type { AgentAdapter } from "../execution/agent-adapter.js";
import { FileEventStore } from "../storage/event-store.js";

function buildTask(workspaceDir: string, overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "task-phase7",
    title: "Phase 7 task",
    kind: "execute",
    goal: "Exercise the safety and approval chain",
    instructions: ["Review actions", "Request approval when needed", "Execute if approved"],
    inputs: [],
    dependsOn: [],
    requiredCapabilities: ["planning"],
    workingDirectory: workspaceDir,
    expectedArtifacts: [],
    acceptanceCriteria: ["Safety review and approval flow is enforced"],
    validator: { mode: "none" },
    riskLevel: "low",
    allowedActions: [],
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: [],
    },
    status: "ready",
    ...overrides,
  };
}

function buildConfig(
  workspaceDir: string,
  safety: MultiAgentConfig["safety"],
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
    safety,
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
      reason: "Phase 7 tests do not replan.",
      tasks: [],
    };
  }
}

class ApprovalTestAdapter implements AgentAdapter {
  constructor(
    public readonly agentId: string,
    private readonly actionPlans: ActionPlan[],
  ) {}

  async probe(): Promise<AgentCapability> {
    return {
      agentId: this.agentId,
      supportsNonInteractive: true,
      supportsStructuredOutput: false,
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
      args: ["-e", "process.stdout.write('phase7');"],
      cwd: task.workingDirectory,
      actionPlans: this.actionPlans.map((action) => ({
        ...action,
        taskId: undefined,
      })) as ActionPlan[],
    };
  }

  async *run(): AsyncIterable<RunEvent> {
    return;
  }

  async interrupt(): Promise<void> {
    return;
  }
}

function buildExecutionRuntime(
  eventStore: FileEventStore,
  counter: { count: number },
): NonNullable<ReturnType<typeof createApp>["dependencies"]["executionRuntime"]> {
  return {
    async *execute(runId, task, invocation): AsyncIterable<RunEvent> {
      counter.count += 1;
      const events: RunEvent[] = [
        {
          schemaVersion: 1,
          id: `evt-start-${counter.count}`,
          type: "task_started",
          runId,
          taskId: task.id,
          timestamp: "2026-03-11T14:00:00.000Z",
          payload: {
            agentId: invocation.agentId,
            command: invocation.command,
            args: invocation.args,
            cwd: invocation.cwd,
          },
        },
        {
          schemaVersion: 1,
          id: `evt-complete-${counter.count}`,
          type: "task_completed",
          runId,
          taskId: task.id,
          timestamp: "2026-03-11T14:00:01.000Z",
          payload: {
            agentId: invocation.agentId,
            exitCode: 0,
          },
        },
      ];

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

export async function setupPhase7App(options: {
  safety: MultiAgentConfig["safety"];
  actionPlans: ActionPlan[];
  taskOverrides?: Partial<TaskSpec>;
}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase7-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "phase7.txt"), "phase7", "utf8");

  const config = buildConfig(workspaceDir, options.safety);
  const task = buildTask(workspaceDir, options.taskOverrides);
  const registry = new AdapterRegistry();
  registry.register(new ApprovalTestAdapter("codex", options.actionPlans));
  const eventStore = new FileEventStore(stateRootDir);
  const executionCounter = { count: 0 };
  const app = createApp({
    stateRootDir,
    planner: new SingleTaskPlanner(task),
    adapterRegistry: registry,
    eventStore,
    executionRuntime: buildExecutionRuntime(eventStore, executionCounter),
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
    executionCounter,
    task,
  };
}
