import path from "node:path";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createStateLayout, getRunStatePaths } from "../storage/state-layout.js";
import { pathExists, readJsonFile } from "../shared/runtime.js";
import type { RunRecord } from "../domain/models.js";

interface MemoryRecordLike {
  id: string;
  scope?: string;
  tags?: unknown;
  runId?: string;
  sourceRunId?: string;
  source_run_id?: string;
}

interface MemoryIndexShape {
  records: string[];
  byScope: Record<string, string[]>;
  byTag: Record<string, string[]>;
}

export interface MultiAgentRunSummary {
  runId: string;
  updatedAt: string;
  totalBytes: number;
}

export interface MultiAgentMemorySummary {
  recordsCount: number;
  indexCount: number;
  totalBytes: number;
}

export interface MultiAgentSummaryView {
  stateRootDir: string;
  memoryRootDir: string;
  runs: {
    totalCount: number;
    totalBytes: number;
    items: MultiAgentRunSummary[];
  };
  memory: MultiAgentMemorySummary;
}

export interface MultiAgentCleanupResult {
  removedRunIds: string[];
  keptRunIds: string[];
  memory: {
    before: number;
    after: number;
    removed: number;
    cleared: boolean;
    keptForRunId?: string;
  };
}

interface CleanupOptions {
  keepRunId?: string;
  clearMemory?: boolean;
}

function resolveMemoryRootDir(stateRootDir?: string): string {
  const layout = createStateLayout(stateRootDir);
  return path.resolve(layout.rootDir, "..", "memory");
}

async function computeDirectoryBytes(directoryPath: string): Promise<number> {
  if (!(await pathExists(directoryPath))) {
    return 0;
  }

  let totalBytes = 0;
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      totalBytes += await computeDirectoryBytes(entryPath);
      continue;
    }
    if (entry.isFile()) {
      const entryStat = await stat(entryPath);
      totalBytes += entryStat.size;
    }
  }
  return totalBytes;
}

async function listRunSummaries(stateRootDir?: string): Promise<MultiAgentRunSummary[]> {
  const layout = createStateLayout(stateRootDir);
  if (!(await pathExists(layout.runsDir))) {
    return [];
  }

  const runEntries = (await readdir(layout.runsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const runSummaries: MultiAgentRunSummary[] = [];

  for (const runId of runEntries) {
    const runPaths = getRunStatePaths(layout, runId);
    const totalBytes = await computeDirectoryBytes(runPaths.runDir);
    let updatedAt = "";

    if (await pathExists(runPaths.runFile)) {
      try {
        const runRecord = await readJsonFile<RunRecord>(runPaths.runFile);
        updatedAt = runRecord.updatedAt;
      } catch {
        updatedAt = "";
      }
    }

    if (!updatedAt) {
      const runStat = await stat(runPaths.runDir);
      updatedAt = runStat.mtime.toISOString();
    }

    runSummaries.push({
      runId,
      updatedAt,
      totalBytes,
    });
  }

  runSummaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return runSummaries;
}

async function readMemoryRecords(recordsFilePath: string): Promise<MemoryRecordLike[]> {
  if (!(await pathExists(recordsFilePath))) {
    return [];
  }

  const content = await readFile(recordsFilePath, "utf8");
  const recordsById = new Map<string, MemoryRecordLike>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as MemoryRecordLike;
      if (typeof parsed.id !== "string" || parsed.id.length === 0) {
        continue;
      }
      recordsById.set(parsed.id, parsed);
    } catch {
      continue;
    }
  }

  return [...recordsById.values()];
}

function buildMemoryIndex(records: MemoryRecordLike[]): MemoryIndexShape {
  const nextIndex: MemoryIndexShape = {
    records: records.map((record) => record.id),
    byScope: {},
    byTag: {},
  };

  for (const record of records) {
    if (typeof record.scope === "string" && record.scope.length > 0) {
      const scopeEntries = nextIndex.byScope[record.scope] ?? [];
      if (!scopeEntries.includes(record.id)) {
        scopeEntries.push(record.id);
      }
      nextIndex.byScope[record.scope] = scopeEntries;
    }

    const tags = Array.isArray(record.tags) ? record.tags : [];
    for (const tag of tags) {
      if (typeof tag !== "string" || tag.length === 0) {
        continue;
      }
      const tagEntries = nextIndex.byTag[tag] ?? [];
      if (!tagEntries.includes(record.id)) {
        tagEntries.push(record.id);
      }
      nextIndex.byTag[tag] = tagEntries;
    }
  }

  return nextIndex;
}

