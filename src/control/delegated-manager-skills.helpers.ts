import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { TaskSpec } from "../domain/models.js";

export async function writeSkillFile(
  workspaceDir: string,
  skill: {
    id: string;
    name: string;
    description: string;
    template: Record<string, unknown>;
  },
): Promise<void> {
  const skillsDir = path.join(workspaceDir, "skills");
  await mkdir(skillsDir, { recursive: true });
  await writeFile(
    path.join(skillsDir, `${skill.id}.json`),
    `${JSON.stringify(skill, null, 2)}\n`,
    "utf8",
  );
}

export async function waitForMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildActiveManagerCoordinationTask(
  workspaceDir: string,
  taskId: string,
  dependsOn: string[] = [],
): TaskSpec {
  return {
    id: taskId,
    title: "Manager coordination",
    kind: "plan",
    goal: "Coordinate follow-up manager decisions.",
    instructions: [
      "Read manager thread messages and coordinate follow-up work.",
    ],
    inputs: ["Synthetic active manager coordination task for test."],
    dependsOn,
    requiredCapabilities: ["planning", "delegation"],
    preferredAgent: "cli-manager",
    workingDirectory: workspaceDir,
    expectedArtifacts: ["Structured manager coordination output."],
    acceptanceCriteria: ["managerDecision is explicit."],
    validator: { mode: "none" },
    riskLevel: "low",
    allowedActions: [],
    timeoutMs: 300_000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: [],
    },
    status: "ready",
  };
}

export function buildRunningWorkerTask(workspaceDir: string, taskId: string): TaskSpec {
  return {
    id: taskId,
    title: "Synthetic running worker",
    kind: "execute",
    goal: "Simulate in-flight worker execution.",
    instructions: ["Continue execution without being re-queued by message posting."],
    inputs: ["Synthetic running worker task for message-path regression."],
    dependsOn: [],
    requiredCapabilities: ["planning"],
    preferredAgent: "cli-worker",
    assignedAgent: "cli-worker",
    workingDirectory: workspaceDir,
    expectedArtifacts: ["Synthetic worker output."],
    acceptanceCriteria: ["Task remains in running state unless normal execution changes it."],
    validator: { mode: "none" },
    riskLevel: "low",
    allowedActions: [],
    timeoutMs: 300_000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: [],
    },
    status: "running",
  };
}
