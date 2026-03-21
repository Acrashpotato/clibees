import type { GlobalThemeOverrides } from "naive-ui";

export type ThemeMode = "dark" | "light";

const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#1890ff",
    primaryColorHover: "#40a9ff",
    primaryColorPressed: "#096dd9",
    primaryColorSuppl: "#1677ff",
    infoColor: "#1677ff",
    successColor: "#52c41a",
    warningColor: "#faad14",
    errorColor: "#ff4d4f",
    borderRadius: "12px",
    fontFamily:
      "\"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei UI\", \"Noto Sans CJK SC\", \"Segoe UI\", sans-serif",
  },
  Card: {
    borderRadius: "14px",
  },
  Input: {
    borderRadius: "10px",
  },
  Button: {
    borderRadiusSmall: "8px",
    borderRadiusMedium: "10px",
    borderRadiusLarge: "12px",
  },
};

const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#4ea8ff",
    primaryColorHover: "#7abfff",
    primaryColorPressed: "#2f87dc",
    primaryColorSuppl: "#4ea8ff",
    infoColor: "#4ea8ff",
    successColor: "#7fd666",
    warningColor: "#f4c253",
    errorColor: "#ff7875",
    borderRadius: "12px",
    fontFamily:
      "\"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei UI\", \"Noto Sans CJK SC\", \"Segoe UI\", sans-serif",
  },
  Card: {
    borderRadius: "14px",
    color: "#111b2a",
  },
  Input: {
    borderRadius: "10px",
  },
  Button: {
    borderRadiusSmall: "8px",
    borderRadiusMedium: "10px",
    borderRadiusLarge: "12px",
  },
};

export function buildNaiveThemeOverrides(themeMode: ThemeMode): GlobalThemeOverrides {
  return themeMode === "dark" ? darkThemeOverrides : lightThemeOverrides;
}

