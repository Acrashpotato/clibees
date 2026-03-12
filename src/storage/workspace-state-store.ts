import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  WorkspaceDrift,
  WorkspaceSnapshot,
} from "../domain/models.js";
import {
  createId,
  isoNow,
  pathExists,
  readJsonFile,
  resolvePath,
  writeJsonFile,
} from "../shared/runtime.js";
import {
  createStateLayout,
  getRunStatePaths,
  getWorkspaceSnapshotPath,
  type StateLayout,
} from "./state-layout.js";

export interface WorkspaceStateStore {
  capture(
    runId: string,
    taskId?: string,
    workingDirectory?: string,
  ): Promise<WorkspaceSnapshot>;
  captureBeforeTask(
    runId: string,
    taskId: string,
    workingDirectory: string,
  ): Promise<WorkspaceSnapshot>;
  captureAfterTask(
    runId: string,
    taskId: string,
    workingDirectory: string,
  ): Promise<WorkspaceSnapshot>;
  getLatestSnapshot(
    runId: string,
    options?: { phases?: WorkspaceSnapshot["phase"][] },
  ): Promise<WorkspaceSnapshot | null>;
  detectDrift(runId: string): Promise<WorkspaceDrift>;
}

export interface FileWorkspaceStateStoreOptions {
  stateRootDir?: string;
  workspaceRootDir?: string;
  ignoredDirectories?: string[];
  maxTrackedFiles?: number;
}

type WorkspaceFileState = { size: number; mtimeMs: number };
type WorkspaceManifest = Record<string, WorkspaceFileState>;

const execFileAsync = promisify(execFile);

export class FileWorkspaceStateStore implements WorkspaceStateStore {
  private readonly layout: StateLayout;
  private readonly workspaceRootDir: string;
  private readonly ignoredDirectories: Set<string>;
  private readonly maxTrackedFiles: number;

  constructor(options: FileWorkspaceStateStoreOptions = {}) {
    this.layout = createStateLayout(options.stateRootDir);
    this.workspaceRootDir = resolvePath(
      options.workspaceRootDir ?? process.cwd(),
    );
    this.ignoredDirectories = new Set(
      options.ignoredDirectories ?? ["node_modules", ".git", "dist", ".multi-agent"],
    );
    this.maxTrackedFiles = options.maxTrackedFiles ?? 200;
  }

  async capture(
    runId: string,
    taskId?: string,
    workingDirectory?: string,
  ): Promise<WorkspaceSnapshot> {
    return this.captureSnapshot({
      runId,
      taskId,
      phase: "context",
      workingDirectory: workingDirectory ?? this.workspaceRootDir,
    });
  }

  async captureBeforeTask(
    runId: string,
    taskId: string,
    workingDirectory: string,
  ): Promise<WorkspaceSnapshot> {
    return this.captureSnapshot({
      runId,
      taskId,
      phase: "before_task",
      workingDirectory,
    });
  }

  async captureAfterTask(
    runId: string,
    taskId: string,
    workingDirectory: string,
  ): Promise<WorkspaceSnapshot> {
    const baseSnapshot = await this.getLatestSnapshot(runId, {
      phases: ["before_task"],
    });

    return this.captureSnapshot({
      runId,
      taskId,
      phase: "after_task",
      workingDirectory,
      baseSnapshot:
        baseSnapshot && baseSnapshot.taskId === taskId ? baseSnapshot : undefined,
    });
  }

