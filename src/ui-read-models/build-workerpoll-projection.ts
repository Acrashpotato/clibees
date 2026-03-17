import type { AgentConfig, AgentProfileConfig } from "../domain/config.js";
import type { RunInspection, TaskSpec } from "../domain/models.js";
import type {
  WorkerpollProjectionView,
  WorkerpollTaskMatchStatus,
  WorkerpollWorkerView,
} from "./models.js";
import { mapRunStatus, mapTaskStatus, resolveTaskId } from "./task-view-helpers.js";

export interface BuildWorkerpollProjectionInput {
  configuredAgents: AgentConfig[];
}

export function buildWorkerpollProjection(
  inspection: RunInspection,
  input: BuildWorkerpollProjectionInput,
): WorkerpollProjectionView {
  const plannerAgentId = readNonEmptyString(inspection.run.metadata?.plannerAgentId);
  const workers = collectWorkers(
    inspection.run.metadata,
    input.configuredAgents,
    plannerAgentId,
  );
  const workerCapabilities = new Set(
    workers.flatMap((worker) => worker.capabilities),
  );
  const workerById = new Set(workers.map((worker) => worker.agentId));

  const tasks = Object.values(inspection.graph.tasks)
    .map((task) =>
      buildTaskView(task, inspection, {
        workers,
        workerById,
        workerCapabilities,
      }))
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));

  return {
    projection: "workerpoll",
    generatedAt: new Date().toISOString(),
    run: {
      runId: inspection.run.runId,
      goal: inspection.run.goal,
      status: mapRunStatus(inspection.run.status),
      ...(plannerAgentId ? { plannerAgentId } : {}),
      createdAt: inspection.run.createdAt,
      updatedAt: inspection.run.updatedAt,
    },
    summary: {
      taskCount: tasks.length,
      workerCount: workers.length,
      dynamicWorkerCount: workers.filter((worker) => worker.source === "dynamic").length,
      uncoveredTaskCount: tasks.filter((task) => task.matchStatus === "capability_gap").length,
    },
    workers,
    tasks,
  };
}

function buildTaskView(
  task: TaskSpec,
  inspection: RunInspection,
  context: {
    workers: WorkerpollWorkerView[];
    workerById: Set<string>;
    workerCapabilities: Set<string>;
  },
): WorkerpollProjectionView["tasks"][number] {
  const requiredCapabilities = dedupeStrings(task.requiredCapabilities);
  const compatibleWorkers = context.workers
    .filter((worker) =>
      requiredCapabilities.every((capability) =>
        worker.capabilities.includes(capability),
      ))
    .map((worker) => worker.agentId);
  const missingCapabilities = requiredCapabilities.filter(
    (capability) => !context.workerCapabilities.has(capability),
  );
  const selectedWorker = task.assignedAgent ?? task.preferredAgent;
  const matchStatus = resolveTaskMatchStatus({
    selectedWorker,
    compatibleWorkers,
    missingCapabilities,
    workerById: context.workerById,
  });

  return {
    taskId: task.id,
    title: task.title,
    kind: task.kind,
    status: mapTaskStatus(task.status),
    requiredCapabilities,
    compatibleWorkers,
    missingCapabilities,
    ...(task.preferredAgent ? { preferredAgent: task.preferredAgent } : {}),
    ...(task.assignedAgent ? { assignedAgent: task.assignedAgent } : {}),
    ...(selectedWorker ? { selectedWorker } : {}),
    dependsOn: [...task.dependsOn],
    matchStatus,
    lastActivityAt: resolveLastActivityAt(inspection, task.id),
  };
}

function resolveTaskMatchStatus(options: {
  selectedWorker?: string;
  compatibleWorkers: string[];
  missingCapabilities: string[];
  workerById: Set<string>;
}): WorkerpollTaskMatchStatus {
  if (options.missingCapabilities.length > 0) {
    return "capability_gap";
  }
  if (!options.selectedWorker) {
    return options.compatibleWorkers.length > 0 ? "unassigned" : "capability_gap";
  }
  if (!options.workerById.has(options.selectedWorker)) {
    return "mismatched";
  }
  return options.compatibleWorkers.includes(options.selectedWorker)
    ? "matched"
    : "mismatched";
}

