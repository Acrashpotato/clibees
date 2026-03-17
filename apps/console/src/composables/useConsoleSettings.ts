import { ref } from "vue";

import type { SelectedCli } from "../api";

export type ApprovalFilter = "all" | "pending" | "approved" | "rejected";
export type RunOpenTarget = "session" | "workspace";
export type InspectDefaultRunSource = "latest" | "remembered";

export interface ConsoleSettings {
  runDefaultCli: SelectedCli;
  runAutoResume: boolean;
  runAllowOutsideWorkspaceWrites: boolean;
  runOpenTarget: RunOpenTarget;
  approvalsDefaultFilter: ApprovalFilter;
  approvalsFetchLimit: number;
  approvalsAutoRefreshSec: number;
  inspectDefaultRunSource: InspectDefaultRunSource;
  inspectAutoRefreshSec: number;
  workspaceAutoRefreshSec: number;
}

const SETTINGS_KEY = "clibees.console.settings.v2";
const INSPECT_LAST_RUN_KEY = "clibees.console.inspect.lastRunId";
const AUTO_REFRESH_MIN_SEC = 0;
const AUTO_REFRESH_MAX_SEC = 120;
const APPROVAL_LIMIT_MIN = 20;
const APPROVAL_LIMIT_MAX = 300;
const WORKSPACE_REFRESH_MIN_SEC = 1;
const WORKSPACE_REFRESH_MAX_SEC = 30;

const defaultConsoleSettings: Readonly<ConsoleSettings> = {
  runDefaultCli: "codex",
  runAutoResume: true,
  runAllowOutsideWorkspaceWrites: false,
  runOpenTarget: "session",
  approvalsDefaultFilter: "pending",
  approvalsFetchLimit: 100,
  approvalsAutoRefreshSec: 10,
  inspectDefaultRunSource: "remembered",
  inspectAutoRefreshSec: 15,
  workspaceAutoRefreshSec: 2,
};

const settings = ref<ConsoleSettings>({ ...defaultConsoleSettings });

let initialized = false;

function clampInt(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  const rounded = Math.round(value);
  return Math.max(minimum, Math.min(maximum, rounded));
}

function normalizeSettings(raw: unknown): ConsoleSettings {
  const normalized: ConsoleSettings = { ...defaultConsoleSettings };

  if (!raw || typeof raw !== "object") {
    return normalized;
  }

  const candidate = raw as Record<string, unknown>;

  if (
    candidate.runDefaultCli === "codex" ||
    candidate.runDefaultCli === "codefree" ||
    candidate.runDefaultCli === "claude"
  ) {
    normalized.runDefaultCli = candidate.runDefaultCli;
  }

  if (typeof candidate.runAutoResume === "boolean") {
    normalized.runAutoResume = candidate.runAutoResume;
  }

  if (typeof candidate.runAllowOutsideWorkspaceWrites === "boolean") {
    normalized.runAllowOutsideWorkspaceWrites = candidate.runAllowOutsideWorkspaceWrites;
  }

  if (candidate.runOpenTarget === "session" || candidate.runOpenTarget === "workspace") {
    normalized.runOpenTarget = candidate.runOpenTarget;
  }

  if (
    candidate.approvalsDefaultFilter === "all" ||
    candidate.approvalsDefaultFilter === "pending" ||
    candidate.approvalsDefaultFilter === "approved" ||
    candidate.approvalsDefaultFilter === "rejected"
  ) {
    normalized.approvalsDefaultFilter = candidate.approvalsDefaultFilter;
  }

  if (
    typeof candidate.approvalsFetchLimit === "number" ||
    (typeof candidate.approvalsFetchLimit === "string" && candidate.approvalsFetchLimit.length > 0)
  ) {
    normalized.approvalsFetchLimit = clampInt(
      Number(candidate.approvalsFetchLimit),
      APPROVAL_LIMIT_MIN,
      APPROVAL_LIMIT_MAX,
    );
  }

  if (
    typeof candidate.approvalsAutoRefreshSec === "number" ||
    (typeof candidate.approvalsAutoRefreshSec === "string" && candidate.approvalsAutoRefreshSec.length > 0)
  ) {
    normalized.approvalsAutoRefreshSec = clampInt(
      Number(candidate.approvalsAutoRefreshSec),
      AUTO_REFRESH_MIN_SEC,
      AUTO_REFRESH_MAX_SEC,
    );
  }

  if (
    candidate.inspectDefaultRunSource === "latest" ||
    candidate.inspectDefaultRunSource === "remembered"
  ) {
    normalized.inspectDefaultRunSource = candidate.inspectDefaultRunSource;
  }

  if (
    typeof candidate.inspectAutoRefreshSec === "number" ||
    (typeof candidate.inspectAutoRefreshSec === "string" && candidate.inspectAutoRefreshSec.length > 0)
  ) {
    normalized.inspectAutoRefreshSec = clampInt(
      Number(candidate.inspectAutoRefreshSec),
      AUTO_REFRESH_MIN_SEC,
      AUTO_REFRESH_MAX_SEC,
    );
  }

  if (
    typeof candidate.workspaceAutoRefreshSec === "number" ||
    (typeof candidate.workspaceAutoRefreshSec === "string" && candidate.workspaceAutoRefreshSec.length > 0)
  ) {
    normalized.workspaceAutoRefreshSec = clampInt(
      Number(candidate.workspaceAutoRefreshSec),
      WORKSPACE_REFRESH_MIN_SEC,
      WORKSPACE_REFRESH_MAX_SEC,
    );
  }

  return normalized;
}

function persistSettings(nextSettings: ConsoleSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
}

function initSettings() {
  if (initialized || typeof window === "undefined") {
    initialized = true;
    return;
  }

  try {
    const serialized = window.localStorage.getItem(SETTINGS_KEY);
    settings.value = serialized
      ? normalizeSettings(JSON.parse(serialized) as unknown)
      : { ...defaultConsoleSettings };
  } catch {
    settings.value = { ...defaultConsoleSettings };
  }

  initialized = true;
}

export function useConsoleSettings() {
  initSettings();

  function saveConsoleSettings(nextSettings: ConsoleSettings): void {
    const normalized = normalizeSettings(nextSettings);
    settings.value = normalized;
    persistSettings(normalized);
  }

  function resetConsoleSettings(): void {
    settings.value = { ...defaultConsoleSettings };
    persistSettings(settings.value);
  }

  function rememberInspectRunId(runId: string | undefined): void {
    if (typeof window === "undefined" || !runId) {
      return;
    }
    window.localStorage.setItem(INSPECT_LAST_RUN_KEY, runId);
  }

  function getRememberedInspectRunId(): string | undefined {
    if (typeof window === "undefined") {
      return undefined;
    }

    const stored = window.localStorage.getItem(INSPECT_LAST_RUN_KEY);
    return stored ?? undefined;
  }

  return {
    settings,
    defaultConsoleSettings,
    saveConsoleSettings,
    resetConsoleSettings,
    rememberInspectRunId,
    getRememberedInspectRunId,
    limits: {
      autoRefreshMinSec: AUTO_REFRESH_MIN_SEC,
      autoRefreshMaxSec: AUTO_REFRESH_MAX_SEC,
      approvalLimitMin: APPROVAL_LIMIT_MIN,
      approvalLimitMax: APPROVAL_LIMIT_MAX,
      workspaceRefreshMinSec: WORKSPACE_REFRESH_MIN_SEC,
      workspaceRefreshMaxSec: WORKSPACE_REFRESH_MAX_SEC,
    },
  };
}
