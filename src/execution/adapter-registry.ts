import type { AgentCapability } from "../domain/models.js";
import type { AgentAdapter } from "./agent-adapter.js";

export interface AdapterProbeResult {
  agentId: string;
  adapter: AgentAdapter;
  available: boolean;
  cached: boolean;
  capability?: AgentCapability;
  error?: string;
}

export interface AvailableAgent {
  agentId: string;
  adapter: AgentAdapter;
  capability: AgentCapability;
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, AgentAdapter>();
  private readonly probeCache = new Map<string, AdapterProbeResult>();

  register(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.agentId)) {
      throw new Error(`Adapter "${adapter.agentId}" is already registered.`);
    }

    this.adapters.set(adapter.agentId, adapter);
    this.probeCache.delete(adapter.agentId);
  }

  get(agentId: string): AgentAdapter {
    const adapter = this.adapters.get(agentId);

    if (!adapter) {
      throw new Error(`Adapter "${agentId}" is not registered.`);
    }

    return adapter;
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()];
  }

  async probeAll(forceRefresh = false): Promise<AdapterProbeResult[]> {
    return Promise.all(
      this.list().map(async (adapter) => this.probeAdapter(adapter, forceRefresh)),
    );
  }

  async getAvailableAgents(
    requiredCapabilities: string[] = [],
    forceRefresh = false,
  ): Promise<AvailableAgent[]> {
    const results = await this.probeAll(forceRefresh);

    return results
      .filter(
        (result): result is AdapterProbeResult & { capability: AgentCapability } =>
          result.available === true && Boolean(result.capability),
      )
      .filter((result) =>
        requiredCapabilities.every((capability) =>
          result.capability.supportedCapabilities.includes(capability),
        ),
      )
      .map((result) => ({
        agentId: result.agentId,
        adapter: result.adapter,
        capability: result.capability,
      }));
  }

  private async probeAdapter(
    adapter: AgentAdapter,
    forceRefresh: boolean,
  ): Promise<AdapterProbeResult> {
    if (!forceRefresh) {
      const cached = this.probeCache.get(adapter.agentId);
      if (cached) {
        return {
          ...cached,
          cached: true,
        };
      }
    }

    try {
      const capability = await adapter.probe();
      const result: AdapterProbeResult = {
        agentId: adapter.agentId,
        adapter,
        available: true,
        cached: false,
        capability,
      };
      this.probeCache.set(adapter.agentId, result);
      return result;
    } catch (error) {
      const result: AdapterProbeResult = {
        agentId: adapter.agentId,
        adapter,
        available: false,
        cached: false,
        error: error instanceof Error ? error.message : String(error),
      };
      this.probeCache.set(adapter.agentId, result);
      return result;
    }
  }
}
