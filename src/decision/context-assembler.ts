import type { ContextBundle, RunGraph, TaskSpec } from "../domain/models.js";
import type { AgentSelection } from "./router.js";
import type { ArtifactStore } from "../storage/artifact-store.js";
import type { BlackboardStore } from "../storage/blackboard-store.js";
import type { ProjectMemoryStore } from "../storage/project-memory-store.js";
import type { WorkspaceStateStore } from "../storage/workspace-state-store.js";

export interface ContextAssemblyInput {
  task: TaskSpec;
  selection: AgentSelection;
  graph: RunGraph;
}

export interface ContextAssembler {
  buildContext(input: ContextAssemblyInput): Promise<ContextBundle>;
}

export interface DefaultContextAssemblerDependencies {
  blackboardStore: BlackboardStore;
  artifactStore: ArtifactStore;
  projectMemoryStore: ProjectMemoryStore;
  workspaceStateStore: WorkspaceStateStore;
}

export class DefaultContextAssembler implements ContextAssembler {
  constructor(
    private readonly dependencies: DefaultContextAssemblerDependencies,
  ) {}

  async buildContext(input: ContextAssemblyInput): Promise<ContextBundle> {
    const runId = input.graph.runId;
    const [blackboardEntries, artifacts, memories, workspaceSnapshot] =
      await Promise.all([
        this.dependencies.blackboardStore.list(runId),
        this.dependencies.artifactStore.list(runId),
        this.dependencies.projectMemoryStore.recall({
          text: `${input.task.title} ${input.task.goal}`,
          scope: "project",
        }),
        this.dependencies.workspaceStateStore.capture(
          runId,
          input.task.id,
          input.task.workingDirectory,
        ),
      ]);

    const relevantBlackboardEntries = blackboardEntries.filter(
      (entry) => !entry.taskId || entry.taskId === input.task.id,
    );
    const relevantArtifacts = artifacts.filter(
      (artifact) => !artifact.taskId || artifact.taskId === input.task.id,
    );

    const relevantFacts = relevantBlackboardEntries
      .filter((entry) => entry.scope === "agent" || entry.scope === "validation")
      .map((entry) => entry.summary);
    const relevantDecisions = [
      ...relevantBlackboardEntries
        .filter((entry) => entry.scope === "planner" || entry.scope === "approval")
        .map((entry) => entry.summary),
      ...memories
        .filter(
          (memory) =>
            memory.kind === "decision" ||
            memory.kind === "constraint" ||
            memory.kind === "risk",
        )
        .map((memory) => `${memory.subject}: ${memory.content}`),
    ];
    const artifactSummaries = relevantArtifacts.map(
      (artifact) => `${artifact.summary} (${artifact.kind}: ${artifact.uri})`,
    );
    const transcriptRefs = [
      ...new Set(
        relevantBlackboardEntries.flatMap((entry) => entry.references).filter(Boolean),
      ),
    ];
    const workspaceSummary = buildWorkspaceSummary(workspaceSnapshot);

    const bundle: ContextBundle = {
      taskBrief: buildTaskBrief(input.task),
      relevantFacts,
      relevantDecisions,
      artifactSummaries,
      workspaceSummary,
      transcriptRefs,
      budget: input.task.budget,
      agentHints: [
        `Selected agent: ${input.selection.agentId}/${input.selection.profileId}`,
        input.selection.reason,
      ],
    };

    return enforceBudget(bundle, input.task.budget?.maxInputChars);
  }
}

function buildTaskBrief(task: TaskSpec): string {
  const instructions =
    task.instructions.length > 0
      ? task.instructions.map((instruction) => `- ${instruction}`).join("\n")
      : "- Follow the task goal.";
  return [
    `Task: ${task.title}`,
    `Kind: ${task.kind}`,
    `Goal: ${task.goal}`,
    "Instructions:",
    instructions,
  ].join("\n");
}

function buildWorkspaceSummary(snapshot: {
  workingDirectory: string;
  trackedFiles: string[];
  branch?: string;
  head?: string;
}): string {
  const preview = snapshot.trackedFiles.slice(0, 8);
  const lines = [
    `Working directory: ${snapshot.workingDirectory}`,
    `Tracked files (${snapshot.trackedFiles.length}): ${
      preview.length > 0 ? preview.join(", ") : "(none)"
    }`,
  ];

  if (snapshot.branch) {
    lines.push(`Branch: ${snapshot.branch}`);
  }
  if (snapshot.head) {
    lines.push(`HEAD: ${snapshot.head}`);
  }

  return lines.join("\n");
}

function enforceBudget(
  bundle: ContextBundle,
  maxInputChars?: number,
): ContextBundle {
  if (!maxInputChars || maxInputChars <= 0) {
    return bundle;
  }

  const nextBundle: ContextBundle = {
    ...bundle,
    relevantFacts: [...bundle.relevantFacts],
    relevantDecisions: [...bundle.relevantDecisions],
    artifactSummaries: [...bundle.artifactSummaries],
    transcriptRefs: [...bundle.transcriptRefs],
    agentHints: [...bundle.agentHints],
  };

  while (measureBundle(nextBundle) > maxInputChars) {
    if (nextBundle.transcriptRefs.length > 0) {
      nextBundle.transcriptRefs.pop();
      continue;
    }

    if (nextBundle.artifactSummaries.length > 0) {
      nextBundle.artifactSummaries.pop();
      continue;
    }

    if (nextBundle.relevantFacts.length > 0) {
      nextBundle.relevantFacts.pop();
      continue;
    }

    if (nextBundle.relevantDecisions.length > 0) {
      nextBundle.relevantDecisions.pop();
      continue;
    }

    if (nextBundle.workspaceSummary.length > 120) {
      nextBundle.workspaceSummary = truncate(nextBundle.workspaceSummary, 120);
      continue;
    }

    nextBundle.taskBrief = truncate(
      nextBundle.taskBrief,
      Math.max(80, maxInputChars),
    );
    break;
  }

  return nextBundle;
}

function measureBundle(bundle: ContextBundle): number {
  return [
    bundle.taskBrief,
    bundle.workspaceSummary,
    ...bundle.relevantFacts,
    ...bundle.relevantDecisions,
    ...bundle.artifactSummaries,
    ...bundle.transcriptRefs,
    ...bundle.agentHints,
  ].reduce((total, value) => total + value.length, 0);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
