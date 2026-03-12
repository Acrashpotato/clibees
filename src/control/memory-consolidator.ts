import type {
  ArtifactRecord,
  BlackboardEntry,
  MemoryKind,
  MemoryRecord,
  RunEvent,
  RunGraph,
  RunRecord,
  TaskSpec,
} from "../domain/models.js";
import { SCHEMA_VERSION } from "../domain/models.js";
import { createId } from "../shared/runtime.js";
import type { ProjectMemoryStore } from "../storage/project-memory-store.js";

export interface MemoryConsolidationInput {
  run: RunRecord;
  graph: RunGraph;
  events: RunEvent[];
  artifacts: ArtifactRecord[];
  blackboardEntries: BlackboardEntry[];
}

interface MemoryCandidate {
  kind: MemoryKind;
  scope: string;
  subject: string;
  content: string;
  tags: string[];
  sourceTaskId?: string;
  confidence: number;
  validFrom: string;
}

export class MemoryConsolidator {
  constructor(private readonly projectMemoryStore: ProjectMemoryStore) {}

  async consolidate(input: MemoryConsolidationInput): Promise<MemoryRecord[]> {
    const candidates = collectCandidates(input);
    if (candidates.length === 0) {
      return [];
    }

    const activeRecords = await this.projectMemoryStore.recall({
      text: "",
      scope: "project",
    });
    const activeByFamily = new Map(
      activeRecords.map((record) => [memoryFamilyKey(record.scope, record.kind, record.subject), record]),
    );
    const recordsToPersist: MemoryRecord[] = [];
    const nextRecords: MemoryRecord[] = [];

    for (const candidate of candidates) {
      const familyKey = memoryFamilyKey(candidate.scope, candidate.kind, candidate.subject);
      const existing = activeByFamily.get(familyKey);
      const nextRecord = toMemoryRecord(candidate, input.run.runId);

      if (existing && memoryContentEquals(existing, nextRecord)) {
        continue;
      }

      if (existing) {
        recordsToPersist.push({
          ...existing,
          schemaVersion: existing.schemaVersion ?? SCHEMA_VERSION,
          status: "superseded",
          validUntil: candidate.validFrom,
        });
      }

      recordsToPersist.push(nextRecord);
      nextRecords.push(nextRecord);
      activeByFamily.set(familyKey, nextRecord);
    }

    if (recordsToPersist.length > 0) {
      await this.projectMemoryStore.persist(recordsToPersist);
    }

    return nextRecords;
  }
}

function collectCandidates(input: MemoryConsolidationInput): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  const latestValidationByTask = latestArtifactByTask(input.artifacts, "validation_result");
  const latestApprovalByRequest = latestApprovalArtifacts(input.artifacts);

  for (const task of Object.values(input.graph.tasks)) {
    const validationArtifact = latestValidationByTask.get(task.id);
    const validationSummary =
      validationArtifact?.summary ??
      latestBlackboardSummary(input.blackboardEntries, "validation", task.id) ??
      findLatestTaskReason(input.events, task.id) ??
      `Task \"${task.title}\" reached status ${task.status}.`;

    if (task.status === "completed") {
      candidates.push({
        kind: "decision",
        scope: "project",
        subject: `Validated task ${task.title}`,
        content: validationSummary,
        tags: ["validation", "completed", task.kind],
        sourceTaskId: task.id,
        confidence: 0.92,
        validFrom: input.run.updatedAt,
      });
      continue;
    }

    if (isFailureStatus(task.status)) {
      candidates.push({
        kind: "risk",
        scope: "project",
        subject: `Issue in ${task.title}`,
        content: validationSummary,
        tags: ["validation", "risk", task.status],
        sourceTaskId: task.id,
        confidence: 0.88,
        validFrom: input.run.updatedAt,
      });
    }
  }

  for (const artifact of latestApprovalByRequest.values()) {
    const metadata = artifact.metadata;
    const decision =
      typeof metadata.decision === "string"
        ? metadata.decision
        : undefined;
    if (decision !== "approved" && decision !== "rejected") {
      continue;
    }

    const taskTitle = resolveTaskTitle(input.graph, artifact.taskId);
    candidates.push({
      kind: decision === "approved" ? "decision" : "risk",
      scope: "project",
      subject: `Approval outcome for ${taskTitle}`,
      content: artifact.summary,
      tags: ["approval", decision],
      sourceTaskId: artifact.taskId,
      confidence: 0.9,
      validFrom: input.run.updatedAt,
    });
  }

  return dedupeCandidates(candidates);
}

