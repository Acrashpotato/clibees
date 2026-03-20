import type { RunRecord, TaskSpec } from "../domain/models.js";
import { FileEventStore } from "../storage/event-store.js";
import { createApp } from "../app/create-app.js";

export function buildWorkerTask(
  workspaceDir: string,
  taskId: string,
  status: TaskSpec["status"],
  dependsOn: string[],
  options: {
    title?: string;
    goal?: string;
    expectedArtifacts?: string[];
    skillArgs?: Record<string, unknown>;
  } = {},
): TaskSpec {
  const metadata =
    options.skillArgs && Object.keys(options.skillArgs).length > 0
      ? { skillArgs: options.skillArgs }
      : undefined;
  return {
    id: taskId,
    title: options.title ?? "Synthetic worker task",
    kind: "execute",
    goal: options.goal ?? "Synthetic delegated goal.",
    instructions: ["Synthetic delegated worker instructions."],
    inputs: ["Synthetic delegated worker inputs."],
    dependsOn,
    requiredCapabilities: ["planning"],
    preferredAgent: "cli-worker",
    assignedAgent: "cli-worker",
    workingDirectory: workspaceDir,
    expectedArtifacts: options.expectedArtifacts ?? ["output.txt"],
    acceptanceCriteria: ["Synthetic delegated worker acceptance."],
    validator: { mode: "none" },
    riskLevel: "low",
    allowedActions: [],
    timeoutMs: 300_000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: [],
    },
    ...(metadata ? { metadata } : {}),
    status,
  };
}

export async function setupStaleRunningRun(params: {
  app: ReturnType<typeof createApp>;
  runId: string;
  workspaceDir: string;
  eventStore: FileEventStore;
}): Promise<{ staleTask: TaskSpec }> {
  const graph = await params.app.dependencies.runStore.getGraph(params.runId);
  const run = await params.app.dependencies.runStore.getRun(params.runId);
  if (!graph || !run) {
    throw new Error(`Run "${params.runId}" was not found.`);
  }
  const managerTask = Object.values(graph.tasks).find(
    (task) =>
      task.kind === "plan" &&
      task.requiredCapabilities.includes("delegation"),
  );
  if (!managerTask) {
    throw new Error("Delegation manager task was not found.");
  }

  const staleTask = buildWorkerTask(
    params.workspaceDir,
    "task-stale-running-worker",
    "running",
    [managerTask.id],
    {
      title: "Stale running worker",
      goal: "Simulate a running task that lost orchestrator control.",
      expectedArtifacts: ["stale-output.txt"],
    },
  );
  const staleTimestamp = "2000-01-01T00:00:00.000Z";
  await params.app.dependencies.runStore.saveGraph(params.runId, {
    ...graph,
    tasks: {
      ...graph.tasks,
      [staleTask.id]: staleTask,
    },
    readyQueue: graph.readyQueue.filter((taskId) => taskId !== staleTask.id),
  });
  await params.app.dependencies.runStore.updateTaskStatus(params.runId, staleTask.id, {
    status: "running",
    startedAt: staleTimestamp,
  });
  await params.app.dependencies.runStore.updateRun({
    ...run,
    status: "running",
    currentTaskId: staleTask.id,
    updatedAt: staleTimestamp,
  });
  await params.eventStore.append({
    schemaVersion: 1,
    id: "evt-stale-running-health-check",
    type: "task_started",
    runId: params.runId,
    taskId: staleTask.id,
    timestamp: staleTimestamp,
    payload: {
      agentId: "cli-worker",
      command: "node",
      args: ["-e", "process.stdout.write('stale');"],
      cwd: params.workspaceDir,
    },
  });

  return { staleTask };
}
