import type { MultiAgentConfig } from "../domain/config.js";
import { ConfiguredCliAdapter } from "../adapters/configured-cli-adapter.js";
import { AdapterRegistry } from "./adapter-registry.js";

export function createAdapterRegistry(config: MultiAgentConfig): AdapterRegistry {
  const registry = new AdapterRegistry();

  for (const agent of config.agents) {
    registry.register(new ConfiguredCliAdapter(agent));
  }

  return registry;
}
