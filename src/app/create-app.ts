import type {
  GraphPatch,
  TaskSpec,
} from "../domain/models.js";
import { FileConfigLoader } from "../config/file-config-loader.js";
import type { Planner, PlannerInput, ReplanInput } from "../decision/planner.js";
import type { ConfigLoader } from "../control/entrypoint.js";
import { Entrypoint } from "../control/entrypoint.js";
import { GraphManager } from "../control/graph-manager.js";
import {
  RunCoordinator,
  type RunCoordinatorDependencies,
} from "../control/run-coordinator.js";
import { FileEventStore } from "../storage/event-store.js";
import {
  FileProjectMemoryStore,
} from "../storage/project-memory-store.js";
import { FileRunStore } from "../storage/run-store.js";
import { FileSessionStore } from "../storage/session-store.js";
import { createId, resolvePath } from "../shared/runtime.js";

export interface AppDependencies extends RunCoordinatorDependencies {
  configLoader: ConfigLoader;
}

export interface AppContainer {
  entrypoint: Entrypoint;
  runCoordinator: RunCoordinator;
  graphManager: GraphManager;
  dependencies: AppDependencies;
}

export function createApp(
  overrides: Partial<AppDependencies> & { stateRootDir?: string } = {},
): AppContainer {
  const graphManager = overrides.graphManager ?? new GraphManager();
  const planner = overrides.planner ?? new StaticPlanner();
  const stateRootDir = overrides.stateRootDir ?? resolvePath(".multi-agent/state");
  const runStore = overrides.runStore ?? new FileRunStore(stateRootDir);
  const eventStore = overrides.eventStore ?? new FileEventStore(stateRootDir);
  const sessionStore = overrides.sessionStore ?? new FileSessionStore(stateRootDir);
  const projectMemoryStore =
    overrides.projectMemoryStore ??
    new FileProjectMemoryStore(resolvePath(".multi-agent/memory"));
  const configLoader = overrides.configLoader ?? new FileConfigLoader();

  const dependencies: AppDependencies = {
    ...overrides,
    configLoader,
    planner,
    graphManager,
    runStore,
    eventStore,
    sessionStore,
    projectMemoryStore,
  };

  const runCoordinator = new RunCoordinator(dependencies);

  return {
    entrypoint: new Entrypoint(configLoader, runCoordinator),
    runCoordinator,
    graphManager,
    dependencies,
  };
}

function normalizeGoal(goal: string): string {
  const trimmed = goal.trim();
  return trimmed.length > 0 ? trimmed : "Complete the requested task.";
}

function buildInitialTaskTitle(goal: string): string {
  const compact = goal.replace(/\s+/g, " ").trim();
  if (compact.length <= 72) {
    return compact;
  }
  return `${compact.slice(0, 69)}...`;
}

function inferExpectedArtifacts(goal: string): string[] {
  const normalized = goal.toLowerCase();
  if (normalized.includes("poem") || normalized.includes("诗")) {
    return ["Poem text output (plain text)."];
  }
  if (
    normalized.includes("readme") ||
    normalized.includes("document") ||
    normalized.includes("文档")
  ) {
    return ["Documentation update that addresses the requested goal."];
  }
  if (
    normalized.includes("code") ||
    normalized.includes("fix") ||
    normalized.includes("代码")
  ) {
    return ["Implementation output with the requested code changes."];
  }
  return ["Deliverable output that directly completes the requested goal."];
}

export class StaticPlanner implements Planner {
  async createInitialPlan(input: PlannerInput): Promise<TaskSpec[]> {
    const normalizedGoal = normalizeGoal(input.goal);
    const taskTitle = buildInitialTaskTitle(normalizedGoal);

    return [
      {
        id: createId("task"),
        title: taskTitle,
        kind: "execute",
        goal: normalizedGoal,
        instructions: [
          `Deliver the requested outcome directly: ${normalizedGoal}`,
          "Keep the output concrete and ready to use instead of returning only a plan.",
        ],
        inputs: [`User goal: ${normalizedGoal}`],
        dependsOn: [],
        requiredCapabilities: ["planning"],
        workingDirectory: input.workspacePath,
        expectedArtifacts: inferExpectedArtifacts(normalizedGoal),
        acceptanceCriteria: [
          `The final output directly satisfies the user goal: ${normalizedGoal}`,
          "The response is complete and actionable without requiring follow-up placeholders.",
        ],
        validator: {
          mode: "none",
        },
        riskLevel: "low",
        allowedActions: [],
        timeoutMs: 60_000,
        retryPolicy: {
          maxAttempts: 1,
          backoffMs: 0,
          retryOn: [],
        },
        budget: undefined,
        preferredAgent: undefined,
        assignedAgent: undefined,
        status: "pending",
      },
    ];
  }

  async replan(_input: ReplanInput): Promise<GraphPatch> {
    return {
      operation: "append_tasks",
      reason: "Static planner does not provide replanning yet.",
      tasks: [],
    };
  }
}

