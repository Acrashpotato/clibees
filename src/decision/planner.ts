import type {
  GraphPatch,
  MemoryRecord,
  RunGraph,
  TaskSpec,
  ValidationResult,
} from "../domain/models.js";

export interface PlannerInput {
  goal: string;
  workspacePath: string;
  graph?: RunGraph;
  recalledMemories: MemoryRecord[];
  validationResults: ValidationResult[];
}

export interface ReplanInput {
  goal: string;
  graph: RunGraph;
  recalledMemories: MemoryRecord[];
  validationResults: ValidationResult[];
}

export interface Planner {
  createInitialPlan(input: PlannerInput): Promise<TaskSpec[]>;
  replan(input: ReplanInput): Promise<GraphPatch>;
}
