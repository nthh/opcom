---
id: executor-allowed-bash
title: "Executor: Stack-Derived Allowed Bash Commands for Agents"
status: done
type: feature
priority: 1
deps:
  - orchestrator-executor
services:
  - core
  - types
---

# Executor: Stack-Derived Allowed Bash Commands for Agents

## Problem

The executor starts agents with `permissionMode: "acceptEdits"`, which auto-approves file edits but blocks **all** Bash commands. Agents running headlessly stall forever waiting for approval on `npm test`, `npm run build`, etc.

## Solution

Derive safe Bash patterns from the project's detected stack (`StackInfo`, `TestingConfig`, `LintConfig[]`) and pass them via `allowedTools: ["Bash(pattern)"]` in `AgentStartConfig` so agents can build and test autonomously without `bypassPermissions`.

## Changes

1. **`packages/types/src/plan.ts`** — Add optional `allowedBashPatterns?: string[]` to `OrchestratorConfig` for user overrides
2. **`packages/core/src/agents/allowed-bash.ts`** (new) — Pure `deriveAllowedBashTools()` function that maps stack → `Bash(pattern)` strings
3. **`packages/core/src/orchestrator/executor.ts`** — Call `deriveAllowedBashTools()` in `startStep()` and pass result to session config
4. **`packages/core/src/index.ts`** — Export new module
5. **`tests/agents/allowed-bash.test.ts`** (new) — Unit tests for derivation logic
6. **`tests/orchestrator/executor.test.ts`** — Integration test verifying allowedTools passthrough

## Derivation Rules

- **Always safe:** git read-only, ls, cat, head, tail, find, wc
- **Package managers** (npm, pnpm, yarn, bun, pip, poetry, uv) → test/run/install patterns
- **Languages** (go, rust, ruby, java) → build/test tool patterns
- **Testing config** → explicit test command
- **Linting config** → linter-specific commands (eslint, prettier, biome, ruff, etc.)
- **User extras** from `OrchestratorConfig.allowedBashPatterns`
