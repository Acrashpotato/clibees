import type { AgentConfig, AgentProfileConfig, MultiAgentConfig } from "../../../domain/config.js";
import type { RunGraph, RunRecord, TaskSpec, TaskStatus } from "../../../domain/models.js";
import { SELECTED_CLI_VALUES, type SelectedCli } from "../../../ui-api/selected-cli.js";
import { DEFAULT_TASK_TIMEOUT_MS } from "../core.js";

export function resolvePlannerMode(
  metadata: Record<string, unknown> | undefined,
): "static" | "delegated" {
  return metadata?.plannerMode === "delegated" ? "delegated" : "static";
}

export function applyWorkspaceWritePolicyOverride(
  config: MultiAgentConfig,
  metadata: Record<string, unknown> | undefined,
): MultiAgentConfig {
  const allowOutsideWorkspaceWrites = readOptionalBoolean(
    metadata?.allowOutsideWorkspaceWrites,
  );
  if (allowOutsideWorkspaceWrites === undefined) {
    return config;
  }

  return {
    ...config,
    workspace: {
      ...config.workspace,
      allowOutsideWorkspaceWrites,
    },
  };
}

export function shouldUseDelegatedBootstrap(
  metadata: Record<string, unknown> | undefined,
): boolean {
  if (resolvePlannerMode(metadata) !== "delegated") {
    return false;
  }

  const selectedCli = resolveSelectedCli(metadata?.selectedCli);
  if (!selectedCli) {
    return true;
  }

  const plannerAgentId = readNonEmptyString(metadata?.plannerAgentId);
  const configuredAgentIds = readStringArray(metadata?.agentIds);
  return (
    Boolean(plannerAgentId) &&
    plannerAgentId === selectedCli &&
    configuredAgentIds.includes(plannerAgentId)
  );
}

export function buildDelegationTaskTitle(goal: string): string {
  const compactGoal = goal.replace(/\s+/g, " ").trim();
  if (!compactGoal) {
    return "Manager dispatch";
  }
  return compactGoal.length <= 72
    ? `Manager dispatch: ${compactGoal}`
    : `Manager dispatch: ${compactGoal.slice(0, 69)}...`;
}

export function buildDelegationManagerGoal(
  goal: string,
  workerAgentIds: string[],
  availableSkills: string[] = [],
): string {
  const workerLine =
    workerAgentIds.length > 0
      ? `Prefer assigning preferredAgent from this list: ${workerAgentIds.join(", ")}.`
      : "Assign preferredAgent only if a worker id is known.";

  return [
    "You are the CLI manager.",
    "Coordinate work and return JSON only.",
    "Response format:",
    "{\"managerReply\":\"...\",\"managerDecision\":\"continue|no_more_tasks\",\"delegatedTasks\":[{\"title\":\"...\",\"goal\":\"...\",\"skillId\":\"...\",\"skillArgs\":{\"k\":\"v\"},\"preferredAgent\":\"...\",\"dependsOn\":[\"upstream task title\"],\"instructions\":[\"...\"],\"requiredCapabilities\":[\"planning\"],\"expectedArtifacts\":[\"...\"],\"acceptanceCriteria\":[\"...\"]}]}",
    "Rules:",
    "- Return a valid JSON object.",
    "- managerDecision must be either continue or no_more_tasks.",
    "- If managerDecision is no_more_tasks, return delegatedTasks as an empty array.",
    "- If managerDecision is continue, delegatedTasks should contain concrete worker tasks.",
    "- Prefer setting skillId for delegatedTasks when a known workflow skill applies.",
    "- skillArgs is optional and should only include task-specific parameters.",
    "- Use dependsOn when one delegated task must wait for another delegated task.",
    "- In dependsOn, reference delegatedTasks by their title exactly as returned in this same JSON response.",
    "- managerReply should summarize what to do next for the user and workers.",
    "- Do not include markdown fences or extra prose.",
    ...(availableSkills.length > 0
      ? [
          `Available skills: ${availableSkills.join(", ")}.`,
          "Prefer available skills before inventing ad-hoc process templates.",
        ]
      : []),
    workerLine,
    `User goal: ${goal}`,
  ].join("\n");
}

