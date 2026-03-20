import test from "node:test";
import assert from "node:assert/strict";
import { createId } from "./runtime.js";

test("createId uses Beijing (+08:00) wall-clock time for task IDs", () => {
  const fixedUtc = new Date("2026-03-18T11:06:50.789Z");
  const taskId = createId("task", fixedUtc);
  assert.match(taskId, /^task-2026-03-18T19-06-50-789-[0-9a-f]{8}$/);
});

test("createId keeps UTC ISO timestamp behavior for non-task IDs", () => {
  const fixedUtc = new Date("2026-03-18T11:06:50.789Z");
  const runId = createId("run", fixedUtc);
  assert.match(runId, /^run-2026-03-18T11-06-50-789Z-[0-9a-f]{8}$/);
});

test("task ID Beijing timestamp rolls date forward when UTC day crosses midnight", () => {
  const fixedUtc = new Date("2026-03-18T20:59:59.001Z");
  const taskId = createId("task", fixedUtc);
  assert.match(taskId, /^task-2026-03-19T04-59-59-001-[0-9a-f]{8}$/);
});
