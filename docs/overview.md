# clibees Overview

## One-Line Positioning

`clibees` is a local-first multi-agent orchestration engine for repository work, designed to make terminal-native agent workflows inspectable, resumable, and governable.

`clibees` 是一个面向代码仓库工作的本地优先多代理编排引擎，目标是让终端型代理流程具备可检查、可恢复、可治理的运行能力。

## What Problem It Solves

Most agent workflows break down in the same places:

- execution is hidden inside an opaque session
- risky operations are hard to approve cleanly
- state disappears between steps
- debugging a failed run requires reconstructing history by hand
- a UI often exists separately from the real runtime truth

`clibees` addresses that by making the run itself the durable unit of orchestration. A run has a graph, statuses, events, artifacts, approvals, blackboard summaries, and inspection endpoints.

## Core Product Idea

The project combines three concerns that are often split apart:

1. A terminal-facing orchestration runtime
2. A local persistence model under `.multi-agent/`
3. A console UI and UI API that read the same state

That gives the project two useful properties:

- it stays close to the repository and local tools
- it exposes enough structure to support approvals, resume flows, inspection, and future coordination features

## Current Capabilities

Today the repository already supports:

- creating and resuming runs
- graph-based task planning
- rule-based agent routing
- context assembly from memory, artifacts, and workspace state
- approval requests and approval decisions
- invocation execution through adapters
- validation outcomes and replanning paths
- read models for runs, approvals, inspection, and workspace views

## What It Is Not

To keep the public description accurate, `clibees` should not be presented as:

- a cloud-hosted agent platform
- a generic workflow SaaS
- a fully finished collaborative IDE
- a complete multi-session control system already shipped end to end

Several deeper architecture contracts already exist in `docs/`, but some of them document the intended next structure rather than the fully released behavior.

## Recommended Reader Path

- Start with the [README](../README.md) for positioning and quick start
- Continue to [architecture.md](architecture.md) for module roles, data flow, and diagrams
- Use the freeze documents when you need repository-internal design truth
