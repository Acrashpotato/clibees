import { CONFIG_VERSION, type MultiAgentConfig } from "../domain/config.js";
import { resolvePath } from "../shared/runtime.js";

export function createDefaultConfig(
  baseDir: string = process.cwd(),
): MultiAgentConfig {
  return {
    version: CONFIG_VERSION,
    agents: [
      {
        id: "local-default",
        command: "node",
        priority: 1,
        profiles: [
          {
            id: "default",
            label: "Default",
            capabilities: ["planning"],
            defaultArgs: [
              "-e",
              "const prompt = process.argv[1] ?? ''; process.stdout.write(`local-default received:\\n${prompt}\\n`);",
            ],
            costTier: "low",
            defaultCwd: resolvePath(".", baseDir),
          },
        ],
      },
    ],
    planner: {
      mode: "static",
      agentId: "local-default",
    },
    routing: {
      defaultAgentId: "local-default",
      preferLowCost: true,
    },
    safety: {
      approvalThreshold: "high",
      blockedActions: [],
    },
    memory: {
      enabled: false,
      rootDir: resolvePath(".multi-agent/memory", baseDir),
    },
    workspace: {
      rootDir: resolvePath(".", baseDir),
      allowOutsideWorkspaceWrites: false,
    },
    validation: {
      defaultTimeoutMs: 60_000,
      enableBuildChecks: true,
    },
    logging: {
      level: "info",
      persistEvents: false,
    },
  };
}
