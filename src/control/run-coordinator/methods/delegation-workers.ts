import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  ApprovalDecision,
  ArtifactRecord,
  InvocationPlan,
  MessageThreadRecord,
  RunEvent,
  RunGraph,
  RunInspection,
  RunRecord,
  RunRequest,
  SessionMessageRecord,
  TaskSpec,
  TaskSessionRecord,
  ValidationResult,
} from "../../../domain/models.js";
import {
  SCHEMA_VERSION,
  assertRunStatusTransition,
} from "../../../domain/models.js";
import type {
  AgentConfig,
  AgentProfileConfig,
  MultiAgentConfig,
} from "../../../domain/config.js";
import { createDefaultConfig } from "../../../config/default-config.js";
import { buildRunConfigForSelectedCli } from "../../../config/run-cli-config.js";
import { ConfiguredCliAdapter } from "../../../adapters/configured-cli-adapter.js";
import {
  DefaultContextAssembler,
  type ContextAssembler,
} from "../../../decision/context-assembler.js";
import { DefaultValidator, type Validator } from "../../../decision/validator.js";
import type { Planner } from "../../../decision/planner.js";
import {
  RuleBasedRouter,
  type Router,
} from "../../../decision/router.js";
import type { AdapterRegistry } from "../../../execution/adapter-registry.js";
import { createAdapterRegistry } from "../../../execution/create-adapter-registry.js";
import {
  FileApprovalManager,
  type ApprovalManager,
} from "../../../execution/approval-manager.js";
import {
  ProcessExecutionRuntime,
  type ExecutionRuntime,
} from "../../../execution/execution-runtime.js";
import { SafetyManager } from "../../../execution/safety-manager.js";
import type { ArtifactStore } from "../../../storage/artifact-store.js";
import { FileArtifactStore } from "../../../storage/artifact-store.js";
import type { BlackboardStore } from "../../../storage/blackboard-store.js";
import { FileBlackboardStore } from "../../../storage/blackboard-store.js";
import type { EventStore } from "../../../storage/event-store.js";
import type { ProjectMemoryStore } from "../../../storage/project-memory-store.js";
import type { RunStore } from "../../../storage/run-store.js";
import type { SessionStore } from "../../../storage/session-store.js";
import type { WorkspaceStateStore } from "../../../storage/workspace-state-store.js";
import { FileWorkspaceStateStore } from "../../../storage/workspace-state-store.js";
import { createId, isoNow, pathExists, resolvePath } from "../../../shared/runtime.js";
import { SELECTED_CLI_VALUES, type SelectedCli } from "../../../ui-api/selected-cli.js";
import { GraphManager } from "../../graph-manager.js";
import { InspectionAggregator } from "../../inspection-aggregator.js";
import { MemoryConsolidator } from "../../memory-consolidator.js";
import { Scheduler } from "../../scheduler.js";
import type { SkillDefinition } from "../../skills/types.js";
import type {
  DelegatedTaskTemplate,
  ExecutionServices,
  ManagerCoordinationOutput,
  PostThreadMessageInput,
  PostThreadMessageResult,
  TaskProcessingResult,
} from "../core.js";
import {
  DEFAULT_DELEGATED_TASK_TIMEOUT_MS,
  DEFAULT_SELECTED_CLI,
  DEFAULT_TASK_TIMEOUT_MS,
  MANAGER_PRIMARY_SESSION_ID,
  MANAGER_PRIMARY_THREAD_ID,
  MAX_DELEGATED_TASKS,
  MAX_MANAGER_COORDINATION_TASKS,
} from "../core.js";
import {
  addDelegatedTaskReference,
  applyWorkspaceWritePolicyOverride,
  buildBlackboardProjection,
  buildDelegatedTaskDraft,
  buildDelegatedTaskInstructions,
  buildDelegatedTaskReferenceMap,
  buildDelegationManagerGoal,
  buildDelegationTaskTitle,
  capitalize,
  captureFileManifest,
  dedupeAgentConfigs,
  dedupeStrings,
  diffFileManifest,
  extractStructuredOutputFromPayload,
  findCommonPathRoot,
  hasActiveDelegationManagerTask,
  hasCompatibleWorkerForCapabilities,
  hasMeaningfulGraphPatch,
  isAgentCompatibleWithCapabilities,
  isAutoResumableRunStatus,
  isDelegationManagerTask,
  isManagerCoordinationTask,
  isPathInsideRoot,
  isPlainObject,
  isSelectedCli,
  isTerminalRunStatus,
  mapValidationOutcomeToTaskStatus,
  mergeDynamicAgentsIntoConfig,
  normalizeCostTier,
  normalizeDelegatedTaskReference,
  normalizeRiskLevel,
  normalizeTimeoutMs,
  pickWorkerAgentForCapabilities,
  readAgentProfiles,
  readDynamicAgents,
  readNonEmptyString,
  readOptionalBoolean,
  readStringArray,
  resolveDelegatedDependencyTaskIds,
  resolveDelegatedWorkingDirectory,
  resolveExpectedArtifactDirectories,
  resolvePlannerMode,
  resolveSelectedCli,
  shouldFallbackToDefaultSelectedCli,
  shouldKeepDelegatedConfigForSelectedCli,
  shouldUseDelegatedBootstrap,
  summarizeApprovalReason,
  summarizeCommandResult,
  toCapabilitySlug,
} from "../helpers/index.js";

export async function ensureCapabilityWorkersForDelegatedTasks(this: any,
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

export function buildProvisionedWorkerAgent(this: any,
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

export function toDelegatedTaskSpec(this: any,
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
