import { resolvePath } from "../../shared/runtime.js";
import type { JsonLike } from "./shared-types.js";

export function expectObject(
  value: JsonLike,
  fieldPath: string,
): Record<string, JsonLike> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Config field "${fieldPath}" must be an object.`);
  }

  return value as Record<string, JsonLike>;
}

export function expectOptionalObject(
  value: JsonLike | undefined,
  fieldPath: string,
): Record<string, JsonLike> {
  if (value === undefined) {
    return {};
  }

  return expectObject(value, fieldPath);
}

export function expectArray(value: JsonLike | undefined, fieldPath: string): JsonLike[] {
  if (!Array.isArray(value)) {
    throw new Error(`Config field "${fieldPath}" must be an array.`);
  }

  return value;
}

export function expectString(value: JsonLike | undefined, fieldPath: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Config field "${fieldPath}" must be a non-empty string.`);
  }

  return value;
}

export function optionalString(
  value: JsonLike | undefined,
  fieldPath: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectString(value, fieldPath);
}

export function expectStringArray(
  value: JsonLike | undefined,
  fieldPath: string,
): string[] {
  return expectArray(value, fieldPath).map((item, index) =>
    expectString(item, `${fieldPath}[${index}]`),
  );
}

export function optionalStringArray(
  value: JsonLike | undefined,
  fieldPath: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectStringArray(value, fieldPath);
}

export function expectNumber(value: JsonLike | undefined, fieldPath: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Config field "${fieldPath}" must be a number.`);
  }

  return value;
}

export function optionalNumber(
  value: JsonLike | undefined,
  fieldPath: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectNumber(value, fieldPath);
}

export function optionalBoolean(
  value: JsonLike | undefined,
  fieldPath: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Config field "${fieldPath}" must be a boolean.`);
  }

  return value;
}

export function expectEnum(
  value: JsonLike | undefined,
  fieldPath: string,
  allowedValues: ReadonlySet<string>,
): string {
  const normalized = expectString(value, fieldPath);
  if (!allowedValues.has(normalized)) {
    throw new Error(
      `Config field "${fieldPath}" must be one of: ${Array.from(allowedValues).join(", ")}.`,
    );
  }

  return normalized;
}

export function optionalResolvedPath(
  value: JsonLike | undefined,
  fieldPath: string,
  baseDir: string,
): string | undefined {
  const text = optionalString(value, fieldPath);
  return text ? resolvePath(text, baseDir) : undefined;
}
