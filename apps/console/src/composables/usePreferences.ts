import { ref } from "vue";

import { getRiskLabel, getStatusLabel, getValidationLabel, translate, type Locale } from "../i18n";
import type { ExecutionStatus, RiskLevel, ValidationSummary } from "../view-models";

const LOCALE_KEY = "clibees.console.locale";
const FIXED_LOCALE: Locale = "zh-CN";

const locale = ref<Locale>(FIXED_LOCALE);

let initialized = false;

function applyLocale(nextLocale: Locale) {
  document.documentElement.lang = nextLocale;
}

function init() {
  if (initialized || typeof window === "undefined") {
    initialized = true;
    return;
  }

  locale.value = FIXED_LOCALE;
  window.localStorage.setItem(LOCALE_KEY, FIXED_LOCALE);
  applyLocale(FIXED_LOCALE);
  document.documentElement.dataset.theme = "light";

  initialized = true;
}

export function usePreferences() {
  init();

  return {
    locale,
    t: (key: string) => translate(FIXED_LOCALE, key),
    statusLabel: (status: ExecutionStatus | "failed") => getStatusLabel(FIXED_LOCALE, status),
    riskLabel: (risk: RiskLevel) => getRiskLabel(FIXED_LOCALE, risk),
    validationLabel: (state: ValidationSummary["state"]) => getValidationLabel(FIXED_LOCALE, state),
  };
}
