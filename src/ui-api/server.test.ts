import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createApp } from "../app/create-app.js";
import { SCHEMA_VERSION, type RunEvent, type RunRecord } from "../domain/models.js";
import { SELECTED_CLI_VALUES, type SelectedCli } from "./contracts.js";
import { createUiApiServer } from "./server.js";
import { runCreateAndStaleBuildChecks } from "./server.test-route-checks.js";

interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
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

    const memoryRootDir = path.join(tempRoot, "memory");
    const memoryRecordsPath = path.join(memoryRootDir, "records.jsonl");
    const memoryIndexPath = path.join(memoryRootDir, "index.json");
    const seededMemoryRecords = [
      {
        id: "mem-started",
        scope: "run_context",
        tags: ["started"],
        runId: started.runId,
      },
      {
        id: "mem-legacy",
        scope: "run_context",
        tags: ["legacy"],
        runId: "run-legacy",
      },
    ];
    await mkdir(memoryRootDir, { recursive: true });
    await writeFile(
      memoryRecordsPath,
      seededMemoryRecords.map((record) => JSON.stringify(record)).join("\n") + "\n",
      "utf8",
    );
    await writeFile(
      memoryIndexPath,
      `${JSON.stringify(
        {
          records: seededMemoryRecords.map((record) => record.id),
          byScope: {
            run_context: seededMemoryRecords.map((record) => record.id),
          },
          byTag: {
            started: ["mem-started"],
            legacy: ["mem-legacy"],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const multiAgentSummaryResponse = await fetch(`${baseUrl}/api/system/multi-agent/summary`);
    assert.equal(multiAgentSummaryResponse.status, 200);
    const multiAgentSummaryPayload = await multiAgentSummaryResponse.json() as {
      runs: {
        totalCount: number;
        items: Array<{ runId: string }>;
      };
      memory: {
        recordsCount: number;
      };
    };
    assert.ok(multiAgentSummaryPayload.runs.totalCount >= 1);
    assert.ok(multiAgentSummaryPayload.runs.items.some((run) => run.runId === started.runId));
    assert.equal(multiAgentSummaryPayload.memory.recordsCount, seededMemoryRecords.length);

    const invalidCleanupResponse = await fetch(`${baseUrl}/api/system/multi-agent/cleanup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clearMemory: "true",
      }),
    });
    assert.equal(invalidCleanupResponse.status, 400);
    const invalidCleanupPayload = await invalidCleanupResponse.json() as ApiErrorResponse;
    assert.equal(invalidCleanupPayload.error.code, "bad_request");

    const missingRunCleanupResponse = await fetch(`${baseUrl}/api/system/multi-agent/cleanup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keepRunId: "run-missing",
      }),
    });
    assert.equal(missingRunCleanupResponse.status, 404);
    const missingRunCleanupPayload = await missingRunCleanupResponse.json() as ApiErrorResponse;
    assert.equal(missingRunCleanupPayload.error.code, "not_found");

    const clearMemoryResponse = await fetch(`${baseUrl}/api/system/multi-agent/cleanup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clearMemory: true,
      }),
    });
    assert.equal(clearMemoryResponse.status, 200);
    const clearMemoryPayload = await clearMemoryResponse.json() as {
      removedRunIds: string[];
      memory: {
        before: number;
        after: number;
        removed: number;
      };
    };
    assert.equal(clearMemoryPayload.removedRunIds.length, 0);
    assert.equal(clearMemoryPayload.memory.before, seededMemoryRecords.length);
    assert.equal(clearMemoryPayload.memory.after, 0);
    assert.equal(clearMemoryPayload.memory.removed, seededMemoryRecords.length);

    const summaryAfterClearResponse = await fetch(`${baseUrl}/api/system/multi-agent/summary`);
    assert.equal(summaryAfterClearResponse.status, 200);
    const summaryAfterClearPayload = await summaryAfterClearResponse.json() as {
      runs: {
        items: Array<{ runId: string }>;
      };
      memory: {
        recordsCount: number;
      };
    };
    assert.ok(summaryAfterClearPayload.runs.items.some((run) => run.runId === started.runId));
    assert.equal(summaryAfterClearPayload.memory.recordsCount, 0);

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
    if (threadMessageResponse.status === 200) {
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
    } else {
      assert.equal(threadMessageResponse.status, 409);
      const threadConflictPayload = await threadMessageResponse.json() as ApiErrorResponse;
      assert.equal(threadConflictPayload.error.code, "state_conflict");
    }

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

    await runCreateAndStaleBuildChecks({
      baseUrl,
      seedApp,
      buildStampPath,
      tempRoot,
    });
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
