import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ConfigLoader } from "../control/entrypoint.js";
import {
  CONFIG_FILE_NAME,
  CONFIG_VERSION,
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

type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike };

type ConfigMigration = (rawConfig: Record<string, JsonLike>) => Record<string, JsonLike>;

const CONFIG_MIGRATIONS = new Map<number, ConfigMigration>();
const COST_TIERS = new Set(["low", "medium", "high"]);
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const RISK_LEVELS = new Set<RiskLevel>(["low", "medium", "high"]);
const PLANNER_MODES = new Set(["static", "delegated"]);

interface SourceLine {
  indent: number;
  lineNumber: number;
  text: string;
}

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

function parseYamlSubset(text: string, sourcePath: string): JsonLike {
  const lines = tokenizeYaml(text, sourcePath);
  if (lines.length === 0) {
    return {};
  }

  const parsed = parseYamlBlock(lines, 0, lines[0].indent, sourcePath);
  if (parsed.nextIndex !== lines.length) {
    throw new Error(
      `Unexpected trailing content in "${sourcePath}" at line ${lines[parsed.nextIndex].lineNumber}.`,
    );
  }

  return parsed.value;
}

function tokenizeYaml(text: string, sourcePath: string): SourceLine[] {
  const result: SourceLine[] = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const sanitized = stripInlineComment(rawLine);
    if (!sanitized.trim()) {
      continue;
    }

    if (sanitized.includes("\t")) {
      throw new Error(
        `Tabs are not supported in "${sourcePath}" at line ${lineNumber}. Use spaces for indentation.`,
      );
    }

    const indent = sanitized.match(/^ */)?.[0].length ?? 0;
    result.push({
      indent,
      lineNumber,
      text: sanitized.trim(),
    });
  }

  return result;
}

function stripInlineComment(line: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === "\"" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === "#" && !inSingleQuote && !inDoubleQuote) {
      return line.slice(0, index).trimEnd();
    }
  }

  return line;
}

function parseYamlBlock(
  lines: SourceLine[],
  startIndex: number,
  indent: number,
  sourcePath: string,
): { value: JsonLike; nextIndex: number } {
  const line = lines[startIndex];
  if (line.indent !== indent) {
    throw new Error(
      `Unexpected indentation in "${sourcePath}" at line ${line.lineNumber}.`,
    );
  }

  return line.text.startsWith("- ")
    ? parseYamlArray(lines, startIndex, indent, sourcePath)
    : parseYamlObject(lines, startIndex, indent, sourcePath);
}

function parseYamlObject(
  lines: SourceLine[],
  startIndex: number,
  indent: number,
  sourcePath: string,
): { value: Record<string, JsonLike>; nextIndex: number } {
  const result: Record<string, JsonLike> = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      throw new Error(
        `Unexpected indentation in "${sourcePath}" at line ${line.lineNumber}.`,
      );
    }

    if (line.text.startsWith("- ")) {
      throw new Error(
        `Array item cannot appear directly inside an object in "${sourcePath}" at line ${line.lineNumber}.`,
      );
    }

    const separatorIndex = findKeySeparator(line.text);
    if (separatorIndex === -1) {
      throw new Error(
        `Expected "key: value" in "${sourcePath}" at line ${line.lineNumber}.`,
      );
    }

    const key = line.text.slice(0, separatorIndex).trim();
    const valueText = line.text.slice(separatorIndex + 1).trim();
    if (!key) {
      throw new Error(`Missing key in "${sourcePath}" at line ${line.lineNumber}.`);
    }

    index += 1;
    if (!valueText) {
      if (index >= lines.length || lines[index].indent <= indent) {
        result[key] = {};
        continue;
      }

      const nested = parseYamlBlock(lines, index, lines[index].indent, sourcePath);
      result[key] = nested.value;
      index = nested.nextIndex;
      continue;
    }

    result[key] = parseScalar(valueText, sourcePath, line.lineNumber);
  }

  return { value: result, nextIndex: index };
}

