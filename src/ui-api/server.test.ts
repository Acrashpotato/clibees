import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createApp } from "../app/create-app.js";
import { SCHEMA_VERSION, type RunEvent, type RunRecord } from "../domain/models.js";
import { SELECTED_CLI_VALUES, type SelectedCli } from "./contracts.js";
import { createUiApiServer } from "./server.js";

interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

interface InspectResponse {
  run: RunRecord;
  events: RunEvent[];
}

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
  const buildRootDir = path.join(tempRoot, "build-root");
  const buildStampPath = path.join(buildRootDir, "server-build.txt");
  await mkdir(buildRootDir, { recursive: true });
  await writeFile(buildStampPath, "initial-build", "utf8");
  const api = createUiApiServer({
    stateRootDir,
    port: 0,
    host: "127.0.0.1",
    buildRootDir,
  });
  await api.listen();

  const originalPath = process.env.PATH ?? "";
  const mockCliDir = path.join(tempRoot, "mock-cli");
  await installMockCliCommands(mockCliDir, SELECTED_CLI_VALUES);
  process.env.PATH = `${mockCliDir}${path.delimiter}${originalPath}`;

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

    const delegatedRun = await seedApp.runCoordinator.startRun({
      goal: "Delegated manager chat route test",
      workspacePath: tempRoot,
      metadata: {
        plannerMode: "delegated",
        plannerAgentId: "codex",
        agentIds: ["codex", "codefree"],
        selectedCli: "codex",
      },
    });
    const managerSession = await seedApp.runCoordinator.ensureManagerSession(delegatedRun.runId);

    const managerProjectionResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(delegatedRun.runId)}/projections/manager-chat`,
    );
    assert.equal(managerProjectionResponse.status, 200);
    const managerProjectionPayload = await managerProjectionResponse.json() as {
      data: {
        projection: string;
        run: { runId: string };
        managerSession?: { sessionId: string; threadId: string };
      };
    };
    assert.equal(managerProjectionPayload.data.projection, "manager_chat");
    assert.equal(managerProjectionPayload.data.run.runId, delegatedRun.runId);
    assert.equal(managerProjectionPayload.data.managerSession?.sessionId, "manager_primary");

    const workerpollProjectionResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(delegatedRun.runId)}/projections/workerpoll`,
    );
    assert.equal(workerpollProjectionResponse.status, 200);
    const workerpollProjectionPayload = await workerpollProjectionResponse.json() as {
      data: {
        projection: string;
        run: { runId: string };
        workers: unknown[];
        tasks: unknown[];
      };
    };
    assert.equal(workerpollProjectionPayload.data.projection, "workerpoll");
    assert.equal(workerpollProjectionPayload.data.run.runId, delegatedRun.runId);
    assert.ok(Array.isArray(workerpollProjectionPayload.data.workers));
    assert.ok(Array.isArray(workerpollProjectionPayload.data.tasks));

    const threadMessageResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(delegatedRun.runId)}/threads/${encodeURIComponent(managerSession.thread.threadId)}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          actorId: "console-user",
          body: "Please coordinate next tasks.",
          clientRequestId: "thread-msg-001",
        }),
      },
    );
    assert.equal(threadMessageResponse.status, 200);
    const threadMessagePayload = await threadMessageResponse.json() as {
      action: string;
      data: {
        runStatus: string;
        resumed: boolean;
        message: { body: string };
      };
    };
    assert.equal(threadMessagePayload.action, "post_thread_message");
    assert.equal(threadMessagePayload.data.message.body, "Please coordinate next tasks.");
    assert.equal(typeof threadMessagePayload.data.resumed, "boolean");
    assert.equal(typeof threadMessagePayload.data.runStatus, "string");

    const interactSessionResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(delegatedRun.runId)}/sessions/${encodeURIComponent(managerSession.session.sessionId)}/interact`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          actorId: "console-user",
          body: "Any additional tasks?",
          clientRequestId: "session-msg-001",
        }),
      },
    );
    if (interactSessionResponse.status === 200) {
      const interactSessionPayload = await interactSessionResponse.json() as {
        action: string;
        data: {
          threadId: string;
          message: { body: string };
        };
      };
      assert.equal(interactSessionPayload.action, "interact_session");
      assert.equal(interactSessionPayload.data.threadId, managerSession.thread.threadId);
      assert.equal(interactSessionPayload.data.message.body, "Any additional tasks?");
    } else {
      assert.equal(interactSessionResponse.status, 409);
      const interactConflictPayload = await interactSessionResponse.json() as ApiErrorResponse;
      assert.equal(interactConflictPayload.error.code, "state_conflict");
    }

    const missingThreadResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(delegatedRun.runId)}/threads/${encodeURIComponent("missing-thread")}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          actorId: "console-user",
          body: "hello",
          clientRequestId: "missing-thread-001",
        }),
      },
    );
    if (missingThreadResponse.status === 404) {
      const missingThreadPayload = await missingThreadResponse.json() as ApiErrorResponse;
      assert.equal(missingThreadPayload.error.code, "not_found");
    } else {
      assert.equal(missingThreadResponse.status, 409);
      const missingThreadConflictPayload = await missingThreadResponse.json() as ApiErrorResponse;
      assert.equal(missingThreadConflictPayload.error.code, "state_conflict");
    }

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

    const deleteResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(started.runId)}/delete`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    assert.equal(deleteResponse.status, 200);
    const deletePayload = await deleteResponse.json() as {
      runId: string;
      deleted: boolean;
    };
    assert.equal(deletePayload.runId, started.runId);
    assert.equal(deletePayload.deleted, true);

    const runListAfterDeleteResponse = await fetch(`${baseUrl}/api/runs`);
    assert.equal(runListAfterDeleteResponse.status, 200);
    const runListAfterDelete = await runListAfterDeleteResponse.json() as Array<{ runId: string }>;
    assert.ok(!runListAfterDelete.some((run) => run.runId === started.runId));

    const deleteMissingResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(started.runId)}/delete`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    assert.equal(deleteMissingResponse.status, 404);
    const deleteMissingPayload = await deleteMissingResponse.json() as ApiErrorResponse;
    assert.equal(deleteMissingPayload.error.code, "not_found");

    const deleteViaDeleteCreateResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "Delete route compatibility run",
        cli: "codex",
      }),
    });
    assert.equal(deleteViaDeleteCreateResponse.status, 201);
    const deleteViaDeleteCreated = await deleteViaDeleteCreateResponse.json() as RunRecord;
    const defaultApiConfig = await seedApp.dependencies.configLoader.load();
    assert.equal(
      deleteViaDeleteCreated.metadata.allowOutsideWorkspaceWrites,
      defaultApiConfig.workspace.allowOutsideWorkspaceWrites,
    );

    const deleteViaDeleteResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(deleteViaDeleteCreated.runId)}`,
      {
        method: "DELETE",
      },
    );
    assert.equal(deleteViaDeleteResponse.status, 200);
    const deleteViaDeletePayload = await deleteViaDeleteResponse.json() as {
      runId: string;
      deleted: boolean;
    };
    assert.equal(deleteViaDeletePayload.runId, deleteViaDeleteCreated.runId);
    assert.equal(deleteViaDeletePayload.deleted, true);

    const createdRunIds = new Map<SelectedCli, string>();
    for (const cli of SELECTED_CLI_VALUES) {
      const allowOutsideWorkspaceWrites = cli === "codex";
      const createResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          goal: `Create run with ${cli}`,
          cli,
          autoResume: false,
          allowOutsideWorkspaceWrites,
        }),
      });
      assert.equal(createResponse.status, 201);
      const createPayload = await createResponse.json() as RunRecord;
      assert.equal(createPayload.status, "ready");
      assert.equal(createPayload.metadata.selectedCli, cli);
      assert.equal(
        createPayload.metadata.allowOutsideWorkspaceWrites,
        allowOutsideWorkspaceWrites,
      );
      createdRunIds.set(cli, createPayload.runId);

      const createInspection = await fetchRunInspection(baseUrl, createPayload.runId);
      assert.equal(createInspection.run.metadata.selectedCli, cli);
      assert.equal(
        createInspection.run.metadata.allowOutsideWorkspaceWrites,
        allowOutsideWorkspaceWrites,
      );
    }

    const invalidCliResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "Create run with invalid cli",
        cli: "invalid-cli",
      }),
    });
    assert.equal(invalidCliResponse.status, 400);
    const invalidCliPayload = await invalidCliResponse.json() as ApiErrorResponse;
    assert.equal(invalidCliPayload.error.code, "bad_request");
    assert.match(invalidCliPayload.error.message, /codex, codefree, claude/);

    const missingCliResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "Create run without cli",
      }),
    });
    assert.equal(missingCliResponse.status, 400);
    const missingCliPayload = await missingCliResponse.json() as ApiErrorResponse;
    assert.equal(missingCliPayload.error.code, "bad_request");
    assert.match(missingCliPayload.error.message, /codex, codefree, claude/);

    const invalidAllowOutsideWorkspaceWritesResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "Create run with invalid write policy override",
        cli: "codex",
        allowOutsideWorkspaceWrites: "true",
      }),
    });
    assert.equal(invalidAllowOutsideWorkspaceWritesResponse.status, 400);
    const invalidAllowOutsideWorkspaceWritesPayload =
      await invalidAllowOutsideWorkspaceWritesResponse.json() as ApiErrorResponse;
    assert.equal(invalidAllowOutsideWorkspaceWritesPayload.error.code, "bad_request");
    assert.match(invalidAllowOutsideWorkspaceWritesPayload.error.message, /allowOutsideWorkspaceWrites/);

    const autoResumeResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "Create run with autoResume",
        cli: "codex",
        autoResume: true,
      }),
    });
    assert.equal(autoResumeResponse.status, 201);
    const autoResumePayload = await autoResumeResponse.json() as RunRecord;
    assert.equal(autoResumePayload.metadata.selectedCli, "codex");
    assert.notEqual(autoResumePayload.status, "ready");
    const autoResumeInspection = await fetchRunInspection(baseUrl, autoResumePayload.runId);
    assertSelectedCliEvents(autoResumeInspection.events, "codex");

    const codefreeRunId = createdRunIds.get("codefree");
    assert.ok(codefreeRunId);
    const codefreeResumeResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(codefreeRunId!)}/resume`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    assert.equal(codefreeResumeResponse.status, 200);
    const codefreeResumePayload = await codefreeResumeResponse.json() as RunRecord;
    assert.notEqual(codefreeResumePayload.status, "ready");
    const codefreeResumeInspection = await fetchRunInspection(baseUrl, codefreeRunId!);
    assertSelectedCliEvents(codefreeResumeInspection.events, "codefree");

    const legacyRun = await seedApp.runCoordinator.startRun({
      goal: "Legacy run fallback to codex",
      workspacePath: tempRoot,
      metadata: {
        legacy: true,
      },
    });
    const legacyStoredRun = await seedApp.dependencies.runStore.getRun(legacyRun.runId);
    assert.ok(legacyStoredRun);
    assert.equal(legacyStoredRun!.metadata.selectedCli, undefined);

    const legacyResumeResponse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(legacyRun.runId)}/resume`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    assert.equal(legacyResumeResponse.status, 200);
    const legacyResumePayload = await legacyResumeResponse.json() as RunRecord;
    assert.notEqual(legacyResumePayload.status, "ready");
    const legacyResumeInspection = await fetchRunInspection(baseUrl, legacyRun.runId);
    assertSelectedCliEvents(legacyResumeInspection.events, "codex");

    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(buildStampPath, "updated-build", "utf8");

    const staleBuildCreateResponse = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "Create run after build output changes",
        cli: "codex",
      }),
    });
    assert.equal(staleBuildCreateResponse.status, 409);
    const staleBuildCreatePayload = await staleBuildCreateResponse.json() as ApiErrorResponse;
    assert.equal(staleBuildCreatePayload.error.code, "state_conflict");
    assert.match(staleBuildCreatePayload.error.message, /Restart the UI API server/);
  } finally {
    process.env.PATH = originalPath;
    await api.close();
  }
} finally {
  await rm(tempRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

async function installMockCliCommands(
  directoryPath: string,
  cliValues: readonly string[],
): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
  await Promise.all(
    cliValues.map((cli) =>
      writeFile(
        path.join(directoryPath, `${cli}.cmd`),
        "@echo off\r\nexit /b 0\r\n",
        "utf8",
      )),
  );
}

async function fetchRunInspection(
  baseUrl: string,
  runId: string,
): Promise<InspectResponse> {
  const inspectionResponse = await fetch(
    `${baseUrl}/api/runs/${encodeURIComponent(runId)}/inspect`,
  );
  assert.equal(inspectionResponse.status, 200);
  return await inspectionResponse.json() as InspectResponse;
}

function assertSelectedCliEvents(
  events: RunEvent[],
  selectedCli: SelectedCli,
): void {
  const selectedEvent = events.find((event) => {
    if (event.type !== "agent_selected") {
      return false;
    }
    const payload = asPayload(event);
    return payload.agentId === selectedCli;
  });
  assert.ok(selectedEvent, `Expected an agent_selected event for "${selectedCli}".`);

  const invocationEvent = events.find((event) => {
    if (event.type !== "invocation_planned") {
      return false;
    }
    const payload = asPayload(event);
    return payload.agentId === selectedCli && payload.command === selectedCli;
  });
  assert.ok(
    invocationEvent,
    `Expected an invocation_planned event with command "${selectedCli}".`,
  );
}

function asPayload(event: RunEvent): Record<string, unknown> {
  if (typeof event.payload === "object" && event.payload !== null) {
    return event.payload as Record<string, unknown>;
  }

  return {};
}
