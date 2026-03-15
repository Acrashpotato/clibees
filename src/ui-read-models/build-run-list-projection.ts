import type { RunInspection } from "../domain/models.js";
import type { RunListItemView } from "./models.js";
import { buildRunListItemView } from "./build-views.js";

export interface RunListProjection {
  projection: "run_list";
  generatedAt: string;
  runs: RunListItemView[];
}

export function buildRunListProjection(inspections: RunInspection[]): RunListProjection {
  return {
    projection: "run_list",
    generatedAt: new Date().toISOString(),
    runs: inspections
      .map((inspection) => buildRunListItemView(inspection))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  };
}
