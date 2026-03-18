import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  GraphPatch,
  InvocationPlan,
  RunEvent,
  TaskSpec,
  ValidationResult,
} from "../../../domain/models.js";
import { pathExists, resolvePath } from "../../../shared/runtime.js";

type FileManifest = Map<string, { size: number; mtimeMs: number }>;

export function hasMeaningfulGraphPatch(patch: GraphPatch): boolean {
  switch (patch.operation) {
    case "append_tasks":
      return (patch.tasks?.length ?? 0) > 0;
    case "cancel_pending_tasks":
      return (patch.targetTaskIds?.length ?? 0) > 0;
    case "replace_pending_subgraph":
      return (patch.targetTaskIds?.length ?? 0) > 0 && (patch.tasks?.length ?? 0) > 0;
    default:
      return false;
  }
}

export function summarizeApprovalReason(
  actions: Array<{ kind: string; reason: string }>,
): string {
  const descriptions = actions.map((action) => `${action.kind}: ${action.reason}`);
  return `Approval required for actions: ${descriptions.join("; ")}`;
}

export function mapValidationOutcomeToTaskStatus(
  result: ValidationResult,
  task: TaskSpec,
  attempts: number,
): TaskSpec["status"] {
  if (result.outcome === "blocked") {
    return "blocked";
  }
  if (result.outcome === "fail_retryable" && attempts < task.retryPolicy.maxAttempts) {
    return "failed_retryable";
  }
  return "failed_terminal";
}

const POLICY_BLOCK_MARKERS = [
  "blocked by policy",
  "rejected: blocked by policy",
  "policy blocked",
  "sandbox: read-only",
  "sandbox read-only",
  "read-only filesystem",
  "outside project",
  "outside workspace",
  "permission denied by sandbox",
];

const ADAPTER_ERROR_MARKERS = [
  "windows sandbox: setup refresh failed",
  "sandbox: setup refresh failed",
  "sandbox setup refresh failed",
  "setup refresh failed",
  "sandbox refresh failed",
  "sandbox unavailable",
  "sandbox initialize",
  "transport closed",
  "connection reset",
];

export interface ExecutionFailureClassification {
  kind: "policy_blocked" | "adapter_error" | "timeout" | "terminal";
  summary: string;
  retryReason?: "adapter_error" | "timeout";
  markers: string[];
}

export function classifyExecutionFailure(
  event: RunEvent,
): ExecutionFailureClassification {
  if (event.type !== "task_failed") {
    return {
      kind: "terminal",
      summary: "Execution ended without a task_failed event.",
      markers: [],
    };
  }

  const payload = toRecord(event.payload);
  const reason = readString(payload.reason).toLowerCase();
  const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
  const haystack = [
    readString(payload.error),
    readString(payload.reason),
    readString(payload.stderr),
    readString(payload.output),
  ]
    .filter((value) => value.length > 0)
    .join("\n")
    .toLowerCase();
  const policyMarkers = POLICY_BLOCK_MARKERS.filter((marker) =>
    haystack.includes(marker),
  );
  if (policyMarkers.length > 0) {
    return {
      kind: "policy_blocked",
      summary: "Execution output indicates sandbox/policy blocking.",
      markers: policyMarkers,
    };
  }

  if (reason === "timeout" || haystack.includes("timed out")) {
    return {
      kind: "timeout",
      summary: "Execution exceeded the task timeout.",
      retryReason: "timeout",
      markers: reason === "timeout" ? ["reason:timeout"] : ["timed out"],
    };
  }

  const adapterMarkers = ADAPTER_ERROR_MARKERS.filter((marker) =>
    haystack.includes(marker),
  );
  if (adapterMarkers.length > 0 || exitCode === -1) {
    return {
      kind: "adapter_error",
      summary: "Execution failed due to runtime/adapter infrastructure.",
      retryReason: "adapter_error",
      markers:
        adapterMarkers.length > 0 ? adapterMarkers : ["exit_code:-1"],
    };
  }

  return {
    kind: "terminal",
    summary: "Execution failed with a non-retryable command/runtime error.",
    markers: [],
  };
}

export function shouldRetryExecutionFailure(
  task: TaskSpec,
  attempts: number,
  classification: ExecutionFailureClassification,
): boolean {
  if (attempts >= task.retryPolicy.maxAttempts) {
    return false;
  }

  const reason = classification.retryReason;
  if (!reason) {
    return false;
  }

  return task.retryPolicy.retryOn.includes(reason);
}

export function summarizeCommandResult(
  eventType: RunEvent["type"],
  exitCode: number | null,
): string {
  if (eventType === "task_completed") {
    return `Command completed with exit code ${exitCode ?? 0}.`;
  }
  return `Command failed with exit code ${exitCode ?? -1}.`;
}

