import path from "node:path";
import { readdir } from "node:fs/promises";
import type { TaskSpec } from "../../domain/models.js";
import { pathExists, readJsonFile } from "../../shared/runtime.js";
import type { SkillDefinition, SkillRegistry, SkillTemplate } from "./types.js";

interface SkillFileDocument {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  keywords?: unknown;
  template?: unknown;
}

export class LocalSkillRegistry implements SkillRegistry {
  async listSkills(workspacePath: string): Promise<SkillDefinition[]> {
    const skillsDir = path.join(workspacePath, "skills");
    if (!(await pathExists(skillsDir))) {
      return [];
    }

    const entries = await readdir(skillsDir, { withFileTypes: true });
    const definitions: SkillDefinition[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(skillsDir, entry.name);
      const parsed = await this.readSkillFile(filePath);
      if (parsed) {
        definitions.push(parsed);
      }
    }

    return definitions.sort((left, right) => left.id.localeCompare(right.id));
  }

  async getSkill(workspacePath: string, skillId: string): Promise<SkillDefinition | null> {
    const normalizedId = normalizeSkillId(skillId);
    if (!normalizedId) {
      return null;
    }

    const skills = await this.listSkills(workspacePath);
    return (
      skills.find((skill) => normalizeSkillId(skill.id) === normalizedId) ?? null
    );
  }

  private async readSkillFile(filePath: string): Promise<SkillDefinition | null> {
    let document: SkillFileDocument;
    try {
      document = await readJsonFile<SkillFileDocument>(filePath);
    } catch {
      return null;
    }

    const id = readNonEmptyString(document.id);
    if (!id) {
      return null;
    }

    const name = readNonEmptyString(document.name) ?? id;
    const description = readNonEmptyString(document.description);
    const keywords = readStringArray(document.keywords);
    const template = readSkillTemplate(document.template);

    return {
      id,
      name,
      ...(description ? { description } : {}),
      keywords,
      template,
    };
  }
}

function readSkillTemplate(value: unknown): SkillTemplate {
  if (!isPlainObject(value)) {
    return {};
  }

  const instructions = readStringArray(value.instructions);
  const requiredCapabilities = readStringArray(value.requiredCapabilities);
  const expectedArtifacts = readStringArray(value.expectedArtifacts);
  const acceptanceCriteria = readStringArray(value.acceptanceCriteria);
  const riskLevel = normalizeRiskLevel(value.riskLevel);
  const timeoutMs = normalizeTimeoutMs(value.timeoutMs);
  const validator = normalizeValidator(value.validator);

  return {
    ...(instructions.length > 0 ? { instructions } : {}),
    ...(requiredCapabilities.length > 0 ? { requiredCapabilities } : {}),
    ...(expectedArtifacts.length > 0 ? { expectedArtifacts } : {}),
    ...(acceptanceCriteria.length > 0 ? { acceptanceCriteria } : {}),
    ...(riskLevel ? { riskLevel } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(validator ? { validator } : {}),
  };
}

function normalizeValidator(value: unknown): TaskSpec["validator"] | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  if (
    value.mode !== "none" &&
    value.mode !== "files" &&
    value.mode !== "command" &&
    value.mode !== "schema" &&
    value.mode !== "composite"
  ) {
    return undefined;
  }

  const commands = readStringArray(value.commands);
  const requiredFiles = readStringArray(value.requiredFiles);
  const outputSchemaId = readNonEmptyString(value.outputSchemaId);
  const children = Array.isArray(value.children)
    ? value.children
        .map((child) => normalizeValidator(child))
        .filter((child): child is TaskSpec["validator"] => Boolean(child))
    : [];

  return {
    mode: value.mode,
    ...(commands.length > 0 ? { commands } : {}),
    ...(requiredFiles.length > 0 ? { requiredFiles } : {}),
    ...(outputSchemaId ? { outputSchemaId } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function normalizeRiskLevel(value: unknown): TaskSpec["riskLevel"] | undefined {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : undefined;
}

function normalizeTimeoutMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
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
  return [
    ...new Set(
      value
        .map((item) => readNonEmptyString(item))
        .filter((item): item is string => Boolean(item)),
    ),
  ];
}

function normalizeSkillId(value: string): string {
  return value.trim().toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
