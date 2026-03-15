import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createApp } from "../app/create-app.js";
import { SCHEMA_VERSION, type RunEvent } from "../domain/models.js";
import { createUiApiServer } from "./server.js";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "clibees-ui-api-"));
const stateRootDir = path.join(tempRoot, "state");
const seedApp = createApp({ stateRootDir });

try {
  const started = await seedApp.runCoordinator.startRun({
    goal: "Task 18 API regression",
    workspacePath: tempRoot,
  });
  const graph = await seedApp.dependencies.runStore.getGraph(started.runId);
  assert.ok(graph);
  const task = Object.values(graph!.tasks)[0]!;
  const timestamp = new Date().toISOString();

  await seedApp.dependencies.runStore.updateTaskStatus(started.runId, task.id, "routing");
  await seedApp.dependencies.runStore.updateTaskStatus(started.runId, task.id, "context_building");
  await seedApp.dependencies.runStore.updateTaskStatus(started.runId, task.id, "queued");
  await seedApp.dependencies.runStore.updateTaskStatus(started.runId, task.id, "running");
  await seedApp.dependencies.runStore.updateRun({
    ...started,
    status: "running",
    currentTaskId: task.id,
    updatedAt: timestamp,
  });

  const events: RunEvent[] = [
    {
      schemaVersion: SCHEMA_VERSION,
      id: "evt-task-started",
      type: "task_started",
      runId: started.runId,
      taskId: task.id,
      timestamp,
      payload: {
        agentId: "planner-agent",
      },
    },
    {
      schemaVersion: SCHEMA_VERSION,
      id: "evt-agent-message",
      type: "agent_message",
      runId: started.runId,
      taskId: task.id,
      timestamp: new Date(Date.parse(timestamp) + 1000).toISOString(),
      payload: {
        agentId: "planner-agent",
        message: "session output line",
      },
    },
  ];

  for (const event of events) {
    await seedApp.dependencies.eventStore.append(event);
  }

  const sessionId = `backfill:${encodeURIComponent(task.id)}:attempt:1`;
  const api = createUiApiServer({ stateRootDir, port: 0, host: "127.0.0.1" });
  await api.listen();

  try {
    const address = api.getAddress() as AddressInfo | null;
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${address!.port}`;

    const runListResponse = await fetch(`${baseUrl}/api/projections/run-list?limit=1`);
    assert.equal(runListResponse.status, 200);
    const runListPayload = await runListResponse.json() as {
      data: { projection: string; runs: Array<{ runId: string }> };
      page: { returnedCount: number; totalCount: number };
    };
    assert.equal(runListPayload.data.projection, "run_list");
    assert.equal(runListPayload.page.returnedCount, 1);
    assert.ok(runListPayload.data.runs.some((run) => run.runId === started.runId));

    const workspaceResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(started.runId)}/projections/workspace`);
    assert.equal(workspaceResponse.status, 200);
    const workspacePayload = await workspaceResponse.json() as {
      data: { projection: string; run: { runId: string } };
    };
    assert.equal(workspacePayload.data.projection, "workspace");
    assert.equal(workspacePayload.data.run.runId, started.runId);

    const taskBoardResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(started.runId)}/projections/task-board`);
    assert.equal(taskBoardResponse.status, 200);
    const taskBoardPayload = await taskBoardResponse.json() as {
      data: { projection: string; tasks: Array<{ taskId: string }> };
    };
    assert.equal(taskBoardPayload.data.projection, "task_board");
    assert.ok(taskBoardPayload.data.tasks.some((item) => item.taskId === task.id));

    const taskDetailResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(started.runId)}/tasks/${encodeURIComponent(task.id)}/projection`);
    assert.equal(taskDetailResponse.status, 200);
    const taskDetailPayload = await taskDetailResponse.json() as {
      data: { projection: string; taskId: string };
    };
    assert.equal(taskDetailPayload.data.projection, "task_detail");
    assert.equal(taskDetailPayload.data.taskId, task.id);

    const sessionDetailResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(started.runId)}/sessions/${encodeURIComponent(sessionId)}/projection`);
    assert.equal(sessionDetailResponse.status, 200);
    const sessionDetailPayload = await sessionDetailResponse.json() as {
      data: { projection: string; sessionId: string };
    };
    assert.equal(sessionDetailPayload.data.projection, "session_detail");
    assert.equal(sessionDetailPayload.data.sessionId, sessionId);

    const approvalQueueResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(started.runId)}/projections/approval-queue?limit=5`);
    assert.equal(approvalQueueResponse.status, 200);
    const approvalQueuePayload = await approvalQueueResponse.json() as {
      data: { projection: string; items: unknown[]; summary: { totalCount: number } };
      page: { limit: number };
    };
    assert.equal(approvalQueuePayload.data.projection, "approval_queue");
    assert.equal(approvalQueuePayload.data.summary.totalCount, 0);
    assert.equal(approvalQueuePayload.page.limit, 5);

    const auditTimelineResponse = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(started.runId)}/projections/audit-timeline`);
    assert.equal(auditTimelineResponse.status, 200);
    const auditTimelinePayload = await auditTimelineResponse.json() as {
      data: { projection: string; entries: Array<{ eventId: string }> };
    };
    assert.equal(auditTimelinePayload.data.projection, "audit_timeline");
    assert.ok(auditTimelinePayload.data.entries.some((entry) => entry.eventId === "evt-agent-message"));

    const unsupportedActionResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(started.runId)}/sessions/${encodeURIComponent(sessionId)}/interrupt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ actorId: "tester" }),
      },
    );
    assert.equal(unsupportedActionResponse.status, 501);
    const unsupportedActionPayload = await unsupportedActionResponse.json() as {
      error: { code: string };
    };
    assert.equal(unsupportedActionPayload.error.code, "not_supported");
  } finally {
    await api.close();
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

