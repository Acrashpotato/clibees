import type { AgentConfig, RoutingConfig } from "../domain/config.js";
import type { TaskSpec } from "../domain/models.js";
import type {
  AdapterRegistry,
  AvailableAgent,
} from "../execution/adapter-registry.js";

export interface AgentSelection {
  agentId: string;
  profileId: string;
  reason: string;
}

export interface Router {
  selectAgent(task: TaskSpec): Promise<AgentSelection>;
}

export interface RuleBasedRouterDependencies {
  adapterRegistry: AdapterRegistry;
  agents: AgentConfig[];
  routing: RoutingConfig;
}

interface CandidateSelection {
  agent: AvailableAgent;
  config: AgentConfig;
  profileId: string;
  costRank: number;
  priorityRank: number;
}

export class RuleBasedRouter implements Router {
  private readonly agentConfigById = new Map<string, AgentConfig>();

  constructor(private readonly dependencies: RuleBasedRouterDependencies) {
    for (const agent of dependencies.agents) {
      this.agentConfigById.set(agent.id, agent);
    }
  }

  async selectAgent(task: TaskSpec): Promise<AgentSelection> {
    const availableAgents = await this.dependencies.adapterRegistry.getAvailableAgents(
      task.requiredCapabilities,
    );
    const candidates = availableAgents
      .map((agent) => this.toCandidate(agent, task))
      .filter((candidate): candidate is CandidateSelection => Boolean(candidate));

    if (task.preferredAgent) {
      const preferred = candidates.find(
        (candidate) => candidate.agent.agentId === task.preferredAgent,
      );
      if (preferred) {
        return this.toSelection(
          preferred,
          `preferred agent "${task.preferredAgent}" matched the task capabilities.`,
        );
      }

      if (candidates.length === 0) {
        throw new Error(
          `Preferred agent "${task.preferredAgent}" is unavailable or does not satisfy ${task.requiredCapabilities.join(", ") || "(none)"}.`,
        );
      }

      const fallback = this.pickBestCandidate(candidates);
      return this.toSelection(
        fallback,
        `preferred agent "${task.preferredAgent}" was unavailable or incompatible; fell back to "${fallback.agent.agentId}".`,
      );
    }

    const defaultAgentId = this.dependencies.routing.defaultAgentId;
    if (defaultAgentId) {
      const defaultCandidate = candidates.find(
        (candidate) => candidate.agent.agentId === defaultAgentId,
      );
      if (defaultCandidate) {
        return this.toSelection(
          defaultCandidate,
          `selected configured default agent "${defaultAgentId}".`,
        );
      }
    }

    if (candidates.length === 0) {
      throw new Error(
        `No available agent satisfies required capabilities: ${task.requiredCapabilities.join(", ") || "(none)"}.`,
      );
    }

    const selected = this.pickBestCandidate(candidates);
    const reason = this.dependencies.routing.preferLowCost
      ? `selected lowest-cost compatible agent "${selected.agent.agentId}" with profile "${selected.profileId}".`
      : `selected highest-priority compatible agent "${selected.agent.agentId}" with profile "${selected.profileId}".`;
    return this.toSelection(selected, reason);
  }

  private toCandidate(
    agent: AvailableAgent,
    task: TaskSpec,
  ): CandidateSelection | null {
    const config = this.agentConfigById.get(agent.agentId);
    if (!config) {
      return null;
    }

    const matchingProfiles = config.profiles.filter((profile) =>
      task.requiredCapabilities.every((capability) =>
        profile.capabilities.includes(capability),
      ),
    );
    const selectedProfile =
      matchingProfiles.find(
        (profile) => profile.id === agent.capability.defaultProfileId,
      ) ??
      matchingProfiles[0] ??
      config.profiles.find((profile) => profile.id === agent.capability.defaultProfileId) ??
      config.profiles[0];
    if (!selectedProfile) {
      return null;
    }

    return {
      agent,
      config,
      profileId: selectedProfile.id,
      costRank: getCostRank(selectedProfile.costTier),
      priorityRank: config.priority ?? Number.MAX_SAFE_INTEGER,
    };
  }

  private pickBestCandidate(candidates: CandidateSelection[]): CandidateSelection {
    const preferLowCost = this.dependencies.routing.preferLowCost;

    return [...candidates].sort((left, right) => {
      if (preferLowCost && left.costRank !== right.costRank) {
        return left.costRank - right.costRank;
      }

      if (left.priorityRank !== right.priorityRank) {
        return left.priorityRank - right.priorityRank;
      }

      if (!preferLowCost && left.costRank !== right.costRank) {
        return left.costRank - right.costRank;
      }

      return left.agent.agentId.localeCompare(right.agent.agentId);
    })[0]!;
  }

  private toSelection(
    candidate: CandidateSelection,
    reason: string,
  ): AgentSelection {
    return {
      agentId: candidate.agent.agentId,
      profileId: candidate.profileId,
      reason,
    };
  }
}

function getCostRank(costTier: "low" | "medium" | "high"): number {
  switch (costTier) {
    case "low":
      return 0;
    case "medium":
      return 1;
    case "high":
      return 2;
  }
}
