import type { ArtifactRecord, TaskSpec } from "../../../domain/models.js";
import type {
  DelegatedTaskTemplate,
  ManagerCoordinationOutput,
} from "../core.js";
import { isPlainObject, readNonEmptyString } from "../helpers/index.js";

export function buildDelegatedTaskDedupSignature(task: TaskSpec): string {
  const skillId =
    typeof task.metadata?.skillId === "string"
      ? task.metadata.skillId.trim().toLowerCase()
      : "";
  const skillArgs = isPlainObject(task.metadata?.skillArgs)
    ? stableSerialize(task.metadata.skillArgs)
    : "";
  const expectedArtifacts = task.expectedArtifacts
    .map((artifact) => artifact.replace(/\s+/g, " ").trim().toLowerCase())
    .sort()
    .join("|");
  const normalizedTitle = task.title.replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedGoal = task.goal.replace(/\s+/g, " ").trim().toLowerCase();
  return [normalizedTitle, normalizedGoal, skillId, expectedArtifacts, skillArgs].join("::");
}

export function extractLatestStructuredOutput(
  artifacts: ArtifactRecord[],
): unknown {
  const structuredArtifact = [...artifacts]
    .reverse()
    .find((artifact) => artifact.kind === "structured_output");
  if (!structuredArtifact) {
    return undefined;
  }

  const metadata = structuredArtifact.metadata as Record<string, unknown>;
  if ("output" in metadata) {
    return metadata.output;
  }
  if ("structuredOutput" in metadata) {
    return metadata.structuredOutput;
  }
  return undefined;
}

export function extractManagerCoordinationOutput(
  value: unknown,
): ManagerCoordinationOutput {
  if (!isPlainObject(value)) {
    return {
      delegatedTasks: [],
    };
  }

  const managerReply = readNonEmptyString(value.managerReply);
  const managerDecision =
    value.managerDecision === "continue" || value.managerDecision === "no_more_tasks"
      ? value.managerDecision
      : undefined;

  return {
    delegatedTasks: extractDelegatedTaskTemplates(value),
    ...(managerReply ? { managerReply } : {}),
    ...(managerDecision ? { managerDecision } : {}),
  };
}

export function extractDelegatedTaskTemplates(
  value: unknown,
): DelegatedTaskTemplate[] {
  if (!isPlainObject(value)) {
    return [];
  }

  const rootDelegated = value.delegatedTasks;
  if (Array.isArray(rootDelegated)) {
    return rootDelegated.filter(isPlainObject);
  }

  const rootTasks = value.tasks;
  if (Array.isArray(rootTasks)) {
    return rootTasks.filter(isPlainObject);
  }

  const delegate = value.delegate;
  if (isPlainObject(delegate) && Array.isArray(delegate.tasks)) {
    return delegate.tasks.filter(isPlainObject);
  }

  return [];
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (!isPlainObject(value)) {
    return JSON.stringify(String(value));
  }
  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`);
  return `{${entries.join(",")}}`;
}