export function isDelegationManagerTask(task: TaskSpec): boolean {
  return (
    task.kind === "plan" &&
    task.requiredCapabilities.includes("planning") &&
    task.requiredCapabilities.includes("delegation")
  );
}

export function isManagerCoordinationTask(task: TaskSpec): boolean {
  return (
    isDelegationManagerTask(task) &&
    task.title.toLowerCase().includes("manager coordination")
  );
}

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>([
  "completed",
  "failed_terminal",
  "blocked",
  "cancelled",
]);

export function isTaskTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

export function getActiveDelegationManagerTaskIds(graph: RunGraph): string[] {
  return Object.values(graph.tasks)
    .filter(
      (task) =>
        isDelegationManagerTask(task) &&
        !isTaskTerminalStatus(task.status),
    )
    .map((task) => task.id);
}

export function getActiveManagerCoordinationTaskIds(graph: RunGraph): string[] {
  return Object.values(graph.tasks)
    .filter(
      (task) =>
        isManagerCoordinationTask(task) &&
        !isTaskTerminalStatus(task.status),
    )
    .map((task) => task.id);
}

export function countActiveManagerCoordinationTasks(graph: RunGraph): number {
  return getActiveManagerCoordinationTaskIds(graph).length;
}

export function hasActiveDelegationManagerTask(graph: RunGraph): boolean {
  return getActiveDelegationManagerTaskIds(graph).length > 0;
}

export function isTerminalRunStatus(status: RunRecord["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function isAutoResumableRunStatus(status: RunRecord["status"]): boolean {
  return status === "ready" || status === "paused" || status === "waiting_approval";
}

export function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => readNonEmptyString(item))
    .filter((item): item is string => Boolean(item));
}

export function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function dedupeAgentConfigs(agents: AgentConfig[]): AgentConfig[] {
  const byId = new Map<string, AgentConfig>();
  for (const agent of agents) {
    if (!byId.has(agent.id)) {
      byId.set(agent.id, agent);
    }
  }
  return [...byId.values()];
}

export function isAgentCompatibleWithCapabilities(
  agent: AgentConfig | undefined,
  requiredCapabilities: string[],
): boolean {
  if (!agent) {
    return false;
  }
  return agent.profiles.some((profile) =>
    requiredCapabilities.every((capability) =>
      profile.capabilities.includes(capability),
    ),
  );
}

export function hasCompatibleWorkerForCapabilities(
  agents: AgentConfig[],
  plannerAgentId: string | undefined,
  requiredCapabilities: string[],
): boolean {
  return agents.some(
    (agent) =>
      agent.id !== plannerAgentId &&
      isAgentCompatibleWithCapabilities(agent, requiredCapabilities),
  );
}

export function pickWorkerAgentForCapabilities(options: {
  requiredCapabilities: string[];
  preferredAgentCandidate?: string;
  defaultWorkerAgentId?: string;
  knownAgentIds: string[];
  plannerAgentId?: string;
  agents: AgentConfig[];
}): string | undefined {
  const compatibleWorkerIds = options.knownAgentIds.filter(
    (agentId) =>
      agentId !== options.plannerAgentId &&
      isAgentCompatibleWithCapabilities(
        options.agents.find((agent) => agent.id === agentId),
        options.requiredCapabilities,
      ),
  );

  if (
    options.preferredAgentCandidate &&
    compatibleWorkerIds.includes(options.preferredAgentCandidate)
  ) {
    return options.preferredAgentCandidate;
  }
  if (
    options.defaultWorkerAgentId &&
    compatibleWorkerIds.includes(options.defaultWorkerAgentId)
  ) {
    return options.defaultWorkerAgentId;
  }
  if (compatibleWorkerIds.length > 0) {
    return compatibleWorkerIds[0];
  }
  if (
    options.preferredAgentCandidate &&
    options.knownAgentIds.includes(options.preferredAgentCandidate)
  ) {
    return options.preferredAgentCandidate;
  }
  return (
    options.defaultWorkerAgentId ??
    options.knownAgentIds.find((agentId) => agentId !== options.plannerAgentId)
  );
}

