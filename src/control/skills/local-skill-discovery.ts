import type {
  SkillDefinition,
  SkillDiscoveryAdapter,
  SkillDiscoveryMatch,
  SkillRegistry,
} from "./types.js";

export class LocalSkillDiscoveryAdapter implements SkillDiscoveryAdapter {
  constructor(private readonly registry: SkillRegistry) {}

  async findSkills(
    workspacePath: string,
    query: string,
    options: { limit?: number } = {},
  ): Promise<SkillDiscoveryMatch[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    const limit = options.limit && options.limit > 0 ? options.limit : 5;
    const skills = await this.registry.listSkills(workspacePath);
    const ranked = skills
      .map((skill) => rankSkill(skill, normalizedQuery))
      .filter((item): item is SkillDiscoveryMatch => Boolean(item))
      .sort((left, right) => right.score - left.score || left.skillId.localeCompare(right.skillId));

    return ranked.slice(0, limit);
  }
}

function rankSkill(
  skill: SkillDefinition,
  normalizedQuery: string,
): SkillDiscoveryMatch | null {
  const id = skill.id.toLowerCase();
  const name = skill.name.toLowerCase();
  const description = skill.description?.toLowerCase() ?? "";
  const keywords = skill.keywords.map((keyword) => keyword.toLowerCase());

  if (id === normalizedQuery) {
    return buildMatch(skill, 100, "Exact skillId match.");
  }
  if (name === normalizedQuery) {
    return buildMatch(skill, 96, "Exact skill name match.");
  }
  if (id.includes(normalizedQuery)) {
    return buildMatch(skill, 90, "skillId contains query.");
  }
  if (name.includes(normalizedQuery)) {
    return buildMatch(skill, 84, "skill name contains query.");
  }
  if (keywords.some((keyword) => keyword === normalizedQuery)) {
    return buildMatch(skill, 80, "Keyword exact match.");
  }
  if (keywords.some((keyword) => keyword.includes(normalizedQuery))) {
    return buildMatch(skill, 72, "Keyword fuzzy match.");
  }
  if (description.includes(normalizedQuery)) {
    return buildMatch(skill, 66, "Description contains query.");
  }

  return null;
}

function buildMatch(
  skill: SkillDefinition,
  score: number,
  reason: string,
): SkillDiscoveryMatch {
  return {
    skillId: skill.id,
    name: skill.name,
    ...(skill.description ? { description: skill.description } : {}),
    score,
    reason,
  };
}
