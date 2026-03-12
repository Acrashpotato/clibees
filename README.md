# clibees

Repository: https://github.com/Acrashpotato/clibees.git

Minimal local workflow for the v1 multi-agent CLI and console workspace.

## Prerequisites

- Node.js 22+
- npm

## Install and verify

```bash
npm install
npm run check
npm run build
npm test
```

To work on the console app:

```bash
cd apps/console
npm install
npm run build
```

## CLI commands

Use the default config in `.multi-agent.yaml`, or pass `--config <path>`.

```bash
npm run start -- run "your goal"
npm run start -- resume <runId>
npm run start -- inspect <runId>
npm run start -- approvals <runId>
npm run start -- approve <runId> <requestId> --actor <name> --note "optional note"
npm run start -- reject <runId> <requestId> --actor <name> --note "optional note"
```

## State layout

Runtime state is written under `.multi-agent/`.

- `.multi-agent/state/runs/<runId>/run.json`: run metadata
- `.multi-agent/state/runs/<runId>/graph.json`: persisted task graph
- `.multi-agent/state/runs/<runId>/events.jsonl`: raw run events
- `.multi-agent/state/runs/<runId>/artifacts/`: archived artifacts
- `.multi-agent/state/runs/<runId>/blackboard/`: projected summaries
- `.multi-agent/state/runs/<runId>/approvals.json`: approval requests and decisions
- `.multi-agent/memory/records.jsonl`: project memory history
- `.multi-agent/memory/index.json`: project memory scope/tag index

## Workspace layout

- `src/`: CLI, runtime, orchestration, and storage modules
- `apps/console/`: Vue console UI
- `.multi-agent.yaml`: local agent/workspace configuration

## Debug notes

- `multi-agent inspect <runId>` now returns aggregated JSON with timeline, artifacts, approvals, validation, blackboard summaries, and run-level summary fields.
- If `resume` returns `paused`, inspect the latest `workspace_drift_detected` event before continuing.
- Approval-heavy flows are covered by `src/control/phase7.test.ts`, `src/control/phase9.test.ts`, and `src/control/phase10.test.ts`.
