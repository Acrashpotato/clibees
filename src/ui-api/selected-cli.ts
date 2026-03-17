export const SELECTED_CLI_VALUES = ["codex", "codefree", "claude"] as const;

export type SelectedCli = (typeof SELECTED_CLI_VALUES)[number];
