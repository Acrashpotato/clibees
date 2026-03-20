import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { MultiAgentConfig } from "../domain/config.js";
import type {
  InvocationPlan,
  RunEvent,
  RunInspection,
  RunRecord,
  TaskSpec,
} from "../domain/models.js";
import { createApp } from "../app/create-app.js";
import { FileEventStore } from "../storage/event-store.js";
import {
  buildExecutionRuntime,
  createDelegatedConfig,
  createDelegatedRegistry,
} from "./delegated-manager.test-helpers.js";
import {
  waitForMs,
  writeSkillFile,
} from "./delegated-manager-skills.helpers.js";

test("delegated task applies local skill template defaults when skillId is available", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-skill-template-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "skill-template", "utf8");
  await writeSkillFile(workspaceDir, {
    id: "code-implementation",
    name: "Code Implementation",
    description: "Implement code changes with verification.",
    template: {
      instructions: [
        "Implement concrete code changes.",
        "Run focused verification steps.",
      ],
      expectedArtifacts: ["Implementation output from skill template."],
      acceptanceCriteria: ["Behavior requested by delegated goal is implemented."],
      riskLevel: "medium",
      timeoutMs: 780000,
      validator: { mode: "none" },
    },
  });

  const config = createDelegatedConfig(workspaceDir);
  const adapterRegistry = createDelegatedRegistry();
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry,
    eventStore,
    executionRuntime: buildExecutionRuntime(eventStore, {
      managerDelegatedTasks: [
        {
          title: "Implement via skill template",
          goal: "Deliver implementation using skill defaults.",
          skillId: "code-implementation",
          preferredAgent: "cli-worker",
          requiredCapabilities: ["planning"],
        },
      ],
    }),
    configLoader: {
      async load(): Promise<MultiAgentConfig> {
        return config;
      },
    },
    projectMemoryStore: {
      async recall() {
        return [];
      },
      async persist() {
        return;
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "skill template"])) as RunRecord;
  const completed = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(completed.status, "completed");

  const inspection = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  const tasks = Object.values(inspection.graph.tasks);
  const managerTask = tasks.find(
    (candidate) =>
      candidate.kind === "plan" &&
      candidate.requiredCapabilities.includes("delegation"),
  );
  const workerTask = tasks.find((candidate) => candidate.id !== managerTask?.id);
  assert.ok(workerTask);
  assert.equal(workerTask?.metadata?.skillId, "code-implementation");
  assert.equal(workerTask?.metadata?.skillSource, "local_registry");
  assert.equal(workerTask?.timeoutMs, 780000);
  assert.ok(
    workerTask?.instructions.some((instruction) =>
      instruction.includes("Implement concrete code changes."),
    ),
  );
  assert.ok(
    workerTask?.expectedArtifacts.includes("Implementation output from skill template."),
  );
});

test("missing skill requires manual approval before delegated worker tasks proceed", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-skill-missing-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "skill-missing", "utf8");

  const config = createDelegatedConfig(workspaceDir);
  const adapterRegistry = createDelegatedRegistry();
  const eventStore = new FileEventStore(stateRootDir);
  const app = createApp({
    stateRootDir,
    adapterRegistry,
    eventStore,
    executionRuntime: buildExecutionRuntime(eventStore, {
      managerDelegatedTasks: [
        {
          title: "Implement with missing skill",
          goal: "Use a skill that does not exist locally yet.",
          skillId: "unknown-missing-skill",
          preferredAgent: "cli-worker",
          requiredCapabilities: ["planning"],
          instructions: ["Fallback instructions should still be present after approval."],
        },
      ],
    }),
    configLoader: {
      async load(): Promise<MultiAgentConfig> {
        return config;
      },
    },
    projectMemoryStore: {
      async recall() {
        return [];
      },
      async persist() {
        return;
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "missing skill approval"])) as RunRecord;
  const waiting = (await app.entrypoint.handle(["resume", started.runId])) as RunRecord;
  assert.equal(waiting.status, "waiting_approval");

  const pending = await app.runCoordinator.listPendingApprovals(started.runId);
  assert.equal(pending.length, 1);
  assert.ok(pending[0]?.reason.includes("missing workflow skills"));

  const resumed = (await app.entrypoint.handle([
    "approve",
    started.runId,
    pending[0]!.id,
    "--actor",
    "tester",
    "--note",
    "confirm missing skill and proceed",
  ])) as RunRecord;
  assert.equal(resumed.status, "completed");

  const inspection = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  const workerTask = Object.values(inspection.graph.tasks).find(
    (candidate) =>
      candidate.kind === "execute" &&
      candidate.metadata?.skillId === "unknown-missing-skill",
  );
  assert.ok(workerTask);
  assert.equal(workerTask?.metadata?.skillSource, "missing_skill_approved");
  assert.ok(
    inspection.events.some((event) => {
      if (event.type !== "approval_requested") {
        return false;
      }
      const payload = event.payload as Record<string, unknown>;
      return payload.source === "skill_missing";
    }),
  );
});

