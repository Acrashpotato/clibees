import path from "node:path";
import type { TaskSpec } from "../../../domain/models.js";
import { createId, resolvePath } from "../../../shared/runtime.js";
import type { DelegatedTaskDraft, DelegatedTaskTemplate } from "../core.js";
import { readNonEmptyString, readStringArray, dedupeStrings } from "./core.js";

export function buildDelegatedTaskDraft(
  template: DelegatedTaskTemplate,
  index: number,
): DelegatedTaskDraft {
  return {
    template,
    index,
    taskId: createId("task"),
    title:
      readNonEmptyString(template.title) ?? `Delegated worker task ${index + 1}`,
  };
}

export function buildDelegatedTaskReferenceMap(
  drafts: DelegatedTaskDraft[],
  managerTask: TaskSpec,
): Map<string, string[]> {
  const referenceMap = new Map<string, string[]>();

  addDelegatedTaskReference(referenceMap, managerTask.id, managerTask.id);
  addDelegatedTaskReference(referenceMap, managerTask.title, managerTask.id);

  for (const draft of drafts) {
    addDelegatedTaskReference(referenceMap, draft.taskId, draft.taskId);
    addDelegatedTaskReference(referenceMap, draft.title, draft.taskId);
  }

  return referenceMap;
}

export function addDelegatedTaskReference(
  referenceMap: Map<string, string[]>,
  reference: string,
  taskId: string,
): void {
  const normalizedReference = normalizeDelegatedTaskReference(reference);
  if (!normalizedReference) {
    return;
  }

  const existing = referenceMap.get(normalizedReference) ?? [];
  if (!existing.includes(taskId)) {
    referenceMap.set(normalizedReference, [...existing, taskId]);
  }
}

export function normalizeDelegatedTaskReference(reference: string): string {
  return reference.trim().replace(/\s+/g, " ").toLowerCase();
}

export function resolveDelegatedDependencyTaskIds(options: {
  dependencyRefs: string[];
  currentTaskId: string;
  managerTaskId: string;
  existingTaskIds: Set<string>;
  referenceMap: Map<string, string[]>;
}): string[] {
  const resolvedDependencies = [options.managerTaskId];

  for (const dependencyRef of options.dependencyRefs) {
    const trimmedDependencyRef = dependencyRef.trim();
    if (!trimmedDependencyRef) {
      continue;
    }

    if (options.existingTaskIds.has(trimmedDependencyRef)) {
      if (trimmedDependencyRef !== options.currentTaskId) {
        resolvedDependencies.push(trimmedDependencyRef);
      }
      continue;
    }

    const matches = options.referenceMap.get(
      normalizeDelegatedTaskReference(trimmedDependencyRef),
    );
    if (!matches || matches.length !== 1) {
      continue;
    }

    const dependencyTaskId = matches[0];
    if (dependencyTaskId !== options.currentTaskId) {
      resolvedDependencies.push(dependencyTaskId);
    }
  }

  return dedupeStrings(resolvedDependencies);
}

export function buildDelegatedTaskInstructions(options: {
  instructions: string[];
  expectedArtifacts: string[];
  workspacePath: string;
  allowOutsideWorkspaceWrites: boolean;
}): string[] {
  const instructions = options.instructions
    .map((instruction) => instruction.trim())
    .filter((instruction) => instruction.length > 0);
  const expectedArtifacts = options.expectedArtifacts
    .map((artifact) => artifact.trim())
    .filter((artifact) => artifact.length > 0);
  const expectedArtifactDirectories = resolveExpectedArtifactDirectories(
    expectedArtifacts,
    options.workspacePath,
  );

  if (expectedArtifacts.length > 0) {
    instructions.push(`Expected artifacts (exact target paths): ${expectedArtifacts.join(", ")}`);
    instructions.push("Do not replace the requested target paths with alternative folders.");
  }

  if (expectedArtifactDirectories.length > 0) {
    instructions.push(`Primary working directory should be: ${expectedArtifactDirectories[0]}.`);
  }

  if (options.allowOutsideWorkspaceWrites) {
    instructions.push(
      `Outside-workspace writes are allowed for this run. If expected artifacts are outside ${options.workspacePath}, write directly to those target paths.`,
    );
  } else {
    instructions.push(`Do not write outside workspace root: ${options.workspacePath}.`);
  }

  instructions.push(
    "Stay within the delegated task scope and avoid unrelated repository-wide checks unless explicitly required.",
  );

  return dedupeStrings(instructions);
}

export function resolveDelegatedWorkingDirectory(options: {
  expectedArtifacts: string[];
  fallbackWorkingDirectory: string;
  workspacePath: string;
  allowOutsideWorkspaceWrites: boolean;
}): string {
  const expectedArtifactDirectories = resolveExpectedArtifactDirectories(
    options.expectedArtifacts,
    options.workspacePath,
  );
  if (expectedArtifactDirectories.length === 0) {
    return options.fallbackWorkingDirectory;
  }

  const commonDirectory = findCommonPathRoot(expectedArtifactDirectories);
  if (!commonDirectory) {
    return options.fallbackWorkingDirectory;
  }

  if (isPathInsideRoot(options.workspacePath, commonDirectory)) {
    return commonDirectory;
  }

  // Keep delegated execution rooted in workspace to avoid read-only sandbox setups.
  // Workers can still write to explicit absolute targets when allowed.
  if (options.allowOutsideWorkspaceWrites) {
    return options.fallbackWorkingDirectory;
  }

  return options.fallbackWorkingDirectory;
}

export function resolveExpectedArtifactDirectories(
  expectedArtifacts: string[],
  workspacePath: string,
): string[] {
  const resolvedDirectories = expectedArtifacts
    .map((artifact) => artifact.trim())
    .filter((artifact) => artifact.length > 0)
    .map((artifact) =>
      path.isAbsolute(artifact)
        ? path.resolve(artifact)
        : path.resolve(workspacePath, artifact),
    )
    .map((artifactPath) => path.dirname(artifactPath));
  return dedupeStrings(resolvedDirectories);
}

export function findCommonPathRoot(paths: string[]): string | undefined {
  if (paths.length === 0) {
    return undefined;
  }

  let commonRoot = path.resolve(paths[0]!);
  for (const candidate of paths.slice(1)) {
    const resolvedCandidate = path.resolve(candidate);
    while (!isPathInsideRoot(commonRoot, resolvedCandidate)) {
      const parent = path.dirname(commonRoot);
      if (parent === commonRoot) {
        return undefined;
      }
      commonRoot = parent;
    }
  }

  return commonRoot;
}

export function isPathInsideRoot(root: string, candidate: string): boolean {
  const relativePath = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}
