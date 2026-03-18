import type { ExecutionStatus, RiskLevel, ValidationSummary } from "./view-models";
import { enMessages } from "./i18n/messages-en";
import { zhMessages } from "./i18n/messages-zh-cn";

export type Locale = "zh-CN" | "en";

const messages = {
  "zh-CN": zhMessages,
  en: enMessages,
} as const;

export function translate(locale: Locale, key: string): string {
  const parts = key.split(".");
  let node: unknown = messages[locale];

  for (const part of parts) {
    if (typeof node !== "object" || node === null || !(part in node)) {
      return key;
    }
    node = (node as Record<string, unknown>)[part];
  }

  return typeof node === "string" ? node : key;
}

export function getStatusLabel(locale: Locale, status: ExecutionStatus | "failed"): string {
  return translate(locale, `status.${status}`);
}

export function getRiskLabel(locale: Locale, risk: RiskLevel): string {
  return translate(locale, `risk.${risk}`);
}

export function getValidationLabel(locale: Locale, state: ValidationSummary["state"]): string {
  return translate(locale, `validation.${state}`);
}