function latestArtifactByTask(
  artifacts: ArtifactRecord[],
  kind: ArtifactRecord["kind"],
): Map<string, ArtifactRecord> {
  const latest = new Map<string, ArtifactRecord>();
  for (const artifact of artifacts) {
    if (artifact.kind !== kind || !artifact.taskId) {
      continue;
    }

    const current = latest.get(artifact.taskId);
    if (!current || artifact.createdAt.localeCompare(current.createdAt) > 0) {
      latest.set(artifact.taskId, artifact);
    }
  }
  return latest;
}

function latestApprovalArtifacts(artifacts: ArtifactRecord[]): Map<string, ArtifactRecord> {
  const latest = new Map<string, ArtifactRecord>();
  for (const artifact of artifacts) {
    if (artifact.kind !== "approval_record") {
      continue;
    }
    const requestId =
      typeof artifact.metadata.requestId === "string"
        ? artifact.metadata.requestId
        : undefined;
    if (!requestId) {
      continue;
    }

    const current = latest.get(requestId);
    if (!current || artifact.createdAt.localeCompare(current.createdAt) > 0) {
      latest.set(requestId, artifact);
    }
  }
  return latest;
}

function latestBlackboardSummary(
  entries: BlackboardEntry[],
  scope: BlackboardEntry["scope"],
  taskId: string,
): string | undefined {
  return entries
    .filter((entry) => entry.scope === scope && entry.taskId === taskId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.summary;
}

function findLatestTaskReason(events: RunEvent[], taskId: string): string | undefined {
  const event = [...events]
    .reverse()
    .find(
      (candidate) =>
        candidate.taskId === taskId &&
        (candidate.type === "validation_failed" ||
          candidate.type === "task_blocked" ||
          candidate.type === "task_failed"),
    );

  if (!event) {
    return undefined;
  }

  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.summary === "string") {
    return payload.summary;
  }
  if (Array.isArray(payload.reasons)) {
    const reasons = payload.reasons.filter((value): value is string => typeof value === "string");
    if (reasons.length > 0) {
      return reasons.join(" ");
    }
  }
  return undefined;
}

function isFailureStatus(status: TaskSpec["status"]): boolean {
  return status === "blocked" || status === "failed_retryable" || status === "failed_terminal";
}

function resolveTaskTitle(graph: RunGraph, taskId?: string): string {
  if (!taskId) {
    return "run";
  }
  return graph.tasks[taskId]?.title ?? taskId;
}

function dedupeCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const unique = new Map<string, MemoryCandidate>();
  for (const candidate of candidates) {
    unique.set(memoryFamilyKey(candidate.scope, candidate.kind, candidate.subject), {
      ...candidate,
      tags: normalizeTags(candidate.tags),
    });
  }
  return [...unique.values()];
}

function toMemoryRecord(candidate: MemoryCandidate, sourceRunId: string): MemoryRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: createId("memory"),
    kind: candidate.kind,
    scope: candidate.scope,
    subject: candidate.subject,
    content: candidate.content,
    tags: normalizeTags(candidate.tags),
    sourceRunId,
    ...(candidate.sourceTaskId ? { sourceTaskId: candidate.sourceTaskId } : {}),
    confidence: candidate.confidence,
    validFrom: candidate.validFrom,
    status: "active",
  };
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.filter((tag) => tag.trim().length > 0))].sort();
}

function memoryFamilyKey(scope: string, kind: MemoryKind, subject: string): string {
  return `${scope}::${kind}::${subject}`.toLowerCase();
}

function memoryContentEquals(left: MemoryRecord, right: MemoryRecord): boolean {
  return (
    left.kind === right.kind &&
    left.scope === right.scope &&
    left.subject === right.subject &&
    left.content === right.content &&
    JSON.stringify(normalizeTags(left.tags)) === JSON.stringify(normalizeTags(right.tags))
  );
}