  async getLatestSnapshot(
    runId: string,
    options: { phases?: WorkspaceSnapshot["phase"][] } = {},
  ): Promise<WorkspaceSnapshot | null> {
    const directory = getRunStatePaths(this.layout, runId).workspaceDir;
    if (!(await pathExists(directory))) {
      return null;
    }

    const fileNames = (await readdir(directory))
      .filter((fileName) => fileName.endsWith(".json"))
      .sort();
    if (fileNames.length === 0) {
      return null;
    }

    const snapshots = await Promise.all(
      fileNames.map((fileName) =>
        readJsonFile<WorkspaceSnapshot>(path.join(directory, fileName)),
      ),
    );

    return snapshots
      .filter(
        (snapshot) =>
          !options.phases || options.phases.includes(snapshot.phase),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  }

  async detectDrift(runId: string): Promise<WorkspaceDrift> {
    const baseline =
      (await this.getLatestSnapshot(runId, { phases: ["after_task"] })) ??
      (await this.getLatestSnapshot(runId, { phases: ["before_task"] }));

    if (!baseline) {
      return {
        hasDrift: false,
        severity: "none",
        changedFiles: [],
        unexpectedChanges: [],
        missingArtifacts: [],
        branchChanged: false,
        headChanged: false,
        reasons: [],
        reason: "No workspace snapshot exists for this run yet.",
      };
    }

    const currentState = await collectWorkspaceState(
      this.workspaceRootDir,
      this.ignoredDirectories,
      this.maxTrackedFiles,
    );
    const diffSummary = diffTrackedFileStates(
      baseline.trackedFileStates,
      currentState.trackedFileStates,
    );
    const changedFiles = [
      ...diffSummary.added,
      ...diffSummary.modified,
      ...diffSummary.deleted,
    ];
    const branchChanged = Boolean(
      normalizeOptional(baseline.branch) !== normalizeOptional(currentState.branch),
    );
    const headChanged = Boolean(
      normalizeOptional(baseline.head) !== normalizeOptional(currentState.head),
    );
    const missingArtifacts = [...diffSummary.deleted];
    const unexpectedChanges = [...changedFiles];
    const reasons: string[] = [];

    if (branchChanged) {
      reasons.push(
        `Workspace branch changed from ${baseline.branch ?? "(unknown)"} to ${
          currentState.branch ?? "(unknown)"
        }.`,
      );
    }
    if (headChanged) {
      reasons.push(
        `Workspace HEAD changed from ${baseline.head ?? "(unknown)"} to ${
          currentState.head ?? "(unknown)"
        }.`,
      );
    }
    if (unexpectedChanges.length > 0) {
      reasons.push(
        `Workspace files changed since the last recorded snapshot: ${unexpectedChanges.join(", ")}.`,
      );
    }

    const hasDrift = reasons.length > 0;

    return {
      hasDrift,
      severity: hasDrift ? "blocking" : "none",
      changedFiles,
      unexpectedChanges,
      missingArtifacts,
      branchChanged,
      headChanged,
      reasons,
      ...(reasons.length > 0 ? { reason: reasons[0] } : {}),
    };
  }

  private async captureSnapshot(options: {
    runId: string;
    taskId?: string;
    phase: WorkspaceSnapshot["phase"];
    workingDirectory: string;
    baseSnapshot?: WorkspaceSnapshot;
  }): Promise<WorkspaceSnapshot> {
    const workspaceState = await collectWorkspaceState(
      this.workspaceRootDir,
      this.ignoredDirectories,
      this.maxTrackedFiles,
    );
    const diffSummary = diffTrackedFileStates(
      options.baseSnapshot?.trackedFileStates ?? {},
      workspaceState.trackedFileStates,
    );
    const snapshot: WorkspaceSnapshot = {
      id: createId("workspace"),
      runId: options.runId,
      ...(options.taskId ? { taskId: options.taskId } : {}),
      phase: options.phase,
      ...(options.baseSnapshot ? { baseSnapshotId: options.baseSnapshot.id } : {}),
      workingDirectory: resolvePath(options.workingDirectory, this.workspaceRootDir),
      ...(workspaceState.branch ? { branch: workspaceState.branch } : {}),
      ...(workspaceState.head ? { head: workspaceState.head } : {}),
      trackedFiles: workspaceState.trackedFiles,
      trackedFileStates: workspaceState.trackedFileStates,
      diffSummary,
      createdAt: isoNow(),
    };

    await writeJsonFile(
      getWorkspaceSnapshotPath(this.layout, options.runId, snapshot.id),
      snapshot,
    );

    return snapshot;
  }
}

async function collectWorkspaceState(
  rootDir: string,
  ignoredDirectories: Set<string>,
  maxTrackedFiles: number,
): Promise<{
  branch?: string;
  head?: string;
  trackedFiles: string[];
  trackedFileStates: WorkspaceManifest;
}> {
  const trackedFiles: string[] = [];
  const trackedFileStates: WorkspaceManifest = {};

  const visit = async (directoryPath: string): Promise<void> => {
    if (trackedFiles.length >= maxTrackedFiles) {
      return;
    }

    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (trackedFiles.length >= maxTrackedFiles) {
        return;
      }

      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = path.relative(rootDir, absolutePath);

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }

        await visit(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        const normalizedPath = relativePath.split(path.sep).join("/");
        const fileStat = await stat(absolutePath);
        trackedFiles.push(normalizedPath);
        trackedFileStates[normalizedPath] = {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
        };
      }
    }
  };

  if (await pathExists(rootDir)) {
    await visit(rootDir);
  }

  const gitState = await readGitState(rootDir);

  return {
    trackedFiles,
    trackedFileStates,
    ...(gitState.branch ? { branch: gitState.branch } : {}),
    ...(gitState.head ? { head: gitState.head } : {}),
  };
}

async function readGitState(rootDir: string): Promise<{ branch?: string; head?: string }> {
  try {
    const insideWorkTree = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: rootDir,
      windowsHide: true,
    });
    if (insideWorkTree.stdout.trim() !== "true") {
      return {};
    }

    const [branchResult, headResult] = await Promise.allSettled([
      execFileAsync("git", ["branch", "--show-current"], {
        cwd: rootDir,
        windowsHide: true,
      }),
      execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: rootDir,
        windowsHide: true,
      }),
    ]);

    return {
      ...(branchResult.status === "fulfilled" && branchResult.value.stdout.trim().length > 0
        ? { branch: branchResult.value.stdout.trim() }
        : {}),
      ...(headResult.status === "fulfilled" && headResult.value.stdout.trim().length > 0
        ? { head: headResult.value.stdout.trim() }
        : {}),
    };
  } catch {
    return {};
  }
}

function diffTrackedFileStates(
  before: WorkspaceManifest,
  after: WorkspaceManifest,
): WorkspaceSnapshot["diffSummary"] {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const filePaths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

  for (const filePath of filePaths) {
    const previous = before[filePath];
    const current = after[filePath];
    if (!previous && current) {
      added.push(filePath);
      continue;
    }
    if (previous && !current) {
      deleted.push(filePath);
      continue;
    }
    if (
      previous &&
      current &&
      (previous.size !== current.size || previous.mtimeMs !== current.mtimeMs)
    ) {
      modified.push(filePath);
    }
  }

  return { added, modified, deleted };
}

function normalizeOptional(value: string | undefined): string {
  return value ?? "";
}
