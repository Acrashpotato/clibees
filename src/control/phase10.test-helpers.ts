import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { MultiAgentConfig } from "../domain/config.js";
import type {
  ActionPlan,
  AgentCapability,
  ContextBundle,
  InvocationPlan,
  MemoryRecord,
  RunEvent,
  RunGraph,
  RunInspection,
  RunRecord,
  TaskSpec,
  ValidationResult,
} from "../domain/models.js";
import type { Planner, PlannerInput, ReplanInput } from "../decision/planner.js";
import type { ValidationInput, Validator } from "../decision/validator.js";
import { createApp } from "../app/create-app.js";
import { ConfiguredCliAdapter } from "../adapters/configured-cli-adapter.js";
import { MemoryConsolidator } from "./memory-consolidator.js";
import { AdapterRegistry } from "../execution/adapter-registry.js";
import type { AgentAdapter } from "../execution/agent-adapter.js";
import { FileEventStore } from "../storage/event-store.js";
import { FileProjectMemoryStore } from "../storage/project-memory-store.js";

class Phase10Planner implements Planner {
  constructor(private readonly tasks: TaskSpec[]) {}

  async createInitialPlan(_input: PlannerInput): Promise<TaskSpec[]> {
    return this.tasks.map((task) => ({ ...task }));
  }

  async replan(_input: ReplanInput) {
    return {
      operation: "append_tasks" as const,
      reason: "Phase 10 tests do not replan.",
      tasks: [],
    };
  }
}

class Phase10Adapter implements AgentAdapter {
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
      supportsStreaming: false,
      supportsActionPlanning: true,
      supportsResume: false,
      supportedCapabilities: ["planning"],
      defaultProfileId: "default",
    };
  }

  async planInvocation(task: TaskSpec, _context: ContextBundle): Promise<InvocationPlan> {
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

export function buildTask(workspaceDir: string, overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "task-phase10",
    title: "Phase 10 task",
    kind: "execute",
    goal: "Exercise Phase 10 inspect and memory flow",
    instructions: ["Execute the task", "Wait for approval when required"],
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
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: [],
    },
    status: "ready",
    ...overrides,
  };
}

export function buildConfig(
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
      enabled: true,
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

export function buildExecutionRuntime(options: {
  eventStore: FileEventStore;
  finalPayloadByTaskId?: Record<string, Record<string, unknown>>;
}) {
  return {
    async *execute(runId: string, task: TaskSpec, invocation: InvocationPlan): AsyncIterable<RunEvent> {
      const finalPayload = options.finalPayloadByTaskId?.[task.id] ?? {};
      const events: RunEvent[] = [
        {
          schemaVersion: 1,
          id: `evt-start-${task.id}`,
          type: "task_started",
          runId,
          taskId: task.id,
          timestamp: "2026-03-12T13:00:00.000Z",
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
          timestamp: "2026-03-12T13:00:01.000Z",
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

export async function setupPhase10App(options: {
  tasks: TaskSpec[];
  actionPlansByTaskId?: Record<string, ActionPlan[]>;
  validationByTaskId?: Record<string, ValidationResult>;
  finalPayloadByTaskId?: Record<string, Record<string, unknown>>;
  configOverrides?: Partial<MultiAgentConfig>;
}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-phase10-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  const memoryRootDir = path.join(workspaceDir, ".multi-agent", "memory");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "phase10", "utf8");

  const tasks = options.tasks.map((task) => ({ ...task, workingDirectory: workspaceDir }));
  const config = buildConfig(workspaceDir, options.configOverrides);
  const registry = new AdapterRegistry();
  registry.register(new Phase10Adapter("codex", options.actionPlansByTaskId));
  const eventStore = new FileEventStore(stateRootDir);
  const projectMemoryStore = new FileProjectMemoryStore(memoryRootDir);
  const validator: Validator = {
    async validate(input: ValidationInput): Promise<ValidationResult> {
      return (
        options.validationByTaskId?.[input.task.id] ?? {
          outcome: "pass",
          summary: `Validated ${input.task.title}.`,
          details: [],
          createdArtifacts: [],
        }
      );
    },
  };

  const app = createApp({
    stateRootDir,
    planner: new Phase10Planner(tasks),
    adapterRegistry: registry,
    eventStore,
    executionRuntime: buildExecutionRuntime({
      eventStore,
      finalPayloadByTaskId: options.finalPayloadByTaskId,
    }),
    validator,
    projectMemoryStore,
    configLoader: {
      async load(): Promise<MultiAgentConfig> {
        return config;
      },
    },
  });

  return {
    app,
    workspaceDir,
    memoryRootDir,
    projectMemoryStore,
  };
}
