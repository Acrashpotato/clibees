# Projection Split Freeze

## Scope

This document freezes task 10 only: split the current `RunInspection`-centric read path into independent page projections and define `RunInspection` as a transitional aggregate. It does not yet freeze the full field-level schemas for tasks 11 to 17, and it does not define the final REST routes or pagination rules from task 18.

## Current Problem

The current repository still routes multiple console pages through a single aggregate object:

- `src/control/inspection-aggregator.ts` builds `RunInspection`
- `src/ui-read-models/build-views.ts` derives run list, workspace, and approval queue views from the same `RunInspection`
- `GET /api/runs/:runId/inspect` returns the raw aggregate directly

This has three structural problems:

1. Page coupling: a field added for one page tends to leak into other pages because `RunInspection` becomes the shared dependency.
2. Mixed ownership: `run`, `task graph`, `approval`, `validation`, `artifact`, and audit concerns are all flattened into one object, so primary responsibility is unclear.
3. Migration blockage: `taskSession`, `threadId`, `sessionMessage`, and approval snapshots cannot be introduced cleanly while pages continue to consume a monolithic inspection object.

## Freeze Decisions

### 1. Page projections are split by page responsibility

The long-term page model is frozen as seven independent projections:

| Projection | Primary page | Primary entity | Primary status source | Required joins | Must not own |
| --- | --- | --- | --- | --- | --- |
| `runListProjection` | Runs | `run` | `run.status` | aggregated counts from task/session/approval | task-level drilldown payloads |
| `workspaceProjection` | Workspace | `run` with focused `task` / `taskSession` | `run.status` plus focus selectors | focus task/session, action queue, dependency summary, risk summary, message summary | full task board, full session transcript, full audit history |
| `taskBoardProjection` | Task Board | `task graph` | task graph plus task aggregate state | task dependencies, active session summary, retry/requeue summary | run-wide summaries unrelated to the board |
| `taskDetailProjection` | Task Detail | `task` | `task.status` | upstream/downstream tasks, session set, latest approval, validation, artifacts | unrelated sibling task details |
| `sessionDetailProjection` | Session Detail | `taskSession` | `taskSession.status` | message threads, tool calls, approvals, validation, artifacts, terminal preview | whole-run workspace summaries |
| `approvalQueueProjection` | Approvals | `approvalRequest` | approval request state | `runId`, `taskId`, `sessionId`, `actionPlans` snapshot, actor, decision | task/session transcript bodies outside approval context |
| `auditTimelineProjection` | Inspect | audit timeline for a `run` | append-only audit/event timeline | validation records, approval history, artifacts, replans, key session events | workspace control state or focus heuristics |

### 2. Each page gets one primary projection

Each console page must depend on exactly one primary projection. Supplemental UI fragments may join derived helpers, but the page contract itself must not be assembled from multiple top-level page projections.

Frozen mapping:

- Runs -> `runListProjection`
- Workspace -> `workspaceProjection`
- Task Board -> `taskBoardProjection`
- Task Detail -> `taskDetailProjection`
- Session Detail -> `sessionDetailProjection`
- Approvals -> `approvalQueueProjection`
- Inspect -> `auditTimelineProjection`

### 3. `RunInspection` is transitional only

`RunInspection` is frozen as a transitional aggregate object with the following limits:

- It may continue to exist as an internal compatibility snapshot while the dedicated projections are introduced.
- It may continue to back the legacy `inspect` endpoint during the transition.
- It may be used as temporary source material for projection builders during tasks 11 to 17.
- It is not the long-term page contract for any page.
- No new page-specific fields may be added to `RunInspection` unless they are required for the migration of more than one projection and cannot yet be sourced elsewhere.
- New entities such as `taskSession`, `messageThread`, `sessionMessage`, or approval `actionPlans` snapshots must be modeled in their own projection inputs instead of being hidden inside `RunInspection`-only ad hoc fields.

### 4. Projection ownership is aligned to the domain baseline

The projection split must follow the already-frozen entity semantics:

- `runListProjection` and `workspaceProjection` are run-oriented.
- `taskBoardProjection` is graph-oriented.
- `taskDetailProjection` is task-oriented.
- `sessionDetailProjection` is task-session-oriented.
- `approvalQueueProjection` is approval-oriented and must key approvals by `approvalRequest`.
- `auditTimelineProjection` is audit-oriented and consumes append-only facts plus stable references.

This means later tasks are not allowed to reintroduce `lane` as a real entity in projection naming, routing, or source ownership.

### 5. Transitional builders may still read from `RunInspection`, but only as adapters

Until dedicated projection builders exist, transitional adapters may convert `RunInspection` into page-specific shapes. The current repository already does this partially:

- `buildRunListItemView(inspection)` is a transitional adapter for the future run list projection.
- `buildWorkspaceView(inspection)` is a transitional adapter for the future workspace projection.
- `buildApprovalQueue(inspection)` is a transitional adapter for the future approvals projection.

These adapters are compatibility scaffolding, not proof that `RunInspection` remains the canonical read model.

## Repository Impact

Task 10 freezes the target layout for projection code:

- `src/ui-read-models/projection-contracts.ts`: shared projection taxonomy and transition metadata
- future builder split:
  - `build-run-list-projection.ts`
  - `build-workspace-projection.ts`
  - `build-task-board-projection.ts`
  - `build-task-detail-projection.ts`
  - `build-session-detail-projection.ts`
  - `build-approval-queue-projection.ts`
  - `build-audit-timeline-projection.ts`

The existing `src/ui-read-models/build-views.ts` remains transitional and may be incrementally decomposed, but it must stop growing into the permanent home for every page contract.

## Migration Rules

1. Tasks 11 to 17 must define one projection at a time and bind it to exactly one page.
2. Task 18 must expose those projections as explicit read-model endpoints instead of continuing to overload `/inspect`.
3. Task 20 must split backend aggregation logic so `inspection-aggregator` no longer acts as the shared assembler for every page.
4. Task 21 and later UI refactors must consume the dedicated projections and remove `lane`-based view terminology.

## Frozen Non-Goals

Task 10 does not yet define:

- exact field names for each projection payload
- final storage indexes or materialized-view persistence strategy
- pagination and cursor semantics
- console route renames
- task/session selection heuristics inside the workspace projection
- exact session-detail message grouping behavior

Those belong to tasks 11 through 18 and must remain consistent with this ownership split.
