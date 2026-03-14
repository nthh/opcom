---
id: unified-init-pipeline
title: "Unified init pipeline: single flow with mode-driven behavior"
status: closed
type: refactor
priority: 2
deps: [dev-command-detection]
links: [docs/spec/config.md#init-pipeline]
---

## Goal

Refactor the 6 divergent init flows (`welcome`, `setup`, `init`, `initFolder`, `add`, `autoSetup`) into a single unified pipeline with mode-driven behavior (interactive vs agent). Extract shared logic into reusable helpers and reduce each existing entry point to a thin wrapper over the pipeline.

## Tasks

- [ ] Audit all 6 init flows and catalog shared vs divergent behavior
- [ ] Extract shared helpers: `resolvePath`, `addToWorkspace`, `configureProject`, `devStartup`
- [ ] Build unified `initPipeline(options)` that accepts a mode (`interactive` | `agent`) and delegates to shared helpers
- [ ] Convert `welcome` to thin wrapper over `initPipeline`
- [ ] Convert `setup` to thin wrapper over `initPipeline`
- [ ] Convert `init` to thin wrapper over `initPipeline`
- [ ] Convert `initFolder` to thin wrapper over `initPipeline`
- [ ] Convert `add` to thin wrapper over `initPipeline`
- [ ] Convert `autoSetup` to thin wrapper over `initPipeline`
- [ ] Add tests for the unified pipeline covering both interactive and agent modes
- [ ] Verify existing tests still pass after refactor

## Acceptance Criteria

- All 6 entry points produce identical outcomes to their current behavior
- Shared helpers are independently testable
- Adding a new init mode requires only a thin wrapper, not duplicating flow logic
- Agent-mode init works without interactive prompts
- Config spec init-pipeline section is linked and consistent with implementation
