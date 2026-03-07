---
id: oracle-agent-session
title: "Oracle evaluation as agent session instead of bespoke llmCall"
status: closed
type: feature
priority: 1
deps:
  - oracle-verification-gate
  - agent-roles
links:
  - docs/spec/verification.md
  - docs/spec/roles.md
services:
  - types
  - core
---

# Oracle evaluation as agent session instead of bespoke llmCall

## Problem

The executor's oracle evaluation uses a private `llmCall()` that spawns `claude -p` directly with the prompt as a CLI argument. This:

1. Overflows OS argument limits — prompt includes 50KB+ git diff, spec, criteria, test results
2. Hardcodes `claude` — can't use opencode, codex, or other backends
3. Is invisible — no event tracking, not in TUI, no session management
4. Duplicates infrastructure — env stripping, timeout handling, process management already exist in the agent adapters

## Solution

Replace `llmCall()` with an agent session using the existing `SessionManager` and a new `oracle` built-in role. The oracle prompt becomes the agent's system prompt. The agent responds with its evaluation and exits. The executor collects the response text from the event stream and parses it.

## Tasks

- [x] Add `oracle` built-in role to `BUILTIN_ROLES` in `packages/core/src/config/roles.ts`
- [x] Update `docs/spec/roles.md` with oracle role documentation
- [x] Add `oracleSessionId?: string` to `VerificationResult` in `packages/types/src/plan.ts`
- [x] Rewrite oracle section of `runVerification()` in executor.ts:
  - Start oracle agent via `sessionManager.startSession()` with oracle role
  - Pass formatted oracle prompt as `systemPrompt` in config
  - Use `plan.config.backend` and optional `oracleModel`
  - Wait for session to stop (listen for session_stopped event)
  - Collect assistant text from event stream
  - Parse with `parseOracleResponse()`
  - Store `oracleSessionId` on result
- [x] Remove `llmCall()` from executor
- [x] Tests

## Acceptance Criteria

- [x] Oracle runs as an agent session through SessionManager
- [x] Oracle uses the plan's configured backend
- [x] Oracle prompt delivered via adapter (no CLI argument overflow)
- [x] `executor.llmCall()` is removed
- [x] Oracle session ID stored on VerificationResult
- [x] Existing oracle and verification tests pass
