import { computed, ref, watch } from "vue";

import { getRiskLabel, getStatusLabel, getValidationLabel, translate, type Locale } from "../i18n";
import type { LaneStatus, RiskLevel, ValidationSummary } from "../types";

type Theme = "dark" | "light";

const LOCALE_KEY = "clibees.console.locale";
const THEME_KEY = "clibees.console.theme";

const locale = ref<Locale>("zh-CN");
const theme = ref<Theme>("dark");

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

  const savedLocale = window.localStorage.getItem(LOCALE_KEY);
  const savedTheme = window.localStorage.getItem(THEME_KEY);

  if (savedLocale === "zh-CN" || savedLocale === "en") {
    locale.value = savedLocale;
  }

  if (savedTheme === "dark" || savedTheme === "light") {
    theme.value = savedTheme;
  }

  applyLocale(locale.value);
  applyTheme(theme.value);

  watch(locale, (value) => {
    window.localStorage.setItem(LOCALE_KEY, value);
    applyLocale(value);
  });

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
    isZh: computed(() => locale.value === "zh-CN"),
    isDark: computed(() => theme.value === "dark"),
    setLocale: (nextLocale: Locale) => {
      locale.value = nextLocale;
    },
    toggleLocale: () => {
      locale.value = locale.value === "zh-CN" ? "en" : "zh-CN";
    },
    toggleTheme: () => {
      theme.value = theme.value === "dark" ? "light" : "dark";
    },
    t: (key: string) => translate(locale.value, key),
    statusLabel: (status: LaneStatus | "failed") => getStatusLabel(locale.value, status),
    riskLabel: (risk: RiskLevel) => getRiskLabel(locale.value, risk),
    validationLabel: (state: ValidationSummary["state"]) => getValidationLabel(locale.value, state)
  };
}