function keepMemoryRecordForRun(record: MemoryRecordLike, runId: string): boolean {
  return (
    record.sourceRunId === runId ||
    record.runId === runId ||
    record.source_run_id === runId
  );
}

async function summarizeMemory(memoryRootDir: string): Promise<MultiAgentMemorySummary> {
  const recordsFilePath = path.join(memoryRootDir, "records.jsonl");
  const indexFilePath = path.join(memoryRootDir, "index.json");
  const records = await readMemoryRecords(recordsFilePath);
  const totalBytes = await computeDirectoryBytes(memoryRootDir);
  let indexCount = 0;

  if (await pathExists(indexFilePath)) {
    try {
      const index = await readJsonFile<{ records?: unknown }>(indexFilePath);
      if (Array.isArray(index.records)) {
        indexCount = index.records.length;
      }
    } catch {
      indexCount = 0;
    }
  }

  return {
    recordsCount: records.length,
    indexCount,
    totalBytes,
  };
}

export async function getMultiAgentSummary(
  stateRootDir?: string,
): Promise<MultiAgentSummaryView> {
  const layout = createStateLayout(stateRootDir);
  const memoryRootDir = resolveMemoryRootDir(stateRootDir);
  const runSummaries = await listRunSummaries(stateRootDir);
  const memory = await summarizeMemory(memoryRootDir);

  return {
    stateRootDir: layout.rootDir,
    memoryRootDir,
    runs: {
      totalCount: runSummaries.length,
      totalBytes: runSummaries.reduce((total, item) => total + item.totalBytes, 0),
      items: runSummaries,
    },
    memory,
  };
}

export async function cleanupMultiAgentData(
  stateRootDir: string | undefined,
  options: CleanupOptions = {},
): Promise<MultiAgentCleanupResult> {
  const layout = createStateLayout(stateRootDir);
  const memoryRootDir = resolveMemoryRootDir(stateRootDir);
  const keepRunId = options.keepRunId?.trim() || undefined;
  const clearMemory = options.clearMemory === true;
  const removedRunIds: string[] = [];
  const keptRunIds: string[] = [];

  if (await pathExists(layout.runsDir)) {
    const runEntries = await readdir(layout.runsDir, { withFileTypes: true });
    const runIds = runEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    if (keepRunId && !runIds.includes(keepRunId)) {
      throw new Error(`Run "${keepRunId}" was not found under ${layout.runsDir}.`);
    }

    if (keepRunId) {
      for (const entry of runEntries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const runId = entry.name;
        if (runId === keepRunId) {
          keptRunIds.push(runId);
          continue;
        }
        await rm(path.join(layout.runsDir, runId), {
          recursive: true,
          force: false,
          maxRetries: 3,
          retryDelay: 100,
        });
        removedRunIds.push(runId);
      }
    } else {
      keptRunIds.push(...runIds);
    }
  }

  let memoryBefore = 0;
  let memoryAfter = 0;
  if (clearMemory) {
    const recordsFilePath = path.join(memoryRootDir, "records.jsonl");
    const indexFilePath = path.join(memoryRootDir, "index.json");
    await mkdir(memoryRootDir, { recursive: true });
    const records = await readMemoryRecords(recordsFilePath);
    memoryBefore = records.length;
    const nextRecords = keepRunId
      ? records.filter((record) => keepMemoryRecordForRun(record, keepRunId))
      : [];
    const index = buildMemoryIndex(nextRecords);
    const recordsPayload =
      nextRecords.length > 0
        ? nextRecords.map((record) => JSON.stringify(record)).join("\n") + "\n"
        : "";

    await writeFile(recordsFilePath, recordsPayload, "utf8");
    await writeFile(indexFilePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    memoryAfter = nextRecords.length;
  } else {
    memoryAfter = (await summarizeMemory(memoryRootDir)).recordsCount;
    memoryBefore = memoryAfter;
  }

  return {
    removedRunIds,
    keptRunIds,
    memory: {
      before: memoryBefore,
      after: memoryAfter,
      removed: Math.max(0, memoryBefore - memoryAfter),
      cleared: clearMemory,
      ...(keepRunId ? { keptForRunId: keepRunId } : {}),
    },
  };
}
