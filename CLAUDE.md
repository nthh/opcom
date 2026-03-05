# opcom — Agent Constitution

## What is opcom?

opcom is a developer workspace manager. You start it up, it detects your projects, reads your tickets, and gives you a dashboard of what needs doing. You point agents at work items, opcom gives them full context (stack, spec, ticket), and you watch from the TUI.

Two control planes: project (what needs doing?) + agent (who's doing it?).

## Architecture

- **packages/types/** — Pure type definitions, zero runtime deps
- **packages/core/** — Runtime logic: config persistence, project detection, ticket scanning, status
- **packages/cli/** — Command-line interface using core
- **packages/context-graph/** — Queryable knowledge graph of codebases (SQLite, pluggable analyzers)
- **docs/spec/** — Specifications for detection, config, adapters, server API, TUI, normalized events, context-graph

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

## Current State

Phase 1 complete (44 tests, clean build). Phases 2-8 built (876 tests passing). context-graph Phase 1 complete (8 tests). See docs/ROADMAP.md for what's next.

## Commands

- `npm test` — run all tests (44 passing)
- `npm run build` — build all packages
- `npx opcom status` — show workspace dashboard
- `npx opcom add <path>` — add a project
- `npx opcom scan [project]` — re-detect one or all projects
- `npx opcom init` — interactive workspace setup