function resolveLastActivityAt(inspection: RunInspection, taskId: string): string {
  const scopedEvents = inspection.events.filter((event) => resolveTaskId(event) === taskId);
  return scopedEvents.at(-1)?.timestamp ?? inspection.run.updatedAt;
}

function collectWorkers(
  metadata: Record<string, unknown> | undefined,
  configuredAgents: AgentConfig[],
  plannerAgentId: string | undefined,
): WorkerpollWorkerView[] {
  const byId = new Map<string, WorkerpollWorkerView>();
  const configuredById = new Map(configuredAgents.map((agent) => [agent.id, agent] as const));
  const dynamicById = new Map(readDynamicAgents(metadata?.dynamicAgents).map((agent) => [agent.id, agent] as const));
  const metadataAgentIds = readStringArray(metadata?.agentIds);

  for (const agent of configuredAgents) {
    if (agent.id === plannerAgentId) {
      continue;
    }
    byId.set(agent.id, toWorkerView(agent, "configured", plannerAgentId));
  }

  for (const agent of dynamicById.values()) {
    if (agent.id === plannerAgentId) {
      continue;
    }
    byId.set(agent.id, toWorkerView(agent, "dynamic", plannerAgentId));
  }

  for (const agentId of metadataAgentIds) {
    if (agentId === plannerAgentId) {
      continue;
    }
    if (byId.has(agentId)) {
      continue;
    }
    const candidate = dynamicById.get(agentId) ?? configuredById.get(agentId);
    byId.set(
      agentId,
      candidate
        ? toWorkerView(candidate, dynamicById.has(agentId) ? "dynamic" : "configured", plannerAgentId)
        : {
            agentId,
            source: "metadata",
            command: undefined,
            profileIds: [],
            capabilities: [],
            isPlanner: false,
          },
    );
  }

  return [...byId.values()].sort((left, right) => left.agentId.localeCompare(right.agentId));
}

function toWorkerView(
  agent: AgentConfig,
  source: WorkerpollWorkerView["source"],
  plannerAgentId: string | undefined,
): WorkerpollWorkerView {
  const capabilities = dedupeStrings(
    agent.profiles.flatMap((profile) => profile.capabilities),
  );
  return {
    agentId: agent.id,
    source,
    ...(agent.command ? { command: agent.command } : {}),
    profileIds: agent.profiles.map((profile) => profile.id),
    capabilities,
    isPlanner: agent.id === plannerAgentId,
    ...(typeof agent.priority === "number" ? { priority: agent.priority } : {}),
  };
}

function readDynamicAgents(value: unknown): AgentConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const agents: AgentConfig[] = [];
  for (const candidate of value) {
    if (!isPlainObject(candidate)) {
      continue;
    }
    const id = readNonEmptyString(candidate.id);
    const command = readNonEmptyString(candidate.command);
    if (!id || !command) {
      continue;
    }
    const profiles = readAgentProfiles(candidate.profiles);
    if (profiles.length === 0) {
      continue;
    }
    const priority =
      typeof candidate.priority === "number" && Number.isFinite(candidate.priority)
        ? Math.floor(candidate.priority)
        : undefined;
    agents.push({
      id,
      command,
      ...(priority !== undefined ? { priority } : {}),
      profiles,
    });
  }
  return agents;
}

function readAgentProfiles(value: unknown): AgentProfileConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const profiles: AgentProfileConfig[] = [];
  for (const candidate of value) {
    if (!isPlainObject(candidate)) {
      continue;
    }
    const id = readNonEmptyString(candidate.id);
    const label = readNonEmptyString(candidate.label);
    const capabilities = dedupeStrings(readStringArray(candidate.capabilities));
    const costTier =
      candidate.costTier === "low" ||
      candidate.costTier === "medium" ||
      candidate.costTier === "high"
        ? candidate.costTier
        : undefined;
    if (!id || !label || capabilities.length === 0 || !costTier) {
      continue;
    }
    const defaultArgs = readStringArray(candidate.defaultArgs);
    const defaultCwd = readNonEmptyString(candidate.defaultCwd);
    profiles.push({
      id,
      label,
      capabilities,
      ...(defaultArgs.length > 0 ? { defaultArgs } : {}),
      ...(defaultCwd ? { defaultCwd } : {}),
      costTier,
    });
  }
  return profiles;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => readNonEmptyString(item))
    .filter((item): item is string => Boolean(item));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