test("realtime manager loop keeps worker running while skill-confirmation flow is resolved end-to-end", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "clibees-skill-fullchain-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const stateRootDir = path.join(workspaceDir, ".multi-agent", "state");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "seed.txt"), "skill-fullchain", "utf8");
  await writeSkillFile(workspaceDir, {
    id: "task-breakdown",
    name: "Task Breakdown",
    description: "Delegation planning baseline.",
    template: {
      instructions: ["Decompose work and execute delegated tasks."],
      expectedArtifacts: ["Delegated task output."],
      acceptanceCriteria: ["Delegated goal completed."],
      validator: { mode: "none" },
    },
  });

  const config = createDelegatedConfig(workspaceDir);
  const eventStore = new FileEventStore(stateRootDir);
  const managerTaskPrefix = "Manager dispatch:";
  const runtime = {
    async *execute(
      runId: string,
      task: TaskSpec,
      invocation: InvocationPlan,
    ): AsyncIterable<RunEvent> {
      const startedEvent: RunEvent = {
        schemaVersion: 1,
        id: `evt-start-${task.id}-${Date.now()}`,
        type: "task_started",
        runId,
        taskId: task.id,
        timestamp: "2026-03-19T10:00:00.000Z",
        payload: {
          agentId: invocation.agentId,
          command: invocation.command,
          args: invocation.args,
          cwd: invocation.cwd,
        },
      };
      await eventStore.append(startedEvent);
      yield startedEvent;

      const isManagerTask =
        task.kind === "plan" && task.requiredCapabilities.includes("delegation");
      const isInitialDispatch = isManagerTask && task.title.startsWith(managerTaskPrefix);
      const isWorkerCompletionCoordination =
        isManagerTask &&
        task.title === "Manager coordination" &&
        task.inputs.some((input) => input.includes("is completed"));
      const isUserTriggeredCoordination =
        isManagerTask &&
        task.title === "Manager coordination" &&
        !isWorkerCompletionCoordination;

      const completedPayload =
        isInitialDispatch
          ? {
              structuredOutput: {
                managerReply: "Initial worker task is dispatched.",
                managerDecision: "continue",
                delegatedTasks: [
                  {
                    title: "Initial delegated worker task",
                    goal: "Run initial delegated worker flow.",
                    skillId: "task-breakdown",
                    preferredAgent: "cli-worker",
                    requiredCapabilities: ["planning"],
                    instructions: ["Run initial delegated worker flow."],
                    expectedArtifacts: ["Initial worker output."],
                    acceptanceCriteria: ["Initial delegated worker task is complete."],
                  },
                ],
              },
            }
          : isWorkerCompletionCoordination
            ? {
                structuredOutput: {
                  managerReply: "Worker result received. No additional tasks required.",
                  managerDecision: "no_more_tasks",
                delegatedTasks: [],
              },
            }
            : isUserTriggeredCoordination
              ? {
                  structuredOutput: {
                    managerReply: "Delegating a task selected from the realtime call.",
                    managerDecision: "continue",
                    delegatedTasks: [
                      {
                        title: "Realtime delegated worker task",
                        goal: "Handle user realtime request",
                        skillId: "missing-realtime-skill",
                        preferredAgent: "cli-worker",
                        requiredCapabilities: ["planning"],
                        instructions: ["Follow the realtime user request and finish the task."],
                        expectedArtifacts: ["Realtime worker output."],
                        acceptanceCriteria: ["Realtime delegated goal is complete."],
                      },
                    ],
                  },
              }
              : {};
      if (!isManagerTask && task.title === "Initial delegated worker task") {
        await waitForMs(180);
      }

      const completedEvent: RunEvent = {
        schemaVersion: 1,
        id: `evt-complete-${task.id}-${Date.now()}`,
        type: "task_completed",
        runId,
        taskId: task.id,
        timestamp: "2026-03-19T10:00:01.000Z",
        payload: {
          agentId: invocation.agentId,
          exitCode: 0,
          ...completedPayload,
        },
      };
      await eventStore.append(completedEvent);
      yield completedEvent;
    },
    async interrupt(): Promise<void> {
      return;
    },
  };

  const app = createApp({
    stateRootDir,
    adapterRegistry: createDelegatedRegistry(),
    eventStore,
    executionRuntime: runtime,
    configLoader: {
      async load(): Promise<MultiAgentConfig> {
        return config;
      },
    },
    projectMemoryStore: {
      async recall() {
        return [];
      },
      async persist() {
        return;
      },
    },
  });

  const started = (await app.entrypoint.handle(["run", "realtime chain"])) as RunRecord;
  const managerSession = await app.runCoordinator.ensureManagerSession(started.runId);
  const resumePromise = app.entrypoint.handle(["resume", started.runId]) as Promise<RunRecord>;
  let workerIsActive = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    let graph: Awaited<ReturnType<typeof app.dependencies.runStore.getGraph>>;
    try {
      graph = await app.dependencies.runStore.getGraph(started.runId);
    } catch {
      // Graph writes are not atomic in file store tests; retry on transient read failures.
      await waitForMs(20);
      continue;
    }
    const workerTask = graph
      ? Object.values(graph.tasks).find((task) => task.title === "Initial delegated worker task")
      : undefined;
    if (
      workerTask &&
      (workerTask.status === "queued" ||
        workerTask.status === "running" ||
        workerTask.status === "validating")
    ) {
      workerIsActive = true;
      break;
    }
    await waitForMs(20);
  }
  assert.equal(workerIsActive, true);
  const postResult = await app.runCoordinator.postThreadMessage(
    started.runId,
    managerSession.thread.threadId,
    {
      actorId: "console-user",
      body: "Please continue with a new delegated task from realtime feedback.",
      clientRequestId: "fullchain-msg-1",
    },
  );
  assert.ok(
    postResult.run.status === "running" ||
      postResult.run.status === "waiting_approval",
  );
  const managerMessagesAfterPost = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  assert.ok(
    managerMessagesAfterPost.some(
      (candidate) =>
        candidate.role === "manager" &&
        candidate.metadata?.source === "manager_ack" &&
        candidate.metadata?.triggerMessageId === postResult.message.messageId,
    ),
  );
  const waiting = (await resumePromise) as RunRecord;
  assert.equal(waiting.status, "waiting_approval");

  const pending = await app.runCoordinator.listPendingApprovals(started.runId);
  assert.equal(pending.length, 1);

  const finalRun = (await app.entrypoint.handle([
    "approve",
    started.runId,
    pending[0]!.id,
    "--actor",
    "tester",
    "--note",
    "approve missing realtime skill flow",
  ])) as RunRecord;
  assert.equal(finalRun.status, "completed");

  const inspection = (await app.entrypoint.handle(["inspect", started.runId])) as RunInspection;
  const managerCoordinationTasks = Object.values(inspection.graph.tasks).filter(
    (task) => task.title === "Manager coordination",
  );
  assert.ok(managerCoordinationTasks.length >= 2);
  assert.ok(
    managerCoordinationTasks.some(
      (task) => task.metadata?.triggerMessageId === postResult.message.messageId,
    ),
  );
  const workerTask = Object.values(inspection.graph.tasks).find(
    (task) => task.metadata?.skillId === "missing-realtime-skill",
  );
  assert.ok(workerTask);
  assert.equal(workerTask?.metadata?.skillSource, "missing_skill_approved");
  assert.ok(
    inspection.events.some((event) => {
      if (event.type !== "approval_requested") {
        return false;
      }
      const payload = event.payload as Record<string, unknown>;
      return payload.source === "skill_missing";
    }),
  );
  const managerMessages = await app.dependencies.sessionStore.listMessages(
    started.runId,
    "manager_primary",
  );
  assert.ok(
    managerMessages.some(
      (message) =>
        message.role === "worker" &&
        message.body.includes("is completed. Please review"),
    ),
  );
  assert.ok(
    managerMessages.some(
      (message) =>
        message.role === "system" &&
        message.body.includes("Missing workflow skill confirmation is required"),
    ),
  );
});


