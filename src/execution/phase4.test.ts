import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { AgentConfig } from "../domain/config.js";
import type {
  AgentCapability,
  ContextBundle,
  InvocationPlan,
  RunEvent,
  TaskSpec,
} from "../domain/models.js";
import type { AgentSelection } from "../decision/router.js";
import type { AgentAdapter } from "./agent-adapter.js";
import { AdapterRegistry } from "./adapter-registry.js";
import { ConfiguredCliAdapter } from "../adapters/configured-cli-adapter.js";

function buildTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "task-phase4",
    title: "Phase 4 task",
    kind: "execute",
    goal: "Exercise the configured CLI adapter",
    instructions: ["Print the prompt", "Exit cleanly"],
    inputs: [],
    dependsOn: [],
    requiredCapabilities: ["planning"],
    workingDirectory: process.cwd(),
    expectedArtifacts: [],
    acceptanceCriteria: ["Prompt emitted to stdout"],
    validator: { mode: "none" },
    riskLevel: "low",
    allowedActions: [],
    timeoutMs: 60_000,
    retryPolicy: {
      maxAttempts: 1,
      backoffMs: 0,
      retryOn: [],
    },
    status: "ready",
    ...overrides,
  };
}

function buildContext(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    taskBrief: "Need a prompt for a configured CLI.",
    relevantFacts: ["Fact A"],
    relevantDecisions: ["Decision B"],
    artifactSummaries: ["Artifact C"],
    workspaceSummary: "Workspace summary",
    transcriptRefs: ["transcript-1"],
    agentHints: ["hint-1"],
    ...overrides,
  };
}

function buildSelection(overrides: Partial<AgentSelection> = {}): AgentSelection {
  return {
    agentId: "node-agent",
    profileId: "default",
    reason: "default profile",
    ...overrides,
  };
}

class FakeAdapter implements AgentAdapter {
  private probeCount = 0;

  constructor(
    public readonly agentId: string,
    private readonly capability: AgentCapability,
    private readonly shouldFail = false,
  ) {}

  async probe(): Promise<AgentCapability> {
    this.probeCount += 1;

    if (this.shouldFail) {
      throw new Error(`Adapter ${this.agentId} unavailable`);
    }

    return this.capability;
  }

  async planInvocation(): Promise<InvocationPlan> {
    throw new Error("Not implemented.");
  }

  async *run(): AsyncIterable<RunEvent> {
    return;
  }

  async interrupt(): Promise<void> {
    return Promise.resolve();
  }

  getProbes(): number {
    return this.probeCount;
  }
}

function createFakeChildProcess(
  onStart: (child: ChildProcess & { stdout: PassThrough; stderr: PassThrough }) => void,
): typeof import("node:child_process").spawn {
  return (() => {
    const child = new EventEmitter() as ChildProcess & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      killed: boolean;
    };

    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      child.signalCode = "SIGTERM";
      queueMicrotask(() => child.emit("close", null, "SIGTERM"));
      return true;
    };

    queueMicrotask(() => onStart(child));
    return child;
  }) as typeof import("node:child_process").spawn;
}

test("AdapterRegistry caches probe results and filters available agents", async () => {
  const registry = new AdapterRegistry();
  const codingAdapter = new FakeAdapter("coding", {
    agentId: "coding",
    supportsNonInteractive: true,
    supportsStructuredOutput: false,
    supportsCwd: true,
    supportsAutoApproveFlags: false,
    supportsStreaming: true,
    supportsActionPlanning: true,
    supportsResume: false,
    supportedCapabilities: ["planning", "editing"],
    defaultProfileId: "default",
  });
  const failingAdapter = new FakeAdapter(
    "missing",
    {
      agentId: "missing",
      supportsNonInteractive: true,
      supportsStructuredOutput: false,
      supportsCwd: true,
      supportsAutoApproveFlags: false,
      supportsStreaming: true,
      supportsActionPlanning: true,
      supportsResume: false,
      supportedCapabilities: ["planning"],
      defaultProfileId: "default",
    },
    true,
  );

  registry.register(codingAdapter);
  registry.register(failingAdapter);

  const firstProbe = await registry.probeAll();
  const secondProbe = await registry.probeAll();
  const available = await registry.getAvailableAgents(["editing"]);

  assert.equal(firstProbe[0]?.cached, false);
  assert.equal(secondProbe[0]?.cached, true);
  assert.equal(codingAdapter.getProbes(), 1);
  assert.equal(failingAdapter.getProbes(), 1);
  assert.equal(firstProbe[1]?.available, false);
  assert.match(firstProbe[1]?.error ?? "", /unavailable/);
  assert.deepEqual(available.map((entry) => entry.agentId), ["coding"]);
});

