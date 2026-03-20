import { computed, ref, watch } from "vue";

import { getRiskLabel, getStatusLabel, getValidationLabel, translate, type Locale } from "../i18n";
import type { ExecutionStatus, RiskLevel, ValidationSummary } from "../view-models";

type Theme = "dark" | "light";

const LOCALE_KEY = "clibees.console.locale";
const THEME_KEY = "clibees.console.theme";
const FIXED_LOCALE: Locale = "zh-CN";

const locale = ref<Locale>(FIXED_LOCALE);
const theme = ref<Theme>("light");

let initialized = false;

function applyTheme(nextTheme: Theme) {
  document.documentElement.dataset.theme = nextTheme;
}

function applyLocale(nextLocale: Locale) {
  document.documentElement.lang = nextLocale;
}

function init() {
  if (initialized || typeof window === "undefined") {
    initialized = true;
    return;
  }

  const savedTheme = window.localStorage.getItem(THEME_KEY);

  if (savedTheme === "dark" || savedTheme === "light") {
    theme.value = savedTheme;
  }

  locale.value = FIXED_LOCALE;
  window.localStorage.setItem(LOCALE_KEY, FIXED_LOCALE);
  applyLocale(FIXED_LOCALE);
  applyTheme(theme.value);

  watch(theme, (value) => {
    window.localStorage.setItem(THEME_KEY, value);
    applyTheme(value);
  });

  initialized = true;
}

export function usePreferences() {
  init();

  return {
    locale,
    theme,
    isDark: computed(() => theme.value === "dark"),
    toggleTheme: () => {
      theme.value = theme.value === "dark" ? "light" : "dark";
    },
    t: (key: string) => translate(FIXED_LOCALE, key),
    statusLabel: (status: ExecutionStatus | "failed") => getStatusLabel(FIXED_LOCALE, status),
    riskLabel: (risk: RiskLevel) => getRiskLabel(FIXED_LOCALE, risk),
    validationLabel: (state: ValidationSummary["state"]) => getValidationLabel(FIXED_LOCALE, state),
  };
}
