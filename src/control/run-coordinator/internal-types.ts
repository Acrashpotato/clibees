import type { RunCoordinatorDependencies } from "./core.js";

export interface RunCoordinatorMethodThis {
  readonly dependencies: RunCoordinatorDependencies;
  [key: string]: any;
}
