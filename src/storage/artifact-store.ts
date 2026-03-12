import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ArtifactKind, ArtifactRecord } from "../domain/models.js";
import {
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../shared/runtime.js";
import {
  createStateLayout,
  getArtifactRecordPath,
  getRunStatePaths,
  type StateLayout,
} from "./state-layout.js";

export interface ArtifactFilter {
  taskId?: string;
  kind?: ArtifactKind;
}

export interface ArtifactStore {
  record(artifact: ArtifactRecord): Promise<void>;
  list(runId: string, filter?: ArtifactFilter): Promise<ArtifactRecord[]>;
}

export class FileArtifactStore implements ArtifactStore {
  private readonly layout: StateLayout;

  constructor(rootDir?: string) {
    this.layout = createStateLayout(rootDir);
  }

  async record(artifact: ArtifactRecord): Promise<void> {
    await writeJsonFile(
      getArtifactRecordPath(this.layout, artifact.runId, artifact.id),
      artifact,
    );
  }

  async list(
    runId: string,
    filter: ArtifactFilter = {},
  ): Promise<ArtifactRecord[]> {
    const directory = getRunStatePaths(this.layout, runId).artifactsDir;
    if (!(await pathExists(directory))) {
      return [];
    }

    const fileNames = (await readdir(directory))
      .filter((fileName) => fileName.endsWith(".json"))
      .sort();
    const artifacts = await Promise.all(
      fileNames.map((fileName) =>
        readJsonFile<ArtifactRecord>(path.join(directory, fileName)),
      ),
    );

    return artifacts
      .filter((artifact) => !filter.taskId || artifact.taskId === filter.taskId)
      .filter((artifact) => !filter.kind || artifact.kind === filter.kind)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}
