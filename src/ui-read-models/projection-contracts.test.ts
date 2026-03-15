import assert from "node:assert/strict";
import {
  UI_PROJECTION_CONSISTENCY_CONTRACTS,
  UI_PROJECTION_CONTRACTS,
  getUiProjectionConsistencyContract,
  getUiProjectionContract,
} from "./projection-contracts.js";

assert.equal(UI_PROJECTION_CONTRACTS.length, 7);
assert.equal(UI_PROJECTION_CONSISTENCY_CONTRACTS.length, 7);

const workspace = getUiProjectionContract("workspace");
assert.equal(workspace.page, "workspace");
assert.ok(workspace.primarySources.includes("session_message"));
assert.ok(workspace.primarySources.includes("message_thread"));

const taskSession = getUiProjectionConsistencyContract("task_session");
assert.equal(taskSession.canonicalSources[0], "task_session");
assert.ok(taskSession.requiredProjections.includes("session_detail"));
assert.ok(
  taskSession.invariants.some((rule) => rule.includes("requeue creates a new session identity")),
);

const approval = getUiProjectionConsistencyContract("approval_request");
assert.ok(approval.canonicalSources.includes("approval_request"));
assert.ok(approval.requiredProjections.includes("approval_queue"));
assert.ok(approval.traceabilityKeys.includes("actionPlanId"));

const message = getUiProjectionConsistencyContract("session_message");
assert.ok(message.canonicalSources.includes("session_message"));
assert.ok(message.canonicalSources.includes("message_thread"));
assert.ok(!message.canonicalSources.includes("legacy_run_inspection"));
