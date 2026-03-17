import type {
  AgentConfig,
  AgentProfileConfig,
  MultiAgentConfig,
} from "../domain/config.js";
import type { SelectedCli } from "../ui-api/selected-cli.js";

const RUN_PROFILE_ID = "default";
const SINGLE_AGENT_PRIORITY = 1;
const DEFAULT_PROFILE_ARGS: Record<SelectedCli, string[]> = {
  codex: ["exec", "--skip-git-repo-check", "-"],
  codefree: [],
  claude: [],
};

export function buildRunConfigForSelectedCli(
  baseConfig: MultiAgentConfig,
  selectedCli: SelectedCli,
  workspacePath: string,
): MultiAgentConfig {
  const selectedAgent = baseConfig.agents.find((agent) => agent.id === selectedCli);
  const templateProfile = selectedAgent?.profiles[0];
  const runProfile = buildRunProfile(selectedCli, templateProfile, workspacePath);

  const runAgent: AgentConfig = {
    id: selectedCli,
    command: selectedAgent?.command ?? selectedCli,
    priority: selectedAgent?.priority ?? SINGLE_AGENT_PRIORITY,
    profiles: [runProfile],
  };

  return {
    ...baseConfig,
    agents: [runAgent],
    planner: {
      ...baseConfig.planner,
      agentId: selectedCli,
    },
    routing: {
      ...baseConfig.routing,
      defaultAgentId: selectedCli,
    },
  };
}

function buildRunProfile(
  selectedCli: SelectedCli,
  templateProfile: AgentProfileConfig | undefined,
  workspacePath: string,
): AgentProfileConfig {
  const capabilities = Array.from(
    new Set([...(templateProfile?.capabilities ?? []), "planning"]),
  );
  const defaultArgs = templateProfile?.defaultArgs ?? DEFAULT_PROFILE_ARGS[selectedCli];

  return {
    id: RUN_PROFILE_ID,
    label: templateProfile?.label ?? "Default",
    capabilities,
    ...(defaultArgs.length > 0
      ? {
          defaultArgs: [...defaultArgs],
        }
      : {}),
    defaultCwd: workspacePath,
    costTier: templateProfile?.costTier ?? "low",
  };
}
