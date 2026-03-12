# clibees Architecture

## System Summary

`clibees` is organized around a local orchestration loop:

1. Accept a goal through CLI or UI API
2. Create a run and initial task graph
3. Route work to an adapter-capable agent
4. Build context from workspace, memory, and previous artifacts
5. Gate risky actions through approvals
6. Execute, validate, and persist every important result
7. Read the same persisted state through inspect and console projections

## Architecture Overview

Static export:

![Architecture overview](assets/architecture-overview.svg)

Mermaid source:

```mermaid
flowchart LR
    User[User] --> CLI[CLI]
    User --> Console[Console UI]
    Console --> API[UI API Server]
    CLI --> Entry[Entrypoint]
    API --> Entry
    Entry --> Coord[RunCoordinator]

    Coord --> Planner[Planner]
    Coord --> Graph[Graph Manager]
    Coord --> Router[Router]
    Coord --> Context[Context Assembler]
    Coord --> Safety[Safety Manager]
    Coord --> Approval[Approval Manager]
    Coord --> Runtime[Execution Runtime]
    Coord --> Validator[Validator]
    Coord --> Memory[Project Memory Store]
    Coord --> State[Run Store]
    Coord --> Events[Event Store]
    Coord --> Artifacts[Artifact Store]
    Coord --> Blackboard[Blackboard Store]
    Coord --> Workspace[Workspace State Store]

    Runtime --> Adapters[Configured Adapters]
    Events --> Projection[UI Read Models]
    State --> Projection
    Artifacts --> Projection
    Blackboard --> Projection
    Projection --> Console
```

## Runtime Sequence

Static export:

![Runtime flow](assets/runtime-flow.svg)

Mermaid source:

```mermaid
sequenceDiagram
    participant User
    participant Surface as CLI / UI API
    participant Coordinator as RunCoordinator
    participant Planner
    participant Router as Router + Context
    participant Safety as Safety + Approval
    participant Runtime as Execution Runtime
    participant Validator
    participant Stores as State Stores

    User->>Surface: run / resume / approve / inspect
    Surface->>Coordinator: command request
    Coordinator->>Planner: createInitialPlan or replan
    Planner-->>Coordinator: tasks and graph changes
    Coordinator->>Router: select agent and build context
    Coordinator->>Safety: review invocation risk
    Safety-->>Coordinator: allow / require approval / block
    Coordinator->>Runtime: execute invocation
    Runtime-->>Coordinator: task events and outputs
    Coordinator->>Validator: validate result
    Coordinator->>Stores: persist run, graph, events, artifacts, blackboard, memory
    Stores-->>Surface: inspection and workspace views
```

## Technology Map

Static export:

![Technology map](assets/technology-map.svg)

Mermaid source:

```mermaid
flowchart TB
    subgraph Interfaces
        CLI[CLI Commands]
        API[Node UI API]
        Console[Vue 3 Console]
    end

    subgraph Runtime
        App[createApp]
        Entry[Entrypoint]
        Coord[RunCoordinator]
        Planner[Planner]
        Router[Router]
        Context[Context Assembler]
        RuntimeExec[Execution Runtime]
        Validator[Validator]
        Safety[Safety Manager]
        Approval[Approval Manager]
    end

    subgraph Storage
        RunStore[Run Store]
        EventStore[Event Store]
        ArtifactStore[Artifact Store]
        BlackboardStore[Blackboard Store]
        WorkspaceStore[Workspace State Store]
        MemoryStore[Project Memory Store]
    end

    subgraph Frontend
        ReadModels[UI Read Models]
        Vite[Vite Build]
    end

    CLI --> Entry
    API --> Entry
    Entry --> Coord
    Coord --> Planner
    Coord --> Router
    Coord --> Context
    Coord --> RuntimeExec
    Coord --> Validator
    Coord --> Safety
    Coord --> Approval
    Coord --> RunStore
    Coord --> EventStore
    Coord --> ArtifactStore
    Coord --> BlackboardStore
    Coord --> WorkspaceStore
    Coord --> MemoryStore
    ReadModels --> Console
    Vite --> Console
```

## Module Responsibilities

### Control plane

- `src/app/create-app.ts` wires the runtime dependencies
- `src/control/run-coordinator.ts` is the central orchestration loop
- `src/control/graph-manager.ts` manages task graph creation and graph patches
- `src/control/scheduler.ts` chooses the next runnable task

### Decision layer

- `src/decision/planner.ts` defines planning and replanning
- `src/decision/router.ts` selects an agent/profile
- `src/decision/context-assembler.ts` builds execution context
- `src/decision/validator.ts` validates task results

### Execution layer

- `src/execution/execution-runtime.ts` runs invocations
- `src/execution/approval-manager.ts` manages approval requests and decisions
- `src/execution/safety-manager.ts` classifies risky actions
- `src/execution/create-adapter-registry.ts` exposes agent adapters

### Read surface

- `src/cli/` provides the command-line interface
- `src/ui-api/` exposes HTTP routes for the console
- `src/ui-read-models/` converts stored state into console-facing projections
- `apps/console/` renders the workspace and inspection UI

### Persistence

- `src/storage/` stores run records, graphs, events, artifacts, approvals, blackboard summaries, workspace drift, and memory indexes
- `.multi-agent/` is the runtime state root used by the local orchestration loop

## Architectural Notes

- The repository already behaves like a real orchestration engine, not just a scripted wrapper around a single agent call.
- Many deeper freeze documents in `docs/` define the intended evolution toward richer task/session/read-model boundaries.
- Public-facing materials should distinguish between current runtime behavior and planned architecture refinements.
