import { createId, isoNow } from "../../../shared/runtime.js";
import type {
  ActionPlan,
  RunEvent,
  RunGraph,
  RunRecord,
  TaskSpec,
} from "../../../domain/models.js";
import type {
  SkillDefinition,
  SkillDiscoveryMatch,
} from "../../skills/types.js";
import type { DelegatedTaskDraft, ExecutionServices } from "../core.js";
import { readNonEmptyString, shouldUseDelegatedBootstrap } from "../helpers/index.js";

export interface DelegatedSkillBindings {
  skillByTaskId: Map<string, SkillDefinition | null>;
  missingSkillIds: string[];
  missingSkillSuggestions: Record<string, SkillDiscoveryMatch[]>;
  approvedMissingSkillIds: Set<string>;
}

export async function resolveDelegatedSkillBindings(
  this: any,
  run: RunRecord,
  drafts: DelegatedTaskDraft[],
  services: ExecutionServices,
): Promise<DelegatedSkillBindings> {
  const skillByTaskId = new Map<string, SkillDefinition | null>();
  const missingSkillIds = new Set<string>();
  const missingSkillSuggestions: Record<string, SkillDiscoveryMatch[]> = {};
  const approvedMissingSkillIds = await this.resolveApprovedMissingSkillIds(run.runId);

  for (const draft of drafts) {
    const requestedSkillId = readNonEmptyString(draft.template.skillId);
    if (!requestedSkillId) {
      skillByTaskId.set(draft.taskId, null);
      continue;
    }

    const normalizedSkillId = normalizeSkillId(requestedSkillId);
    const resolvedSkill = await services.skillRegistry.getSkill(
      run.workspacePath,
      requestedSkillId,
    );
    skillByTaskId.set(draft.taskId, resolvedSkill);

    if (resolvedSkill || approvedMissingSkillIds.has(normalizedSkillId)) {
      continue;
    }

    missingSkillIds.add(requestedSkillId);
    missingSkillSuggestions[requestedSkillId] =
      await services.skillDiscoveryAdapter.findSkills(
        run.workspacePath,
        requestedSkillId,
        { limit: 3 },
      );
  }

  return {
    skillByTaskId,
    missingSkillIds: [...missingSkillIds],
    missingSkillSuggestions,
    approvedMissingSkillIds,
  };
}

export async function resolveApprovedMissingSkillIds(
  this: any,
  runId: string,
): Promise<Set<string>> {
  const events = await this.dependencies.eventStore.list(runId);
  const requestSkillMap = new Map<string, string[]>();
  const approved = new Set<string>();

  for (const event of events) {
    if (event.type !== "approval_requested") {
      continue;
    }
    const payload = event.payload as Record<string, unknown>;
    if (payload.source !== "skill_missing") {
      continue;
    }
    const requestId = readNonEmptyString(payload.requestId);
    if (!requestId) {
      continue;
    }
    const skillIds = readStringArray(payload.missingSkillIds);
    if (skillIds.length > 0) {
      requestSkillMap.set(requestId, skillIds.map((skillId) => normalizeSkillId(skillId)));
    }
  }

  for (const event of events) {
    if (event.type !== "approval_decided") {
      continue;
    }
    const payload = event.payload as Record<string, unknown>;
    if (payload.decision !== "approved") {
      continue;
    }
    const requestId = readNonEmptyString(payload.requestId);
    if (!requestId) {
      continue;
    }
    const skillIds = requestSkillMap.get(requestId) ?? [];
    for (const skillId of skillIds) {
      approved.add(skillId);
    }
  }

  return approved;
}

