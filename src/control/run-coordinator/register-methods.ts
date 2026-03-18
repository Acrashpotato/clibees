import { RunCoordinator } from "./core.js";
import * as lifecycleMethods from "./methods/lifecycle.js";
import * as coordinationMethods from "./methods/coordination.js";
import * as executionCoreMethods from "./methods/execution-core.js";
import * as executionValidationMethods from "./methods/execution-validation.js";
import * as delegationPlanningMethods from "./methods/delegation-planning.js";
import * as delegationWorkerMethods from "./methods/delegation-workers.js";
import * as persistenceMethods from "./methods/persistence.js";

Object.assign(
  RunCoordinator.prototype as unknown as Record<string, unknown>,
  lifecycleMethods,
  coordinationMethods,
  executionCoreMethods,
  executionValidationMethods,
  delegationPlanningMethods,
  delegationWorkerMethods,
  persistenceMethods,
);
