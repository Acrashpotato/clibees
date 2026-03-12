import path from "node:path";
import { resolvePath } from "../shared/runtime.js";

export interface StateLayout {
  rootDir: string;
  runsDir: string;
}

export interface RunStatePaths {
  runDir: string;
  runFile: string;
  graphFile: string;
  eventsFile: string;
  approvalsFile: string;
  blackboardDir: string;
  artifactsDir: string;
  workspaceDir: string;
  tasksDir: string;
}

export function createStateLayout(rootDir?: string): StateLayout {
  const resolvedRootDir = resolvePath(rootDir ?? ".multi-agent/state");
  return {
    rootDir: resolvedRootDir,
    runsDir: path.join(resolvedRootDir, "runs"),
  };
}

export function getRunStatePaths(
  layout: StateLayout,
  runId: string,
): RunStatePaths {
  const runDir = path.join(layout.runsDir, runId);

  return {
    runDir,
    runFile: path.join(runDir, "run.json"),
    graphFile: path.join(runDir, "graph.json"),
    eventsFile: path.join(runDir, "events.jsonl"),
    approvalsFile: path.join(runDir, "approvals.json"),
    blackboardDir: path.join(runDir, "blackboard"),
    artifactsDir: path.join(runDir, "artifacts"),
    workspaceDir: path.join(runDir, "workspace"),
    tasksDir: path.join(runDir, "tasks"),
  };
}

export function getTaskRecordPath(
  layout: StateLayout,
  runId: string,
  taskId: string,
): string {
  return path.join(
    getRunStatePaths(layout, runId).tasksDir,
    `${encodeURIComponent(taskId)}.json`,
  );
}

export function getTaskTranscriptPath(
  layout: StateLayout,
  runId: string,
  taskId: string,
): string {
  return path.join(
    getRunStatePaths(layout, runId).tasksDir,
    `${encodeURIComponent(taskId)}.transcript.jsonl`,
  );
}

export function getBlackboardEntryPath(
  layout: StateLayout,
  runId: string,
  entryId: string,
): string {
  return path.join(
    getRunStatePaths(layout, runId).blackboardDir,
    `${encodeURIComponent(entryId)}.json`,
  );
}

export function getArtifactRecordPath(
  layout: StateLayout,
  runId: string,
  artifactId: string,
): string {
  return path.join(
    getRunStatePaths(layout, runId).artifactsDir,
    `${encodeURIComponent(artifactId)}.json`,
  );
}

export function getWorkspaceSnapshotPath(
  layout: StateLayout,
  runId: string,
  snapshotId: string,
): string {
  return path.join(
    getRunStatePaths(layout, runId).workspaceDir,
    `${encodeURIComponent(snapshotId)}.json`,
  );
}
