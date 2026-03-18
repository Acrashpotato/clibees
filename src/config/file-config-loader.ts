import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ConfigLoader } from "../control/entrypoint.js";
import {
  CONFIG_FILE_NAME,
  CONFIG_VERSION,
  type ApprovalPolicyValue,
  type AgentConfig,
  type AgentProfileConfig,
  type LoggingConfig,
  type MemoryConfig,
  type MultiAgentConfig,
  type PlannerConfig,
  type RoutingConfig,
  type SafetyConfig,
  type ValidationConfig,
  type WorkspaceConfig,
} from "../domain/config.js";
import type { RiskLevel } from "../domain/models.js";
import { pathExists, resolvePath } from "../shared/runtime.js";
import { createDefaultConfig } from "./default-config.js";
import type { JsonLike } from "./file-config-loader/shared-types.js";
import { parseYamlSubset } from "./file-config-loader/yaml-parser.js";
import {
  expectArray,
  expectEnum,
  expectNumber,
  expectObject,
  expectOptionalObject,
  expectString,
  expectStringArray,
  optionalBoolean,
  optionalNumber,
  optionalResolvedPath,
  optionalString,
  optionalStringArray,
} from "./file-config-loader/value-readers.js";

type ConfigMigration = (rawConfig: Record<string, JsonLike>) => Record<string, JsonLike>;

const CONFIG_MIGRATIONS = new Map<number, ConfigMigration>();
const COST_TIERS = new Set(["low", "medium", "high"]);
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const RISK_LEVELS = new Set<RiskLevel>(["low", "medium", "high"]);
const APPROVAL_POLICY_VALUES = new Set<ApprovalPolicyValue>([
  "always",
  "never",
  "low",
  "medium",
  "high",
]);
const PLANNER_MODES = new Set(["static", "delegated"]);

export class FileConfigLoader implements ConfigLoader {
  constructor(private readonly baseDir: string = process.cwd()) {}

  async load(configPath?: string): Promise<MultiAgentConfig> {
    const defaultConfig = createDefaultConfig(this.baseDir);
    const resolvedPath = resolvePath(
      configPath ?? CONFIG_FILE_NAME,
      this.baseDir,
    );

    if (!(await pathExists(resolvedPath))) {
      if (configPath) {
        throw new Error(`Config file "${resolvedPath}" was not found.`);
      }

      return defaultConfig;
    }

    const rawText = await readFile(resolvedPath, "utf8");
    const rawConfig = parseConfigDocument(rawText, resolvedPath);
    const migratedConfig = applyConfigMigrations(rawConfig, resolvedPath);
    return normalizeConfig(migratedConfig, resolvedPath, defaultConfig);
  }
}

function parseConfigDocument(
  rawText: string,
  sourcePath: string,
): Record<string, JsonLike> {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error(`Config file "${sourcePath}" is empty.`);
  }

  const parsed = tryParseJson(trimmed) ?? parseYamlSubset(trimmed, sourcePath);
  return expectObject(parsed, "config");
}

function tryParseJson(text: string): JsonLike | null {
  try {
    return JSON.parse(text) as JsonLike;
  } catch {
    return null;
  }
}

