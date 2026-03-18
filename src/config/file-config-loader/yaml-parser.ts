import type { JsonLike, SourceLine } from "./shared-types.js";
import { expectObject } from "./value-readers.js";

export function parseYamlSubset(text: string, sourcePath: string): JsonLike {
  const lines = tokenizeYaml(text, sourcePath);
  if (lines.length === 0) {
    return {};
  }

  const parsed = parseYamlBlock(lines, 0, lines[0].indent, sourcePath);
  if (parsed.nextIndex !== lines.length) {
    throw new Error(
      `Unexpected trailing content in "${sourcePath}" at line ${lines[parsed.nextIndex].lineNumber}.`,
    );
  }

  return parsed.value;
}

export function tokenizeYaml(text: string, sourcePath: string): SourceLine[] {
  const result: SourceLine[] = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const sanitized = stripInlineComment(rawLine);
    if (!sanitized.trim()) {
      continue;
    }

    if (sanitized.includes("\t")) {
      throw new Error(
        `Tabs are not supported in "${sourcePath}" at line ${lineNumber}. Use spaces for indentation.`,
      );
    }

    const indent = sanitized.match(/^ */)?.[0].length ?? 0;
    result.push({
      indent,
      lineNumber,
      text: sanitized.trim(),
    });
  }

  return result;
}

export function stripInlineComment(line: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === "\"" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === "#" && !inSingleQuote && !inDoubleQuote) {
      return line.slice(0, index).trimEnd();
    }
  }

  return line;
}

export function parseYamlBlock(
  lines: SourceLine[],
  startIndex: number,
  indent: number,
  sourcePath: string,
): { value: JsonLike; nextIndex: number } {
  const line = lines[startIndex];
  if (line.indent !== indent) {
    throw new Error(
      `Unexpected indentation in "${sourcePath}" at line ${line.lineNumber}.`,
    );
  }

  return line.text.startsWith("- ")
    ? parseYamlArray(lines, startIndex, indent, sourcePath)
    : parseYamlObject(lines, startIndex, indent, sourcePath);
}

export function parseYamlObject(
  lines: SourceLine[],
  startIndex: number,
  indent: number,
  sourcePath: string,
): { value: Record<string, JsonLike>; nextIndex: number } {
  const result: Record<string, JsonLike> = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      throw new Error(
        `Unexpected indentation in "${sourcePath}" at line ${line.lineNumber}.`,
      );
    }

    if (line.text.startsWith("- ")) {
      throw new Error(
        `Array item cannot appear directly inside an object in "${sourcePath}" at line ${line.lineNumber}.`,
      );
    }

    const separatorIndex = findKeySeparator(line.text);
    if (separatorIndex === -1) {
      throw new Error(
        `Expected "key: value" in "${sourcePath}" at line ${line.lineNumber}.`,
      );
    }

    const key = line.text.slice(0, separatorIndex).trim();
    const valueText = line.text.slice(separatorIndex + 1).trim();
    if (!key) {
      throw new Error(`Missing key in "${sourcePath}" at line ${line.lineNumber}.`);
    }

    index += 1;
    if (!valueText) {
      if (index >= lines.length || lines[index].indent <= indent) {
        result[key] = {};
        continue;
      }

      const nested = parseYamlBlock(lines, index, lines[index].indent, sourcePath);
      result[key] = nested.value;
      index = nested.nextIndex;
      continue;
    }

    result[key] = parseScalar(valueText, sourcePath, line.lineNumber);
  }

  return { value: result, nextIndex: index };
}

export function parseYamlArray(
  lines: SourceLine[],
  startIndex: number,
  indent: number,
  sourcePath: string,
): { value: JsonLike[]; nextIndex: number } {
  const result: JsonLike[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }

    if (line.indent !== indent || !line.text.startsWith("- ")) {
      break;
    }

    const valueText = line.text.slice(2).trim();
    index += 1;

    if (!valueText) {
      if (index >= lines.length || lines[index].indent <= indent) {
        result.push(null);
        continue;
      }

      const nested = parseYamlBlock(lines, index, lines[index].indent, sourcePath);
      result.push(nested.value);
      index = nested.nextIndex;
      continue;
    }

    const separatorIndex = findKeySeparator(valueText);
    if (separatorIndex !== -1) {
      const key = valueText.slice(0, separatorIndex).trim();
      const inlineValue = valueText.slice(separatorIndex + 1).trim();
      const item: Record<string, JsonLike> = {};
      item[key] = inlineValue
        ? parseScalar(inlineValue, sourcePath, line.lineNumber)
        : {};

      if (index < lines.length && lines[index].indent > indent) {
        const nested = parseYamlObject(
          lines,
          index,
          lines[index].indent,
          sourcePath,
        );
        Object.assign(item, nested.value);
        index = nested.nextIndex;
      }

      result.push(item);
      continue;
    }

    result.push(parseScalar(valueText, sourcePath, line.lineNumber));
  }

  return { value: result, nextIndex: index };
}

export function findKeySeparator(text: string): number {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === "\"" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ":" && !inSingleQuote && !inDoubleQuote) {
      return index;
    }
  }

  return -1;
}

export function parseScalar(
  valueText: string,
  sourcePath: string,
  lineNumber: number,
): JsonLike {
  if (valueText === "true") {
    return true;
  }

  if (valueText === "false") {
    return false;
  }

  if (valueText === "null") {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(valueText)) {
    return Number(valueText);
  }

  if (
    (valueText.startsWith("\"") && valueText.endsWith("\"")) ||
    (valueText.startsWith("'") && valueText.endsWith("'"))
  ) {
    return valueText.slice(1, -1);
  }

  if (
    (valueText.startsWith("[") && valueText.endsWith("]")) ||
    (valueText.startsWith("{") && valueText.endsWith("}"))
  ) {
    try {
      return JSON.parse(valueText) as JsonLike;
    } catch {
      throw new Error(
        `Invalid inline JSON value in "${sourcePath}" at line ${lineNumber}.`,
      );
    }
  }

  return valueText;
}
