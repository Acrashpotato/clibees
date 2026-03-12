import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryRecord } from "../domain/models.js";
import { SCHEMA_VERSION } from "../domain/models.js";
import {
  ensureDirectory,
  pathExists,
  readJsonFile,
  resolvePath,
  writeJsonFile,
} from "../shared/runtime.js";

export interface MemoryQuery {
  text: string;
  scope: string;
  tags?: string[];
}

export interface ProjectMemoryStore {
  recall(query: MemoryQuery): Promise<MemoryRecord[]>;
  persist(records: MemoryRecord[]): Promise<void>;
}

interface MemoryIndex {
  records: string[];
  byScope: Record<string, string[]>;
  byTag: Record<string, string[]>;
}

export class FileProjectMemoryStore implements ProjectMemoryStore {
  private readonly rootDir: string;
  private readonly recordsFile: string;
  private readonly indexFile: string;

  constructor(rootDir = ".multi-agent/memory") {
    this.rootDir = resolvePath(rootDir);
    this.recordsFile = path.join(this.rootDir, "records.jsonl");
    this.indexFile = path.join(this.rootDir, "index.json");
  }

  async recall(query: MemoryQuery): Promise<MemoryRecord[]> {
    const terms = normalizeTerms([query.text, ...(query.tags ?? [])]);
    const records = await this.readRecords();
    const recordsById = new Map(records.map((record) => [record.id, record]));
    const index = await this.readIndex();
    const candidateIds = selectCandidateIds(query, index, records.map((record) => record.id));

    return candidateIds
      .map((recordId) => recordsById.get(recordId))
      .filter((record): record is MemoryRecord => Boolean(record))
      .filter((record) => record.status === "active")
      .filter((record) => record.scope === query.scope)
      .filter((record) =>
        !query.tags || query.tags.every((tag) => record.tags.includes(tag)),
      )
      .map((record) => ({
        record,
        score: scoreMemoryRecord(record, terms),
      }))
      .filter(({ score }) => terms.length === 0 || score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return right.record.validFrom.localeCompare(left.record.validFrom);
      })
      .map(({ record }) => record);
  }

  async persist(records: MemoryRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    await ensureDirectory(this.rootDir);
    const normalizedRecords = records.map((record) => ({
      ...record,
      schemaVersion: record.schemaVersion ?? SCHEMA_VERSION,
    }));

    await appendFile(
      this.recordsFile,
      normalizedRecords.map((record) => JSON.stringify(record)).join("\n") + "\n",
      "utf8",
    );

    const allRecords = await this.readRecords();
    const nextIndex: MemoryIndex = {
      records: allRecords.map((record) => record.id),
      byScope: {},
      byTag: {},
    };

    for (const record of allRecords) {
      pushUnique(nextIndex.byScope, record.scope, record.id);
      for (const tag of record.tags) {
        pushUnique(nextIndex.byTag, tag, record.id);
      }
    }

    await writeJsonFile(this.indexFile, nextIndex);
  }

  private async readRecords(): Promise<MemoryRecord[]> {
    if (!(await pathExists(this.recordsFile))) {
      return [];
    }

    const content = await readFile(this.recordsFile, "utf8");
    const recordsById = new Map<string, MemoryRecord>();

    for (const line of content.split(/\r?\n/)) {
      if (line.trim().length === 0) {
        continue;
      }
      const record = JSON.parse(line) as MemoryRecord;
      recordsById.set(record.id, record);
    }

    return [...recordsById.values()];
  }

  private async readIndex(): Promise<MemoryIndex | null> {
    if (!(await pathExists(this.indexFile))) {
      return null;
    }

    return readJsonFile<MemoryIndex>(this.indexFile);
  }
}

export async function readMemoryIndex(
  rootDir = ".multi-agent/memory",
): Promise<MemoryIndex | null> {
  const indexFile = path.join(resolvePath(rootDir), "index.json");
  if (!(await pathExists(indexFile))) {
    return null;
  }

  return readJsonFile<MemoryIndex>(indexFile);
}

function selectCandidateIds(
  query: MemoryQuery,
  index: MemoryIndex | null,
  fallbackIds: string[],
): string[] {
  if (!index) {
    return fallbackIds;
  }

  let candidateIds = [...(index.byScope[query.scope] ?? [])];

  if (query.tags && query.tags.length > 0) {
    for (const tag of query.tags) {
      const taggedIds = new Set(index.byTag[tag] ?? []);
      candidateIds = candidateIds.filter((recordId) => taggedIds.has(recordId));
    }
  }

  return candidateIds;
}

function normalizeTerms(values: string[]): string[] {
  return values
    .flatMap((value) => value.toLowerCase().split(/[\s,./:_-]+/))
    .filter((term) => term.length > 0);
}

function scoreMemoryRecord(record: MemoryRecord, terms: string[]): number {
  const haystack = [
    record.subject,
    record.content,
    record.kind,
    record.scope,
    ...record.tags,
  ]
    .join(" ")
    .toLowerCase();

  return terms.reduce(
    (score, term) => score + (haystack.includes(term) ? 1 : 0),
    0,
  );
}

function pushUnique(
  target: Record<string, string[]>,
  key: string,
  value: string,
): void {
  const values = target[key] ?? [];
  if (!values.includes(value)) {
    values.push(value);
  }
  target[key] = values;
}
