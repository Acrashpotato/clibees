import { ConfiguredCliAdapter } from "../../../adapters/configured-cli-adapter.js";
import {
RuleBasedRouter
} from "../../../decision/router.js";
import type {
AgentConfig,
AgentProfileConfig,
MultiAgentConfig,
} from "../../../domain/config.js";
import type {
RunRecord,
TaskSpec
} from "../../../domain/models.js";
import { isoNow } from "../../../shared/runtime.js";
import type { SkillDefinition } from "../../skills/types.js";
import type {
DelegatedTaskTemplate,
ExecutionServices
} from "../core.js";
import type { RunCoordinatorMethodThis } from "../internal-types.js";
import {
DEFAULT_DELEGATED_TASK_TIMEOUT_MS
} from "../core.js";
import {
buildDelegatedTaskInstructions,
dedupeAgentConfigs,
dedupeStrings,
hasCompatibleWorkerForCapabilities,
isPlainObject,
normalizeRiskLevel,
normalizeTimeoutMs,
pickWorkerAgentForCapabilities,
readDynamicAgents,
readNonEmptyString,
readStringArray,
resolveDelegatedWorkingDirectory,
resolveSelectedCli,
toCapabilitySlug
} from "../helpers/index.js";

export async function ensureCapabilityWorkersForDelegatedTasks(this: RunCoordinatorMethodThis,
  run: RunRecord,
  delegatedTemplates: DelegatedTaskTemplate[],
  config: MultiAgentConfig,
  services: ExecutionServices): Promise<{ run: RunRecord; config: MultiAgentConfig }> {
    if (delegatedTemplates.length === 0) {
      return { run, config };
    }

    const plannerAgentId =
      readNonEmptyString(run.metadata.plannerAgentId) ?? config.planner.agentId;
    let nextConfig = config;
    const existingAgentIds = new Set(nextConfig.agents.map((agent) => agent.id));
    const createdAgents: AgentConfig[] = [];

    for (const template of delegatedTemplates) {
      const requiredCapabilities = dedupeStrings(
        readStringArray(template.requiredCapabilities).length > 0
          ? readStringArray(template.requiredCapabilities)
          : ["planning"],
      );
      if (
        hasCompatibleWorkerForCapabilities(
          nextConfig.agents,
          plannerAgentId,
          requiredCapabilities,
        )
      ) {
        continue;
      }

      const worker = this.buildProvisionedWorkerAgent(
        run,
        nextConfig,
        plannerAgentId,
        requiredCapabilities,
        existingAgentIds,
      );
      if (!worker) {
        continue;
      }

      createdAgents.push(worker);
      existingAgentIds.add(worker.id);
      nextConfig = {
        ...nextConfig,
        agents: [...nextConfig.agents, worker],
      };
    }

    if (createdAgents.length === 0) {
      return { run, config: nextConfig };
    }

    const registeredAgentIds = new Set(
      services.adapterRegistry.list().map((adapter) => adapter.agentId),
    );
    for (const worker of createdAgents) {
      if (registeredAgentIds.has(worker.id)) {
        continue;
      }
      services.adapterRegistry.register(new ConfiguredCliAdapter(worker));
      registeredAgentIds.add(worker.id);
    }
    services.router = new RuleBasedRouter({
      adapterRegistry: services.adapterRegistry,
      agents: nextConfig.agents,
      routing: nextConfig.routing,
    });

    const existingMetadataAgentIds = readStringArray(run.metadata.agentIds);
    const existingDynamicAgents = readDynamicAgents(run.metadata.dynamicAgents);
    const nextRun: RunRecord = {
      ...run,
      metadata: {
        ...run.metadata,
        agentIds: dedupeStrings([
          ...existingMetadataAgentIds,
          ...createdAgents.map((agent) => agent.id),
        ]),
        dynamicAgents: dedupeAgentConfigs([
          ...existingDynamicAgents,
          ...createdAgents,
        ]),
      },
      updatedAt: isoNow(),
    };
    await this.dependencies.runStore.updateRun(nextRun);
    return {
      run: nextRun,
      config: nextConfig,
    };
  }

export function buildProvisionedWorkerAgent(this: RunCoordinatorMethodThis,
  run: RunRecord,
  config: MultiAgentConfig,
  plannerAgentId: string | undefined,
  requiredCapabilities: string[],
  existingAgentIds: Set<string>): AgentConfig | null {
    const selectedCli = resolveSelectedCli(run.metadata.selectedCli);
    const templateAgent =
      config.agents.find((agent) => selectedCli && agent.id === selectedCli) ??
      config.agents.find((agent) => plannerAgentId && agent.id !== plannerAgentId) ??
      config.agents.find((agent) => agent.id === plannerAgentId) ??
      config.agents[0];
    const templateProfile = templateAgent?.profiles[0];
    if (!templateAgent || !templateProfile) {
      return null;
    }

    const normalizedCapabilities = dedupeStrings([
      "planning",
      ...requiredCapabilities,
    ]);
    const capabilitySlug = toCapabilitySlug(normalizedCapabilities);
    const idBase = `${templateAgent.id}-worker-${capabilitySlug}`;
    let nextId = idBase;
    let suffix = 2;
    while (existingAgentIds.has(nextId)) {
      nextId = `${idBase}-${suffix}`;
      suffix += 1;
    }

    const workerProfile: AgentProfileConfig = {
      id: "worker",
      label: `Worker (${normalizedCapabilities.join(", ")})`,
      capabilities: normalizedCapabilities,
      ...(templateProfile.defaultArgs
        ? { defaultArgs: [...templateProfile.defaultArgs] }
        : {}),
      defaultCwd: templateProfile.defaultCwd ?? run.workspacePath,
      costTier: templateProfile.costTier,
    };

    return {
      id: nextId,
      command: templateAgent.command,
      ...(typeof templateAgent.priority === "number"
        ? { priority: templateAgent.priority + 1 }
        : {}),
      profiles: [workerProfile],
    };
  }