function applyConfigMigrations(
  rawConfig: Record<string, JsonLike>,
  sourcePath: string,
): Record<string, JsonLike> {
  let current = rawConfig;
  let version = current.version === undefined
    ? CONFIG_VERSION
    : expectNumber(current.version, "config.version");

  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Config field "config.version" must be a positive integer.`);
  }

  if (version > CONFIG_VERSION) {
    throw new Error(
      `Config version ${version} from "${sourcePath}" is newer than supported version ${CONFIG_VERSION}.`,
    );
  }

  while (version < CONFIG_VERSION) {
    const migrate = CONFIG_MIGRATIONS.get(version);
    if (!migrate) {
      throw new Error(
        `Config version ${version} from "${sourcePath}" has no migration path to ${CONFIG_VERSION}.`,
      );
    }

    current = migrate(current);
    version = current.version === undefined
      ? version + 1
      : expectNumber(current.version, "config.version");
  }

  return current;
}

function normalizeConfig(
  rawConfig: Record<string, JsonLike>,
  configPath: string,
  defaults: MultiAgentConfig,
): MultiAgentConfig {
  const configDir = path.dirname(configPath);
  const agents = normalizeAgents(rawConfig.agents, configDir);
  const agentIds = new Set(agents.map((agent) => agent.id));
  const defaultAgentId = agents[0]?.id;

  const planner = normalizePlanner(rawConfig.planner, defaultAgentId);
  if (planner.agentId && !agentIds.has(planner.agentId)) {
    throw new Error(
      `Config field "planner.agentId" references unknown agent "${planner.agentId}".`,
    );
  }

  const routing = normalizeRouting(
    rawConfig.routing,
    defaults.routing,
    defaultAgentId,
  );
  if (routing.defaultAgentId && !agentIds.has(routing.defaultAgentId)) {
    throw new Error(
      `Config field "routing.defaultAgentId" references unknown agent "${routing.defaultAgentId}".`,
    );
  }

  return {
    version: CONFIG_VERSION,
    agents,
    planner,
    routing,
    safety: normalizeSafety(rawConfig.safety, defaults.safety),
    memory: normalizeMemory(rawConfig.memory, defaults.memory, configDir),
    workspace: normalizeWorkspace(
      rawConfig.workspace,
      defaults.workspace,
      configDir,
    ),
    validation: normalizeValidation(rawConfig.validation, defaults.validation),
    logging: normalizeLogging(rawConfig.logging, defaults.logging),
  };
}

function normalizeAgents(
  rawValue: JsonLike | undefined,
  configDir: string,
): AgentConfig[] {
  const values = expectArray(rawValue, "agents");
  if (values.length === 0) {
    throw new Error(`Config field "agents" must contain at least one agent.`);
  }

  const seenIds = new Set<string>();
  return values.map((value, index) => {
    const agentPath = `agents[${index}]`;
    const rawAgent = expectObject(value, agentPath);
    const id = expectString(rawAgent.id, `${agentPath}.id`);
    if (seenIds.has(id)) {
      throw new Error(`Config field "${agentPath}.id" duplicates agent "${id}".`);
    }

    seenIds.add(id);
    const profiles = normalizeProfiles(rawAgent.profiles, `${agentPath}.profiles`, configDir);
    const command = expectString(rawAgent.command, `${agentPath}.command`);
    const priority = optionalNumber(rawAgent.priority, `${agentPath}.priority`);

    return {
      id,
      command,
      profiles,
      priority,
    };
  });
}

function normalizeProfiles(
  rawValue: JsonLike | undefined,
  pathPrefix: string,
  configDir: string,
): AgentProfileConfig[] {
  const values = expectArray(rawValue, pathPrefix);
  if (values.length === 0) {
    throw new Error(`Config field "${pathPrefix}" must contain at least one profile.`);
  }

  const seenIds = new Set<string>();
  return values.map((value, index) => {
    const profilePath = `${pathPrefix}[${index}]`;
    const rawProfile = expectObject(value, profilePath);
    const id = expectString(rawProfile.id, `${profilePath}.id`);
    if (seenIds.has(id)) {
      throw new Error(
        `Config field "${profilePath}.id" duplicates profile "${id}" in the same agent.`,
      );
    }

    seenIds.add(id);
    const costTier = expectEnum(
      rawProfile.costTier,
      `${profilePath}.costTier`,
      COST_TIERS,
    ) as AgentProfileConfig["costTier"];

    return {
      id,
      label: expectString(rawProfile.label, `${profilePath}.label`),
      capabilities: expectStringArray(
        rawProfile.capabilities,
        `${profilePath}.capabilities`,
      ),
      defaultArgs: optionalStringArray(
        rawProfile.defaultArgs,
        `${profilePath}.defaultArgs`,
      ),
      defaultCwd: optionalResolvedPath(
        rawProfile.defaultCwd,
        `${profilePath}.defaultCwd`,
        configDir,
      ),
      costTier,
    };
  });
}

function normalizePlanner(
  rawValue: JsonLike | undefined,
  fallbackAgentId: string | undefined,
): PlannerConfig {
  const rawPlanner = expectOptionalObject(rawValue, "planner");
  const mode = expectEnum(
    rawPlanner.mode ?? "static",
    "planner.mode",
    PLANNER_MODES,
  ) as PlannerConfig["mode"];

  return {
    mode,
    agentId: optionalString(rawPlanner.agentId, "planner.agentId") ?? fallbackAgentId,
  };
}

function normalizeRouting(
  rawValue: JsonLike | undefined,
  defaults: RoutingConfig,
  fallbackAgentId: string | undefined,
): RoutingConfig {
  const rawRouting = expectOptionalObject(rawValue, "routing");
  return {
    defaultAgentId:
      optionalString(rawRouting.defaultAgentId, "routing.defaultAgentId") ??
      fallbackAgentId ??
      defaults.defaultAgentId,
    preferLowCost: optionalBoolean(
      rawRouting.preferLowCost,
      "routing.preferLowCost",
    ) ?? defaults.preferLowCost,
  };
}

function normalizeSafety(
  rawValue: JsonLike | undefined,
  defaults: SafetyConfig,
): SafetyConfig {
  const rawSafety = expectOptionalObject(rawValue, "safety");
  return {
    approvalThreshold: (rawSafety.approvalThreshold === undefined
      ? defaults.approvalThreshold
      : expectEnum(
          rawSafety.approvalThreshold,
          "safety.approvalThreshold",
          RISK_LEVELS,
        )) as RiskLevel,
    blockedActions:
      optionalStringArray(rawSafety.blockedActions, "safety.blockedActions") ??
      defaults.blockedActions,
    approvalPolicyByAction:
      optionalApprovalPolicyByAction(
        rawSafety.approvalPolicyByAction,
        "safety.approvalPolicyByAction",
      ) ??
      defaults.approvalPolicyByAction,
  };
}

function normalizeMemory(
  rawValue: JsonLike | undefined,
  defaults: MemoryConfig,
  configDir: string,
): MemoryConfig {
  const rawMemory = expectOptionalObject(rawValue, "memory");
  return {
    enabled:
      optionalBoolean(rawMemory.enabled, "memory.enabled") ?? defaults.enabled,
    rootDir:
      optionalResolvedPath(rawMemory.rootDir, "memory.rootDir", configDir) ??
      defaults.rootDir,
  };
}

function normalizeWorkspace(
  rawValue: JsonLike | undefined,
  defaults: WorkspaceConfig,
  configDir: string,
): WorkspaceConfig {
  const rawWorkspace = expectOptionalObject(rawValue, "workspace");
  return {
    rootDir:
      optionalResolvedPath(rawWorkspace.rootDir, "workspace.rootDir", configDir) ??
      defaults.rootDir,
    allowOutsideWorkspaceWrites:
      optionalBoolean(
        rawWorkspace.allowOutsideWorkspaceWrites,
        "workspace.allowOutsideWorkspaceWrites",
      ) ?? defaults.allowOutsideWorkspaceWrites,
  };
}

function normalizeValidation(
  rawValue: JsonLike | undefined,
  defaults: ValidationConfig,
): ValidationConfig {
  const rawValidation = expectOptionalObject(rawValue, "validation");
  return {
    defaultTimeoutMs:
      optionalNumber(
        rawValidation.defaultTimeoutMs,
        "validation.defaultTimeoutMs",
      ) ?? defaults.defaultTimeoutMs,
    enableBuildChecks:
      optionalBoolean(
        rawValidation.enableBuildChecks,
        "validation.enableBuildChecks",
      ) ?? defaults.enableBuildChecks,
  };
}

function normalizeLogging(
  rawValue: JsonLike | undefined,
  defaults: LoggingConfig,
): LoggingConfig {
  const rawLogging = expectOptionalObject(rawValue, "logging");
  return {
    level: (rawLogging.level === undefined
      ? defaults.level
      : expectEnum(rawLogging.level, "logging.level", LOG_LEVELS)) as LoggingConfig["level"],
    persistEvents:
      optionalBoolean(rawLogging.persistEvents, "logging.persistEvents") ??
      defaults.persistEvents,
  };
}

function optionalApprovalPolicyByAction(
  value: JsonLike | undefined,
  fieldPath: string,
): Record<string, ApprovalPolicyValue> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const rawMap = expectObject(value, fieldPath);
  const result: Record<string, ApprovalPolicyValue> = {};
  for (const [rawKind, rawPolicy] of Object.entries(rawMap)) {
    const kind = rawKind.trim();
    if (!kind) {
      throw new Error(`Config field "${fieldPath}" cannot include an empty action kind.`);
    }

    if (kind in result) {
      throw new Error(`Config field "${fieldPath}" duplicates action kind "${kind}".`);
    }

    result[kind] = expectEnum(
      rawPolicy,
      `${fieldPath}.${kind}`,
      APPROVAL_POLICY_VALUES,
    ) as ApprovalPolicyValue;
  }
  return result;
}
