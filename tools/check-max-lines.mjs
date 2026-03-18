import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MAX_LINES = 500;
const ROOT_DIR = process.cwd();

const TARGETS = [
  {
    dir: path.join(ROOT_DIR, "src"),
    extensions: new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]),
  },
  {
    dir: path.join(ROOT_DIR, "apps", "console", "src"),
    extensions: new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".vue", ".css"]),
  },
];

const IGNORE_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".multi-agent"]);

async function collectFiles(
  directory,
  extensions,
) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...(await collectFiles(absolutePath, extensions)));
      continue;
    }

    if (extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(absolutePath);
    }
  }

  return files;
}

function countLines(text) {
  if (text.length === 0) {
    return 0;
  }

  const rows = text.split(/\r?\n/);
  if (rows.at(-1) === "") {
    rows.pop();
  }
  return rows.length;
}

function toRelativePath(absolutePath) {
  return path.relative(ROOT_DIR, absolutePath).replace(/\\/g, "/");
}

async function main() {
  const offenders = [];

  for (const target of TARGETS) {
    const files = await collectFiles(target.dir, target.extensions);
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const lines = countLines(content);
      if (lines > MAX_LINES) {
        offenders.push({
          file: toRelativePath(file),
          lines,
        });
      }
    }
  }

  if (offenders.length === 0) {
    console.log(`Line-limit check passed (<= ${MAX_LINES} lines per file).`);
    return;
  }

  offenders.sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file));
  console.error(`Line-limit check failed: ${offenders.length} file(s) exceed ${MAX_LINES} lines.`);
  for (const offender of offenders) {
    console.error(`- ${offender.file}: ${offender.lines} lines`);
  }
  process.exitCode = 1;
}

await main();
