import type { Locale } from "../i18n";
import type { WorkspaceView } from "../types";
import { createEmptyWorkspace } from "../workspace";

export function getMockWorkspace(_locale: Locale): WorkspaceView {
  return createEmptyWorkspace("mock-run");
}
