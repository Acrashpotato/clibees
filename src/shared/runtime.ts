import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const BEIJING_UTC_OFFSET_MINUTES = 8 * 60;

function padNumber(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatTimestampForBeijing(now: Date): string {
  const beijingTime = new Date(now.getTime() + BEIJING_UTC_OFFSET_MINUTES * 60_000);
  const year = beijingTime.getUTCFullYear();
  const month = padNumber(beijingTime.getUTCMonth() + 1, 2);
  const day = padNumber(beijingTime.getUTCDate(), 2);
  const hour = padNumber(beijingTime.getUTCHours(), 2);
  const minute = padNumber(beijingTime.getUTCMinutes(), 2);
  const second = padNumber(beijingTime.getUTCSeconds(), 2);
  const millisecond = padNumber(beijingTime.getUTCMilliseconds(), 3);
  return `${year}-${month}-${day}T${hour}-${minute}-${second}-${millisecond}`;
}

export function createId(prefix: string, now: Date = new Date()): string {
  const suffix =
    prefix === "task"
      ? formatTimestampForBeijing(now)
      : now.toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${suffix}-${randomUUID().slice(0, 8)}`;
}

export function isoNow(now: Date = new Date()): string {
  return now.toISOString();
}

export function resolvePath(targetPath: string, baseDir: string = process.cwd()): string {
  if (path.isAbsolute(targetPath)) {
    return path.normalize(targetPath);
  }

  return path.resolve(baseDir, targetPath);
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

export async function writeJsonFile(
  filePath: string,
  value: unknown,
): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
