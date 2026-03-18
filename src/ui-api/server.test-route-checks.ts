import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createApp } from "../app/create-app.js";
import { type RunEvent, type RunRecord } from "../domain/models.js";
import { SELECTED_CLI_VALUES, type SelectedCli } from "./contracts.js";

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

export async function runCreateAndStaleBuildChecks(options: {
  baseUrl: string;
  seedApp: ReturnType<typeof createApp>;
  buildStampPath: string;
  tempRoot: string;
}): Promise<void> {
    const { baseUrl, seedApp, buildStampPath, tempRoot } = options;
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
