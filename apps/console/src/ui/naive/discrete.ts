import {
  createDiscreteApi,
  darkTheme,
  type ConfigProviderProps,
} from "naive-ui";

import { buildNaiveThemeOverrides, type ThemeMode } from "./theme";

let activeThemeMode: ThemeMode = "light";
let activeThemeOverrides = buildNaiveThemeOverrides(activeThemeMode);
let discreteApi = createNaiveDiscreteApi(activeThemeMode);

function createNaiveDiscreteApi(themeMode: ThemeMode) {
  const configProviderProps: ConfigProviderProps = {
    theme: themeMode === "dark" ? darkTheme : undefined,
    themeOverrides: activeThemeOverrides,
  };

  return createDiscreteApi(["dialog", "loadingBar", "message", "notification"], {
    configProviderProps,
  });
}

export function syncNaiveDiscreteTheme(themeMode: ThemeMode): void {
  activeThemeMode = themeMode;
  activeThemeOverrides = buildNaiveThemeOverrides(themeMode);
  discreteApi = createNaiveDiscreteApi(activeThemeMode);
}

export function useNaiveDiscrete() {
  return discreteApi;
}
