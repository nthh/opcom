---
id: dev-command-detection
title: "Detect dev/start/serve commands from build systems"
status: closed
type: feature
priority: 3
deps:
  - profile-detection
links:
  - docs/spec/detection.md#build-system-parsing
  - docs/spec/config.md#init-pipeline
---

## Goal

Extend profile detection to find dev/start/serve targets from build systems (package.json scripts, Makefile, justfile, taskfile.yml) and map them to `profile.commands.dev`. This gives opcom awareness of how to start a project's dev environment, enabling the interactive dev command prompt during init and the agent guide output during auto-setup.

## Context

The detection spec's [Build System Parsing](docs/spec/detection.md#build-system-parsing) section defines the matching rule:

> `dev` or `dev:start` or `start` or `serve` → `profile.commands.dev`

The [Init Pipeline](docs/spec/config.md#init-pipeline) spec defines how the detected dev command integrates with interactive confirmation and agent guide output. The `profile-detection` ticket implemented the profile detection framework and other command types (test, build, deploy, lint) — this ticket adds the dev command detection path.

## Tasks

- [ ] Parse `dev`, `dev:start`, `start`, `serve` targets from `package.json` scripts (e.g., `npm run dev`, `npm start`)
- [ ] Parse `dev`, `start`, `serve` targets from `Makefile` (regex `^target-name:`)
- [ ] Parse `dev`, `start`, `serve` recipes from `justfile` (regex for recipe names)
- [ ] Parse `dev`, `start`, `serve` tasks from `taskfile.yml` (YAML parse `tasks` keys)
- [ ] Apply build system priority when multiple candidates exist (Makefile > package.json scripts, per spec)
- [ ] Construct the full runnable command (e.g., `make dev`, `npm run dev`, `just dev`, `task dev`)
- [ ] Write detected command to `profile.commands.dev` in the project config
- [ ] Add unit tests for dev command detection from each build system type
- [ ] Add unit tests for priority resolution when multiple build systems have dev targets

## Acceptance Criteria

- Running detection on a project with `"dev": "vite"` in package.json scripts produces `profile.commands.dev = "npm run dev"` (or pnpm/yarn equivalent based on detected package manager)
- Running detection on a project with a `dev:` target in Makefile produces `profile.commands.dev = "make dev"`
- When both Makefile and package.json have dev targets, Makefile wins per the build system priority rule
- `justfile` recipes and `taskfile.yml` tasks with dev/start/serve names are detected
- Dev command appears in the interactive profile confirmation prompt and in the agent guide output
- All new detection paths have unit test coverage