function parseYamlArray(
  lines: SourceLine[],
  startIndex: number,
  indent: number,
  sourcePath: string,
): { value: JsonLike[]; nextIndex: number } {
  const result: JsonLike[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }

    if (line.indent !== indent || !line.text.startsWith("- ")) {
      break;
    }

    const valueText = line.text.slice(2).trim();
    index += 1;

    if (!valueText) {
      if (index >= lines.length || lines[index].indent <= indent) {
        result.push(null);
        continue;
      }

      const nested = parseYamlBlock(lines, index, lines[index].indent, sourcePath);
      result.push(nested.value);
      index = nested.nextIndex;
      continue;
    }

    const separatorIndex = findKeySeparator(valueText);
    if (separatorIndex !== -1) {
      const key = valueText.slice(0, separatorIndex).trim();
      const inlineValue = valueText.slice(separatorIndex + 1).trim();
      const item: Record<string, JsonLike> = {};
      item[key] = inlineValue
        ? parseScalar(inlineValue, sourcePath, line.lineNumber)
        : {};

      if (index < lines.length && lines[index].indent > indent) {
        const nested = parseYamlObject(
          lines,
          index,
          lines[index].indent,
          sourcePath,
        );
        Object.assign(item, nested.value);
        index = nested.nextIndex;
      }

      result.push(item);
      continue;
    }

    result.push(parseScalar(valueText, sourcePath, line.lineNumber));
  }

  return { value: result, nextIndex: index };
}

function findKeySeparator(text: string): number {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === "\"" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ":" && !inSingleQuote && !inDoubleQuote) {
      return index;
    }
  }

  return -1;
}

function parseScalar(
  valueText: string,
  sourcePath: string,
  lineNumber: number,
): JsonLike {
  if (valueText === "true") {
    return true;
  }

  if (valueText === "false") {
    return false;
  }

  if (valueText === "null") {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(valueText)) {
    return Number(valueText);
  }

  if (
    (valueText.startsWith("\"") && valueText.endsWith("\"")) ||
    (valueText.startsWith("'") && valueText.endsWith("'"))
  ) {
    return valueText.slice(1, -1);
  }

  if (
    (valueText.startsWith("[") && valueText.endsWith("]")) ||
    (valueText.startsWith("{") && valueText.endsWith("}"))
  ) {
    try {
      return JSON.parse(valueText) as JsonLike;
    } catch {
      throw new Error(
        `Invalid inline JSON value in "${sourcePath}" at line ${lineNumber}.`,
      );
    }
  }

  return valueText;
}

function expectObject(
  value: JsonLike,
  fieldPath: string,
): Record<string, JsonLike> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Config field "${fieldPath}" must be an object.`);
  }

  return value as Record<string, JsonLike>;
}

function expectOptionalObject(
  value: JsonLike | undefined,
  fieldPath: string,
): Record<string, JsonLike> {
  if (value === undefined) {
    return {};
  }

  return expectObject(value, fieldPath);
}

function expectArray(value: JsonLike | undefined, fieldPath: string): JsonLike[] {
  if (!Array.isArray(value)) {
    throw new Error(`Config field "${fieldPath}" must be an array.`);
  }

  return value;
}

function expectString(value: JsonLike | undefined, fieldPath: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Config field "${fieldPath}" must be a non-empty string.`);
  }

  return value;
}

function optionalString(
  value: JsonLike | undefined,
  fieldPath: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectString(value, fieldPath);
}

function expectStringArray(
  value: JsonLike | undefined,
  fieldPath: string,
): string[] {
  return expectArray(value, fieldPath).map((item, index) =>
    expectString(item, `${fieldPath}[${index}]`),
  );
}

function optionalStringArray(
  value: JsonLike | undefined,
  fieldPath: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectStringArray(value, fieldPath);
}

function expectNumber(value: JsonLike | undefined, fieldPath: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Config field "${fieldPath}" must be a number.`);
  }

  return value;
}

function optionalNumber(
  value: JsonLike | undefined,
  fieldPath: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectNumber(value, fieldPath);
}

function optionalBoolean(
  value: JsonLike | undefined,
  fieldPath: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Config field "${fieldPath}" must be a boolean.`);
  }

  return value;
}

function expectEnum(
  value: JsonLike | undefined,
  fieldPath: string,
  allowedValues: ReadonlySet<string>,
): string {
  const normalized = expectString(value, fieldPath);
  if (!allowedValues.has(normalized)) {
    throw new Error(
      `Config field "${fieldPath}" must be one of: ${Array.from(allowedValues).join(", ")}.`,
    );
  }

  return normalized;
}

function optionalResolvedPath(
  value: JsonLike | undefined,
  fieldPath: string,
  baseDir: string,
): string | undefined {
  const text = optionalString(value, fieldPath);
  return text ? resolvePath(text, baseDir) : undefined;
}