export async function requestMissingSkillApproval(
  this: any,
  run: RunRecord,
  graph: RunGraph,
  managerTask: TaskSpec,
  missingSkillIds: string[],
  missingSkillSuggestions: Record<string, SkillDiscoveryMatch[]>,
  services: ExecutionServices,
): Promise<void> {
  if (missingSkillIds.length === 0) {
    return;
  }

  const actionPlans: ActionPlan[] = missingSkillIds.map((skillId) => ({
    id: createId("action"),
    kind: "skill_install",
    targets: [skillId],
    riskLevel: "high",
    requiresApproval: true,
    reason: buildSkillApprovalReason(skillId, missingSkillSuggestions[skillId] ?? []),
  }));

  const request = await services.approvalManager.createRequest(
    run.runId,
    managerTask.id,
    actionPlans,
    `Manual confirmation required for missing workflow skills: ${missingSkillIds.join(", ")}.`,
  );

  await this.dependencies.runStore.updateTaskStatus(run.runId, managerTask.id, {
    status: "awaiting_approval",
    finishedAt: null,
  });

  await this.appendProjectedEvent(
    this.createEvent("approval_requested", run.runId, {
      taskId: managerTask.id,
      requestId: request.id,
      reason: request.reason,
      actionKinds: actionPlans.map((action) => action.kind),
      actionCount: actionPlans.length,
      source: "skill_missing",
      missingSkillIds,
      discovery: summarizeSkillSuggestions(missingSkillSuggestions),
    }),
    services.blackboardStore,
  );

  await this.recordArtifact(
    run.runId,
    managerTask.id,
    "approval_record",
    services,
    `artifact://run/${run.runId}/task/${managerTask.id}/approval/${request.id}/request`,
    "Approval requested before proceeding with missing workflow skills.",
    {
      requestId: request.id,
      reason: request.reason,
      actionPlans,
      missingSkillIds,
      discovery: missingSkillSuggestions,
    },
  );

  if (shouldUseDelegatedBootstrap(run.metadata)) {
    const { session } = await this.ensureDelegatedManagerSession(run, graph);
    const readableSuggestions = missingSkillIds
      .map((skillId) => {
        const suggestions = missingSkillSuggestions[skillId] ?? [];
        if (suggestions.length === 0) {
          return `- ${skillId}: no local candidates found`;
        }
        return `- ${skillId}: ${suggestions.map((item) => item.skillId).join(", ")}`;
      })
      .join("\n");
    await this.appendThreadMessageWithAudit(
      run,
      services,
      {
        runId: run.runId,
        threadId: session.threadId,
        sessionId: session.sessionId,
        role: "system",
        actorId: "system",
        body: [
          "Missing workflow skill confirmation is required before creating delegated worker tasks.",
          `Requested skills: ${missingSkillIds.join(", ")}`,
          `Candidate local skills:\n${readableSuggestions}`,
        ].join("\n"),
        clientRequestId: `skill-approval:${managerTask.id}:${isoNow()}`,
        metadata: {
          source: "skill_discovery_gate",
          taskId: managerTask.id,
          missingSkillIds,
        },
      },
      managerTask.id,
    );
  }
}

export async function buildAvailableSkillSummary(
  this: any,
  run: RunRecord,
  services: ExecutionServices,
): Promise<string[]> {
  const skills = await services.skillRegistry.listSkills(run.workspacePath);
  return skills
    .slice(0, 12)
    .map((skill) =>
      skill.description
        ? `${skill.id}: ${skill.description}`
        : `${skill.id}: ${skill.name}`,
    );
}

function buildSkillApprovalReason(
  skillId: string,
  suggestions: SkillDiscoveryMatch[],
): string {
  if (suggestions.length === 0) {
    return `Requested skill "${skillId}" is missing. Confirm to proceed without auto-installation.`;
  }

  const candidates = suggestions.map((item) => item.skillId).join(", ");
  return `Requested skill "${skillId}" is missing. Candidate local skills: ${candidates}. Confirm to proceed without auto-installation.`;
}

function summarizeSkillSuggestions(
  value: Record<string, SkillDiscoveryMatch[]>,
): Record<string, string[]> {
  const summarized: Record<string, string[]> = {};
  for (const [skillId, suggestions] of Object.entries(value)) {
    summarized[skillId] = suggestions.map((item) => item.skillId);
  }
  return summarized;
}

function normalizeSkillId(skillId: string): string {
  return skillId.trim().toLowerCase();
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => readNonEmptyString(item))
    .filter((item): item is string => Boolean(item));
}