export function extractStructuredOutputFromPayload(
  payload: Record<string, unknown>,
): unknown {
  if ("structuredOutput" in payload) {
    return payload.structuredOutput;
  }
  if ("structured_output" in payload) {
    return payload.structured_output;
  }
  if ("output" in payload) {
    return payload.output;
  }
  return undefined;
}

export function buildBlackboardProjection(
  event: RunEvent,
):
  | {
      id: string;
      scope: "planner" | "agent" | "validation" | "approval";
      summary: string;
      references: string[];
    }
  | null {
  const payload = event.payload as Record<string, unknown>;
  const eventRef = `event://${event.runId}/${event.id}`;

  switch (event.type) {
    case "task_planned":
      return {
        id: `planner:${event.taskId ?? "run"}:task_planned`,
        scope: "planner",
        summary: `Planned task ${String(payload.title ?? event.taskId ?? "unknown")}.`,
        references: [eventRef],
      };
    case "agent_selected":
      return {
        id: `agent:${event.taskId ?? "run"}:agent_selected`,
        scope: "agent",
        summary: `Selected agent ${String(payload.agentId ?? "unknown")} for ${event.taskId ?? "run"}.`,
        references: [eventRef],
      };
    case "context_built":
      return {
        id: `agent:${event.taskId ?? "run"}:context_built`,
        scope: "agent",
        summary: `Built context with ${String(payload.relevantFacts ?? 0)} facts and ${String(payload.artifactSummaries ?? 0)} artifact summaries.`,
        references: [eventRef],
      };
    case "invocation_planned":
      return {
        id: `agent:${event.taskId ?? "run"}:invocation_planned`,
        scope: "agent",
        summary: `Planned invocation ${String(payload.command ?? "unknown")} for ${event.taskId ?? "run"}.`,
        references: [eventRef],
      };
    case "approval_requested":
      return {
        id: `approval:${event.taskId ?? "run"}:approval_requested`,
        scope: "approval",
        summary: `Approval requested for ${String(payload.actionCount ?? 0)} action(s).`,
        references: [eventRef],
      };
    case "approval_decided":
      return {
        id: `approval:${event.taskId ?? "run"}:approval_decided`,
        scope: "approval",
        summary: `Approval ${String(payload.decision ?? "unknown")} by ${String(payload.actor ?? "unknown")}.`,
        references: [eventRef],
      };
    case "validation_started":
      return {
        id: `validation:${event.taskId ?? "run"}:validation_started`,
        scope: "validation",
        summary: `Validation started in ${String(payload.validatorMode ?? "unknown")} mode.`,
        references: [eventRef],
      };
    case "validation_passed":
      return {
        id: `validation:${event.taskId ?? "run"}:validation_passed`,
        scope: "validation",
        summary: String(payload.summary ?? "Validation passed."),
        references: [eventRef],
      };
    case "validation_failed":
      return {
        id: `validation:${event.taskId ?? "run"}:validation_failed`,
        scope: "validation",
        summary: String(payload.summary ?? `Validation failed with ${String(payload.outcome ?? "unknown")}.`),
        references: [eventRef],
      };
    case "replan_requested":
      return {
        id: `planner:${event.taskId ?? "run"}:replan_requested`,
        scope: "planner",
        summary: String(payload.summary ?? "Replan requested."),
        references: [eventRef],
      };
    case "replan_applied":
      return {
        id: `planner:${event.taskId ?? "run"}:replan_applied`,
        scope: "planner",
        summary: `Applied ${String(payload.operation ?? "unknown")} patch.`,
        references: [eventRef],
      };
    default:
      return null;
  }
}

export async function captureFileManifest(rootDir: string): Promise<FileManifest> {
  const manifest: FileManifest = new Map();
  const ignoredDirectories = new Set([".git", ".multi-agent", "dist", "node_modules"]);

  const visit = async (directoryPath: string): Promise<void> => {
    if (!(await pathExists(directoryPath))) {
      return;
    }

    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join("/");

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }
        await visit(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        const fileStat = await stat(absolutePath);
        manifest.set(relativePath, {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
        });
      }
    }
  };

  await visit(rootDir);
  return manifest;
}

export function diffFileManifest(before: FileManifest, after: FileManifest): Array<{
  path: string;
  changeType: "added" | "modified" | "deleted";
}> {
  const changes: Array<{ path: string; changeType: "added" | "modified" | "deleted" }> = [];
  const allPaths = [...new Set([...before.keys(), ...after.keys()])].sort();

  for (const filePath of allPaths) {
    const previous = before.get(filePath);
    const current = after.get(filePath);
    if (!previous && current) {
      changes.push({ path: filePath, changeType: "added" });
      continue;
    }
    if (previous && !current) {
      changes.push({ path: filePath, changeType: "deleted" });
      continue;
    }
    if (
      previous &&
      current &&
      (previous.size !== current.size || previous.mtimeMs !== current.mtimeMs)
    ) {
      changes.push({ path: filePath, changeType: "modified" });
    }
  }

  return changes;
}

export function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
