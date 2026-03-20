import type { TaskSpec } from "../../domain/models.js";

export interface SkillTemplate {
  instructions?: string[];
  requiredCapabilities?: string[];
  expectedArtifacts?: string[];
  acceptanceCriteria?: string[];
  riskLevel?: TaskSpec["riskLevel"];
  timeoutMs?: number;
  validator?: TaskSpec["validator"];
}

export interface SkillDefinition {
  id: string;
  name: string;
  description?: string;
  keywords: string[];
  template: SkillTemplate;
}

export interface SkillRegistry {
  listSkills(workspacePath: string): Promise<SkillDefinition[]>;
  getSkill(workspacePath: string, skillId: string): Promise<SkillDefinition | null>;
}

export interface SkillDiscoveryMatch {
  skillId: string;
  name: string;
  description?: string;
  reason: string;
  score: number;
}

export interface SkillDiscoveryAdapter {
  findSkills(
    workspacePath: string,
    query: string,
    options?: { limit?: number },
  ): Promise<SkillDiscoveryMatch[]>;
}
