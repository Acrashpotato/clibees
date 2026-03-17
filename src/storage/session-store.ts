import { appendFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  MessageThreadRecord,
  SessionMessageRecord,
  TaskSessionRecord,
} from "../domain/models.js";
import { SCHEMA_VERSION } from "../domain/models.js";
import {
  createId,
  ensureDirectory,
  isoNow,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../shared/runtime.js";
import {
  createStateLayout,
  getMessageThreadPath,
  getRunStatePaths,
  getTaskSessionPath,
  getThreadMessagesPath,
  type StateLayout,
} from "./state-layout.js";

export interface AppendSessionMessageInput {
  runId: string;
  threadId: string;
  role: SessionMessageRecord["role"];
  body: string;
  actorId: string;
  sessionId?: string;
  replyToMessageId?: string;
  clientRequestId?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionStore {
  upsertSession(record: TaskSessionRecord): Promise<TaskSessionRecord>;
  getSession(runId: string, sessionId: string): Promise<TaskSessionRecord | null>;
  listSessions(runId: string): Promise<TaskSessionRecord[]>;
  upsertThread(record: MessageThreadRecord): Promise<MessageThreadRecord>;
  getThread(runId: string, threadId: string): Promise<MessageThreadRecord | null>;
  listThreads(runId: string): Promise<MessageThreadRecord[]>;
  appendMessage(input: AppendSessionMessageInput): Promise<SessionMessageRecord>;
  listMessages(runId: string, threadId: string): Promise<SessionMessageRecord[]>;
  listRunMessages(runId: string): Promise<SessionMessageRecord[]>;
}

export class FileSessionStore implements SessionStore {
  private readonly layout: StateLayout;

  constructor(rootDir?: string) {
    this.layout = createStateLayout(rootDir);
  }

  async upsertSession(record: TaskSessionRecord): Promise<TaskSessionRecord> {
    const filePath = getTaskSessionPath(this.layout, record.runId, record.sessionId);
    if (await pathExists(filePath)) {
      return this.readRecord<TaskSessionRecord>(filePath, "taskSession");
    }

    await ensureDirectory(getRunStatePaths(this.layout, record.runId).sessionsDir);
    await writeJsonFile(filePath, record);
    return record;
  }

  async getSession(runId: string, sessionId: string): Promise<TaskSessionRecord | null> {
    const filePath = getTaskSessionPath(this.layout, runId, sessionId);
    if (!(await pathExists(filePath))) {
      return null;
    }
    return this.readRecord<TaskSessionRecord>(filePath, "taskSession");
  }

  async listSessions(runId: string): Promise<TaskSessionRecord[]> {
    const directory = getRunStatePaths(this.layout, runId).sessionsDir;
    return this.readJsonDirectory<TaskSessionRecord>(directory, "taskSession");
  }

  async upsertThread(record: MessageThreadRecord): Promise<MessageThreadRecord> {
    const filePath = getMessageThreadPath(this.layout, record.runId, record.threadId);
    if (await pathExists(filePath)) {
      return this.readRecord<MessageThreadRecord>(filePath, "messageThread");
    }

    await ensureDirectory(getRunStatePaths(this.layout, record.runId).threadsDir);
    await writeJsonFile(filePath, record);
    return record;
  }

  async getThread(runId: string, threadId: string): Promise<MessageThreadRecord | null> {
    const filePath = getMessageThreadPath(this.layout, runId, threadId);
    if (!(await pathExists(filePath))) {
      return null;
    }
    return this.readRecord<MessageThreadRecord>(filePath, "messageThread");
  }

  async listThreads(runId: string): Promise<MessageThreadRecord[]> {
    const directory = getRunStatePaths(this.layout, runId).threadsDir;
    return this.readJsonDirectory<MessageThreadRecord>(directory, "messageThread");
  }

  async appendMessage(input: AppendSessionMessageInput): Promise<SessionMessageRecord> {
    const messagesPath = getThreadMessagesPath(this.layout, input.runId, input.threadId);
    const runPaths = getRunStatePaths(this.layout, input.runId);
    await ensureDirectory(runPaths.threadMessagesDir);

    if (input.clientRequestId) {
      const existing = (await this.listMessages(input.runId, input.threadId)).find(
        (message) => message.clientRequestId === input.clientRequestId,
      );
      if (existing) {
        return existing;
      }
    }

    const now = isoNow();
    const message: SessionMessageRecord = {
      schemaVersion: SCHEMA_VERSION,
      messageId: createId("message"),
      runId: input.runId,
      threadId: input.threadId,
      role: input.role,
      body: input.body,
      actorId: input.actorId,
      createdAt: now,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
      ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      metadata: input.metadata ?? {},
    };
    await appendFile(messagesPath, `${JSON.stringify(message)}\n`, "utf8");

    const thread = await this.getThread(input.runId, input.threadId);
    if (thread) {
      await writeJsonFile(
        getMessageThreadPath(this.layout, input.runId, input.threadId),
        {
          ...thread,
          updatedAt: now,
        } satisfies MessageThreadRecord,
      );
    }

    if (input.sessionId) {
      const session = await this.getSession(input.runId, input.sessionId);
      if (session) {
        await writeJsonFile(
          getTaskSessionPath(this.layout, input.runId, input.sessionId),
          {
            ...session,
            updatedAt: now,
          } satisfies TaskSessionRecord,
        );
      }
    }

    return message;
  }

  async listMessages(runId: string, threadId: string): Promise<SessionMessageRecord[]> {
    const messagesPath = getThreadMessagesPath(this.layout, runId, threadId);
    return this.readMessagesFile(messagesPath, runId, threadId);
  }

  async listRunMessages(runId: string): Promise<SessionMessageRecord[]> {
    const runPaths = getRunStatePaths(this.layout, runId);
    if (!(await pathExists(runPaths.threadMessagesDir))) {
      return [];
    }

    const files = (await readdir(runPaths.threadMessagesDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name)
      .sort();
    const messages: SessionMessageRecord[] = [];
    for (const fileName of files) {
      const decodedThreadId = decodeURIComponent(fileName.replace(/\.jsonl$/i, ""));
      const filePath = getThreadMessagesPath(this.layout, runId, decodedThreadId);
      messages.push(...(await this.readMessagesFile(filePath, runId, decodedThreadId)));
    }

    return messages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async readJsonDirectory<T>(directory: string, entityName: string): Promise<T[]> {
    if (!(await pathExists(directory))) {
      return [];
    }
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    const records: T[] = [];
    for (const entry of entries) {
      const filePath = path.join(directory, entry);
      records.push(await this.readRecord<T>(filePath, entityName));
    }
    return records;
  }

  private async readRecord<T>(filePath: string, entityName: string): Promise<T> {
    try {
      return await readJsonFile<T>(filePath);
    } catch (error) {
      throw new Error(`Failed to read ${entityName} record "${filePath}".`, {
        cause: error,
      });
    }
  }

  private async readMessagesFile(
    filePath: string,
    runId: string,
    threadId: string,
  ): Promise<SessionMessageRecord[]> {
    if (!(await pathExists(filePath))) {
      return [];
    }

    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      throw new Error(`Failed to read messages for run "${runId}" thread "${threadId}".`, {
        cause: error,
      });
    }

    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const messages: SessionMessageRecord[] = [];
    for (const [index, line] of lines.entries()) {
      try {
        messages.push(JSON.parse(line) as SessionMessageRecord);
      } catch (error) {
        throw new Error(
          `Failed to parse messages for run "${runId}" thread "${threadId}" at line ${index + 1}.`,
          { cause: error },
        );
      }
    }

    return messages;
  }
}