test("ConfiguredCliAdapter planInvocation maps profile args and prompt", async () => {
  const agent: AgentConfig = {
    id: "node-agent",
    command: "node",
    priority: 1,
    profiles: [
      {
        id: "default",
        label: "Default",
        capabilities: ["planning", "editing"],
        defaultArgs: ["-e", "process.stdout.write(process.argv[1] ?? '')"],
        defaultCwd: process.cwd(),
        costTier: "low",
      },
    ],
  };
  const adapter = new ConfiguredCliAdapter(agent);
  const invocation = await adapter.planInvocation(
    buildTask(),
    buildContext(),
    buildSelection(),
  );

  assert.equal(invocation.command, "node");
  assert.deepEqual(invocation.args.slice(0, 2), [
    "-e",
    "process.stdout.write(process.argv[1] ?? '')",
  ]);
  assert.match(invocation.args.at(-1) ?? "", /Task: Phase 4 task/);
  assert.match(invocation.args.at(-1) ?? "", /Relevant Facts:/);
  assert.equal(invocation.actionPlans[0]?.command, "node");
  assert.deepEqual(invocation.actionPlans[0]?.args, invocation.args);
});

test("ConfiguredCliAdapter probe and run emit unified events", async () => {
  const agent: AgentConfig = {
    id: "node-agent",
    command: "node",
    profiles: [
      {
        id: "default",
        label: "Default",
        capabilities: ["planning"],
        defaultArgs: [
          "-e",
          [
            "const prompt = process.argv[1] ?? '';",
            "process.stdout.write(`OUT:${prompt}\\n`);",
            "process.stderr.write('ERR:side-channel\\n');",
          ].join(" "),
        ],
        defaultCwd: process.cwd(),
        costTier: "low",
      },
    ],
  };
  const adapter = new ConfiguredCliAdapter(agent, {
    spawnProcess: createFakeChildProcess((child) => {
      child.stdout.write("OUT:Task: Phase 4 task\n");
      child.stderr.write("ERR:side-channel\n");
      Object.defineProperty(child, "exitCode", {
        value: 0,
        writable: true,
        configurable: true,
      });
      child.emit("close", 0, null);
    }),
  });
  const capability = await adapter.probe();
  const invocation = await adapter.planInvocation(
    buildTask(),
    buildContext(),
    buildSelection(),
  );
  const events: RunEvent[] = [];

  for await (const event of adapter.run("run-phase4", invocation)) {
    events.push(event);
  }

  assert.equal(capability.agentId, "node-agent");
  assert.deepEqual(
    events.map((event) => event.type),
    ["task_started", "agent_message", "agent_message", "task_completed"],
  );
  assert.match(String(events[1]?.payload["message"]), /OUT:Task: Phase 4 task/);
  assert.match(String(events[2]?.payload["message"]), /ERR:side-channel/);
});

test("ConfiguredCliAdapter interrupt stops an in-flight process", async () => {
  const agent: AgentConfig = {
    id: "node-agent",
    command: "node",
    profiles: [
      {
        id: "default",
        label: "Default",
        capabilities: ["planning"],
        defaultArgs: [
          "-e",
          [
            "process.stdout.write('boot\\n');",
            "setInterval(() => process.stdout.write('tick\\n'), 50);",
          ].join(" "),
        ],
        defaultCwd: process.cwd(),
        costTier: "low",
      },
    ],
  };
  const adapter = new ConfiguredCliAdapter(agent, {
    spawnProcess: createFakeChildProcess((child) => {
      child.stdout.write("boot\n");
    }),
  });
  const invocation = await adapter.planInvocation(
    buildTask(),
    buildContext(),
    buildSelection(),
  );
  const iterator = adapter.run("run-phase4-interrupt", invocation)[Symbol.asyncIterator]();
  const seen: RunEvent[] = [];

  const first = await iterator.next();
  if (!first.done) {
    seen.push(first.value);
  }

  const second = await iterator.next();
  if (!second.done) {
    seen.push(second.value);
  }

  await adapter.interrupt("run-phase4-interrupt", invocation.taskId);

  while (true) {
    const next = await iterator.next();
    if (next.done) {
      break;
    }

    seen.push(next.value);
  }

  assert.equal(seen[0]?.type, "task_started");
  assert.equal(seen[1]?.type, "agent_message");
  assert.equal(seen.at(-1)?.type, "task_failed");
});