export function toDelegatedTaskSpec(this: RunCoordinatorMethodThis,
  template: DelegatedTaskTemplate,
  options: {
      run: RunRecord;
      managerTask: TaskSpec;
      allowOutsideWorkspaceWrites: boolean;
      defaultWorkerAgentId?: string;
      knownAgentIds: string[];
      plannerAgentId?: string;
      agentCatalog: AgentConfig[];
      index: number;
      taskId: string;
      title: string;
      requestedSkillId?: string;
      resolvedSkill: SkillDefinition | null;
      approvedMissingSkillIds: Set<string>;
      skillArgs?: unknown;
      dependencyTaskIds: string[];
    }): TaskSpec | null {
    const goal = readNonEmptyString(template.goal) ?? options.run.goal;
    const title = options.title;
    if (!goal) {
      return null;
    }

    const skillTemplate = options.resolvedSkill?.template;
    const templateInstructions = readStringArray(template.instructions);
    const skillInstructions = readStringArray(skillTemplate?.instructions);
    const baseInstructions =
      templateInstructions.length > 0
        ? templateInstructions
        : skillInstructions.length > 0
          ? skillInstructions
        : [`Deliver the delegated goal: ${goal}`];
    const templateCapabilities = readStringArray(template.requiredCapabilities);
    const skillCapabilities = readStringArray(skillTemplate?.requiredCapabilities);
    const requiredCapabilities = dedupeStrings(
      templateCapabilities.length > 0
        ? templateCapabilities
        : skillCapabilities.length > 0
          ? skillCapabilities
        : ["planning"],
    );
    const preferredAgentCandidate = readNonEmptyString(template.preferredAgent);
    const preferredAgent = pickWorkerAgentForCapabilities({
      requiredCapabilities,
      preferredAgentCandidate,
      defaultWorkerAgentId: options.defaultWorkerAgentId,
      knownAgentIds: options.knownAgentIds,
      plannerAgentId: options.plannerAgentId,
      agents: options.agentCatalog,
    });
    const templateArtifacts = readStringArray(template.expectedArtifacts);
    const skillArtifacts = readStringArray(skillTemplate?.expectedArtifacts);
    const expectedArtifacts =
      templateArtifacts.length > 0
        ? templateArtifacts
        : skillArtifacts.length > 0
          ? skillArtifacts
        : ["Output that satisfies the delegated goal."];
    const instructions = buildDelegatedTaskInstructions({
      instructions: baseInstructions,
      expectedArtifacts,
      workspacePath: options.run.workspacePath,
      allowOutsideWorkspaceWrites: options.allowOutsideWorkspaceWrites,
    });
    const workingDirectory = resolveDelegatedWorkingDirectory({
      expectedArtifacts,
      fallbackWorkingDirectory: options.managerTask.workingDirectory,
      workspacePath: options.run.workspacePath,
      allowOutsideWorkspaceWrites: options.allowOutsideWorkspaceWrites,
    });
    const templateAcceptance = readStringArray(template.acceptanceCriteria);
    const skillAcceptance = readStringArray(skillTemplate?.acceptanceCriteria);
    const acceptanceCriteria =
      templateAcceptance.length > 0
        ? templateAcceptance
        : skillAcceptance.length > 0
          ? skillAcceptance
        : [`Delegated goal completed: ${goal}`];
    const riskLevel =
      template.riskLevel === undefined
        ? normalizeRiskLevel(skillTemplate?.riskLevel)
        : normalizeRiskLevel(template.riskLevel);
    const timeoutMs = normalizeTimeoutMs(
      template.timeoutMs ?? skillTemplate?.timeoutMs,
      DEFAULT_DELEGATED_TASK_TIMEOUT_MS,
    );
    const metadata: Record<string, unknown> = {};
    const requestedSkillId = options.requestedSkillId;
    const normalizedRequestedSkillId =
      typeof requestedSkillId === "string" ? requestedSkillId.trim().toLowerCase() : undefined;
    if (requestedSkillId) {
      metadata.skillId = requestedSkillId;
      metadata.skillStatus = options.resolvedSkill ? "resolved" : "missing_confirmed";
    }
    if (options.resolvedSkill) {
      metadata.skillSource = "local_registry";
      metadata.skillName = options.resolvedSkill.name;
    } else if (
      normalizedRequestedSkillId &&
      options.approvedMissingSkillIds.has(normalizedRequestedSkillId)
    ) {
      metadata.skillSource = "missing_skill_approved";
    }
    if (isPlainObject(options.skillArgs)) {
      metadata.skillArgs = options.skillArgs;
    }
    const validator = isPlainObject(skillTemplate?.validator)
      ? (skillTemplate.validator as TaskSpec["validator"])
      : { mode: "none" as const };

    return {
      id: options.taskId,
      title,
      kind: "execute",
      goal,
      instructions,
      inputs: [
        `Delegated by manager task "${options.managerTask.id}".`,
        `Original run goal: ${options.run.goal}`,
      ],
      dependsOn: options.dependencyTaskIds,
      requiredCapabilities,
      ...(preferredAgent ? { preferredAgent } : {}),
      workingDirectory,
      expectedArtifacts,
      acceptanceCriteria,
      validator,
      riskLevel,
      allowedActions: [],
      timeoutMs,
      retryPolicy: {
        maxAttempts: 2,
        backoffMs: 0,
        retryOn: ["adapter_error", "timeout"],
      },
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      status: "pending",
    };
  }
