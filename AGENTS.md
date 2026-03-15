# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the TypeScript runtime and CLI layers: `cli/` for command entrypoints, `control/`, `decision/`, and `execution/` for orchestration, `storage/` for persisted state, and `ui-api/` plus `ui-read-models/` for console-facing data. `apps/console/` is a separate Vue 3 + Vite app with pages, components, composables, and mock data under `src/`. Runtime artifacts are written to `.multi-agent/`; treat `.multi-agent/state/` and `.multi-agent/memory/` as generated state, not source.

## Build, Test, and Development Commands
Install dependencies at the repo root with `npm install`. Use `npm run check` for strict TypeScript validation, `npm run build` to emit `dist/`, and `npm test` to build and run the phase test suite. Start the CLI with `npm run start -- run "your goal"` or inspect an existing run with `npm run start -- inspect <runId>`. For the console app, run `cd apps/console && npm install`, then `npm run dev` for local Vite development or `npm run build` for production output checks.

## Coding Style & Naming Conventions
Use TypeScript with strict typing and ES module imports that include the `.js` extension in source files compiled by `tsc`. Follow the existing style: 2-space indentation, double quotes, trailing commas where multiline, and `camelCase` for functions/variables with `PascalCase` for classes, Vue components, and TypeScript types. Keep file names descriptive and aligned with the domain, such as `run-coordinator.ts` or `WorkspacePage.vue`.

## Testing Guidelines
Tests live beside implementation files as `*.test.ts`, for example `src/control/phase7.test.ts`. The root suite uses compiled Node-based tests rather than a separate runner, so always run `npm test` from the repo root before submitting changes. Add focused regression coverage for new control-flow, storage, or execution behavior; for console-only changes, at minimum run `cd apps/console && npm run build`.

## Commit & Pull Request Guidelines
Current history uses Conventional Commit style (`chore: initial commit`); continue with concise imperative subjects such as `feat: add approval summary output` or `fix: persist graph updates on resume`. Keep commits scoped to one logical change. Pull requests should describe the behavior change, list validation commands run, link the relevant issue or task, and include screenshots for `apps/console/` UI changes.

## Configuration & State Tips
Local agent configuration lives in `.multi-agent.yaml`. Default workspace writes stay inside the repository, so avoid hard-coding absolute paths and do not commit generated `dist/`, `node_modules/`, or `.multi-agent/state/` contents.