export function toCapabilitySlug(capabilities: string[]): string {
  const normalized = capabilities
    .map((capability) => capability.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
    .map((capability) => capability.replace(/^-+|-+$/g, ""))
    .filter((capability) => capability.length > 0);
  return normalized.join("-") || "planning";
}

export function mergeDynamicAgentsIntoConfig(
  sourceConfig: MultiAgentConfig,
  metadata: Record<string, unknown>,
): MultiAgentConfig {
  const dynamicAgents = readDynamicAgents(metadata.dynamicAgents);
  if (dynamicAgents.length === 0) {
    return sourceConfig;
  }

  const existingAgentIds = new Set(sourceConfig.agents.map((agent) => agent.id));
  const mergedAgents = [...sourceConfig.agents];
  for (const dynamicAgent of dynamicAgents) {
    if (existingAgentIds.has(dynamicAgent.id)) {
      continue;
    }
    mergedAgents.push(dynamicAgent);
    existingAgentIds.add(dynamicAgent.id);
  }

  return mergedAgents.length === sourceConfig.agents.length
    ? sourceConfig
    : {
        ...sourceConfig,
        agents: mergedAgents,
      };
}

export function readDynamicAgents(value: unknown): AgentConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: AgentConfig[] = [];
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
      typeof candidate.priority === "number" &&
      Number.isFinite(candidate.priority)
        ? Math.floor(candidate.priority)
        : undefined;
    parsed.push({
      id,
      command,
      ...(priority !== undefined ? { priority } : {}),
      profiles,
    });
  }

  return dedupeAgentConfigs(parsed);
}

export function readAgentProfiles(value: unknown): AgentProfileConfig[] {
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
    const costTier = normalizeCostTier(candidate.costTier);
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

export function normalizeCostTier(value: unknown): AgentProfileConfig["costTier"] | undefined {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : undefined;
}

export function normalizeRiskLevel(value: unknown): TaskSpec["riskLevel"] {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "low";
}

export function normalizeTimeoutMs(
  value: unknown,
  fallbackMs = DEFAULT_TASK_TIMEOUT_MS,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallbackMs;
  }
  return Math.floor(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveSelectedCli(value: unknown): SelectedCli | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();
  if (isSelectedCli(normalizedValue)) {
    return normalizedValue;
  }

  return undefined;
}

export function shouldFallbackToDefaultSelectedCli(
  metadata: Record<string, unknown>,
): boolean {
  return (
    metadata.selectedCli === undefined &&
    metadata.plannerMode === undefined &&
    metadata.plannerAgentId === undefined &&
    metadata.agentIds === undefined
  );
}

export function shouldKeepDelegatedConfigForSelectedCli(
  metadata: Record<string, unknown>,
  selectedCli: SelectedCli,
  sourceConfig: MultiAgentConfig,
): boolean {
  const plannerAgentId = readNonEmptyString(metadata.plannerAgentId);
  if (!plannerAgentId || plannerAgentId !== selectedCli) {
    return false;
  }

  const configuredAgentIds = readStringArray(metadata.agentIds);
  if (!configuredAgentIds.includes(plannerAgentId)) {
    return false;
  }

  const availableAgentIds = new Set(sourceConfig.agents.map((agent) => agent.id));
  if (!availableAgentIds.has(plannerAgentId)) {
    return false;
  }

  return configuredAgentIds.some(
    (agentId) => agentId !== plannerAgentId && availableAgentIds.has(agentId),
  );
}

export function isSelectedCli(value: string): value is SelectedCli {
  return (SELECTED_CLI_VALUES as readonly string[]).includes(value);
}

