# opcom — Agent Constitution

> This file is the canonical agent constitution. It is agent-agnostic — all coding agents (Claude Code, Cursor, Copilot, etc.) should read this file. Claude Code auto-loads it via a stub `CLAUDE.md`.

## What is opcom?

opcom is a developer workspace manager. You start it up, it detects your projects, reads your tickets, and gives you a dashboard of what needs doing. You point agents at work items, opcom gives them full context (stack, spec, ticket), and you watch from the TUI.

Two control planes: project (what needs doing?) + agent (who's doing it?).

## Architecture

- **packages/types/** — Pure type definitions, zero runtime deps
- **packages/core/** — Runtime logic: config persistence, project detection, ticket scanning, status
- **packages/cli/** — Command-line interface using core
- **packages/context-graph/** — Queryable knowledge graph of codebases (SQLite, pluggable analyzers)
- **docs/spec/** — Specifications for detection, config, adapters, server API, TUI, normalized events, context-graph

## Development Process

opcom follows spec-driven development (see `docs/adr/004-specs-as-contracts.md`). The layers:

```
docs/VISION.md          — vision & principles
docs/spec/*.md          — specs (contracts agents implement against)
docs/use-cases/*.md     — use cases (cross-cutting scenarios with readiness tracking)
.tickets/impl/          — tasks (linked to spec sections)
docs/adr/               — decision records (why, not what)
tests/                  — tests (source of truth: tests > code > docs)
```

**Rules:**
- **Specs before tickets.** Every implementation ticket must link to a spec section. If no spec section exists, write it first. Tickets describe *what to build*; specs describe *how it should work*.
- **Tickets before code.** Do not write implementation code without a ticket. The flow is always: spec → ticket → code + tests. If asked to implement something, create the ticket first (in `.tickets/impl/`), then implement against it. Use the Context Packet format from `.tickets/TEMPLATE.md` — every non-trivial ticket must have Goal, Non-Goals, Constraints, Repo Anchors, and Oracle (Done When). Task lines in `## Tasks` default to **parallel** — add `(deps: task-id)` for tasks that build on each other, otherwise agents will conflict in the shared worktree.
- **Specs evolve with implementation.** Update specs during implementation, not just before. A spec that doesn't match the code is a bug.
- **Use cases are cross-cutting.** They span multiple specs/features and track readiness (what's implemented vs. what's missing). Use them to answer "can a user actually do X end-to-end?"

## Conventions

- TypeScript strict mode, ES2022 target, Node16 module resolution
- Pure ESM (type: "module" in all packages)
- Tests use vitest, co-located or in tests/
- Config files stored as YAML in ~/.opcom/
- Detection is code-based pattern matching, three-tier: manifests → version files → source globs. No LLM calls.
- All paths stored as absolute in configs

## Key Types

- `ProjectConfig` — central type describing a detected project
- `StackInfo` — languages, frameworks, package managers, infra, version managers
- `WorkItem` — normalized ticket/task from any work system (.tickets/, trk, GitHub)
- `DetectionResult` — output of scanning a project directory with evidence trail
- `AgentSession` — running agent linked to a project and optional work item (Phase 2 stub)

## Runtime State

opcom uses `~/.opcom/` for all persistent state:

```
~/.opcom/
├── config.yaml              # Global preferences
├── events.db                # SQLite event store (better-sqlite3) — agent sessions, events, changesets
├── workspaces/
│   └── <id>.yaml            # Workspace definitions
├── projects/
│   └── <id>.yaml            # Cached detection + user overrides
├── plans/
│   ├── <id>.yaml            # Plan definition + step/stage status
│   └── <id>.context.md      # Accumulated context from planning sessions
├── sessions/
│   └── <id>.yaml            # Agent session metadata
├── teams/
│   └── <id>.yaml            # Custom team definitions
└── skills/
    └── <id>/SKILL.md        # Custom skill packages
```

The **event store** (`events.db`) is the persistence layer for agent sessions, normalized events, tool usage stats, and changesets. It uses `better-sqlite3` (native addon, loaded via `createRequire` for ESM compat). Key tables: `sessions`, `events`, `changesets`. See `packages/core/src/agents/event-store.ts`.

## Current State

2655 tests passing across 87+ test files. See docs/ROADMAP.md for what's next.

## Testing

- `npx vitest run tests/path/to/specific.test.ts` — run a specific test file
- `npx vitest run tests/orchestrator/` — run tests in a directory
- Do NOT run the full test suite (`npm test`, `npx vitest run` without args). The verification pipeline runs it automatically after you finish. Running it yourself wastes time and blocks the worktree.

## Agent Setup

Agents can set up opcom non-interactively. Running `npx opcom` from a non-TTY (or with `--auto`) will auto-detect the project and print available commands:

```
npx opcom                        # auto-setup cwd + print command guide
npx opcom init --auto            # explicit auto-setup
npx opcom init --auto <path>     # auto-setup a specific project
npx opcom add <path> --auto      # add another project non-interactively
```

After setup, seed work and hand off to the user:

1. Create tickets: `opcom ticket create <project> "<description>"`
2. Create a plan: `opcom plan create`
3. Execute work: `opcom work <project>/<ticket>`
4. Tell user to run `opcom` for the interactive dashboard

Users running `opcom` from a TTY get the interactive welcome (first run) or TUI (subsequent runs).

## Commands

- `npm run build` — build all packages
- `npx opcom status` — show workspace dashboard
- `npx opcom add <path>` — add a project
- `npx opcom scan [project]` — re-detect one or all projects
- `npx opcom init` — interactive workspace setup
- `npx opcom ticket list [project]` — list tickets
- `npx opcom ticket create <project> "<desc>"` — create a ticket
- `npx opcom plan create` — create execution plan from tickets
- `npx opcom plan execute [id]` — execute a plan
- `npx opcom work <project>/<ticket>` — start agent on a ticket
