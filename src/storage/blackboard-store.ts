import { readdir } from "node:fs/promises";
import path from "node:path";
import type { BlackboardEntry } from "../domain/models.js";
import {
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../shared/runtime.js";
import {
  createStateLayout,
  getBlackboardEntryPath,
  getRunStatePaths,
  type StateLayout,
} from "./state-layout.js";

export interface BlackboardFilter {
  taskId?: string;
  scope?: BlackboardEntry["scope"];
}

export interface BlackboardStore {
  upsert(entry: BlackboardEntry): Promise<void>;
  list(runId: string, filter?: BlackboardFilter): Promise<BlackboardEntry[]>;
}

export class FileBlackboardStore implements BlackboardStore {
  private readonly layout: StateLayout;

  constructor(rootDir?: string) {
    this.layout = createStateLayout(rootDir);
  }

  async upsert(entry: BlackboardEntry): Promise<void> {
    await writeJsonFile(
      getBlackboardEntryPath(this.layout, entry.runId, entry.id),
      entry,
    );
  }

  async list(
    runId: string,
    filter: BlackboardFilter = {},
  ): Promise<BlackboardEntry[]> {
    const directory = getRunStatePaths(this.layout, runId).blackboardDir;
    if (!(await pathExists(directory))) {
      return [];
    }

    const fileNames = (await readdir(directory))
      .filter((fileName) => fileName.endsWith(".json"))
      .sort();
    const entries = await Promise.all(
      fileNames.map((fileName) =>
        readJsonFile<BlackboardEntry>(path.join(directory, fileName)),
      ),
    );

    return entries
      .filter((entry) => !filter.taskId || entry.taskId === filter.taskId)
      .filter((entry) => !filter.scope || entry.scope === filter.scope)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}
