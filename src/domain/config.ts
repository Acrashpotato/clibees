import type { RiskLevel } from "./models.js";

export const CONFIG_VERSION = 1;
export const CONFIG_FILE_NAME = ".multi-agent.yaml";

export interface AgentProfileConfig {
  id: string;
  label: string;
  capabilities: string[];
  defaultArgs?: string[];
  defaultCwd?: string;
  costTier: "low" | "medium" | "high";
}

export interface AgentConfig {
  id: string;
  command: string;
  profiles: AgentProfileConfig[];
  priority?: number;
}

export interface PlannerConfig {
  mode: "static" | "delegated";
  agentId?: string;
}

export interface RoutingConfig {
  defaultAgentId?: string;
  preferLowCost: boolean;
}

export interface SafetyConfig {
  approvalThreshold: RiskLevel;
  blockedActions: string[];
}

export interface MemoryConfig {
  enabled: boolean;
  rootDir: string;
}

export interface WorkspaceConfig {
  rootDir: string;
  allowOutsideWorkspaceWrites: boolean;
}

export interface ValidationConfig {
  defaultTimeoutMs: number;
  enableBuildChecks: boolean;
}

export interface LoggingConfig {
  level: "debug" | "info" | "warn" | "error";
  persistEvents: boolean;
}

export interface MultiAgentConfig {
  version: number;
  agents: AgentConfig[];
  planner: PlannerConfig;
  routing: RoutingConfig;
  safety: SafetyConfig;
  memory: MemoryConfig;
  workspace: WorkspaceConfig;
  validation: ValidationConfig;
  logging: LoggingConfig;
}
