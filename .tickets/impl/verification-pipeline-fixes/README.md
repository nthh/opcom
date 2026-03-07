---
id: verification-pipeline-fixes
title: "Oracle as agent session + TUI verification rendering fixes"
status: open
type: feature
priority: 1
deps:
  - oracle-verification-gate
  - verification-retry-loop
  - tui-verification-display
  - agent-roles
links:
  - docs/spec/verification.md
  - docs/spec/roles.md
  - docs/spec/tui.md
services:
  - types
  - core
  - cli
---

# Oracle as agent session + TUI verification rendering fixes

## Problem

The oracle evaluation uses a bespoke `llmCall()` that spawns `claude -p` directly, bypassing the agent infrastructure. This causes three problems:

1. **CLI argument overflow** — the oracle prompt (50KB+ diff, spec, criteria, test results) is passed as a CLI argument, exceeding OS limits. Every oracle call crashes with `Command failed: claude -p ...`.
2. **Backend lock-in** — `llmCall()` hardcodes `claude`. Adding opencode or codex as oracle backends requires a parallel implementation.
3. **Invisible** — oracle runs aren't tracked in the event store or visible in the TUI. It's a black box.

Additionally, the TUI has rendering bugs where plan-step-focus views show stale data.

## Fix 1: Oracle as agent session

Replace `executor.llmCall()` with an agent session using the existing `SessionManager`. The oracle becomes a built-in role — read-only, no tools, evaluate-only. See updated `docs/spec/verification.md` for full design.

### Tasks

- [ ] Add `oracle` built-in role to `packages/core/src/config/roles.ts`
  - No tools (disallow Edit, Write, Bash, Read, Glob, Grep, etc.)
  - `permissionMode: "default"`
  - `runTests: false`, `runOracle: false` (oracle doesn't verify itself)
- [ ] Add `oracle` to `docs/spec/roles.md` built-in roles section
- [ ] Change `runVerification()` in `executor.ts` to start an oracle agent session:
  - Call `sessionManager.startSession()` with role `oracle`, system prompt from `formatOraclePrompt()`
  - Use `plan.config.backend` (not hardcoded `claude`)
  - Use `plan.config.verification.oracleModel` for model override
  - Listen for `session_stopped`, collect assistant text from events
  - Parse response with `parseOracleResponse()`
- [ ] Remove `executor.llmCall()` — no longer needed
- [ ] Add `oracleSessionId?: string` to `VerificationResult` type for TUI/event traceability
- [ ] Oracle agent shows in TUI agents panel while running
- [ ] Tests: mock oracle agent session, verify pass/fail/error flows

### Why this fixes the CLI overflow

The agent adapter (ClaudeCodeAdapter) passes the system prompt via its normal mechanism — stdin pipe for claude-code, HTTP body for opencode. The prompt never hits OS argument length limits.

## Fix 2: TUI plan-step-focus stale rendering (DONE)

`syncData()` never updates `planStepFocusState`. When step/verification/agent data changes, the view shows stale content.

- [x] Add `planStepFocusState` sync in `syncData()` — update step, verification, agent, rebuild display lines on change
- [x] Guard async `loadTicketContent` callback against stale state
- [x] Import `rebuildDisplayLines` from plan-step-focus view

## Fix 3: Context builder oracleError feedback (DONE)

`contextPacketToMarkdown` only checks `previousVerification.oracle` for retry feedback. When oracle errors (not fails), `oracle` is null and `oracleError` is set — agents get no feedback.

- [x] Handle `oracleError` case in context builder — render "Oracle Evaluation Failed" section

## Acceptance Criteria

- [ ] Oracle runs as an agent session through SessionManager, not via bespoke `llmCall()`
- [ ] Oracle uses the plan's configured backend (works with claude-code, opencode, future backends)
- [ ] Oracle prompt is delivered via the adapter's normal mechanism (no CLI argument overflow)
- [ ] Oracle agent appears in TUI agents panel while running
- [ ] Oracle session events are tracked in the event store
- [x] Plan-step-focus view updates in real time when step/verification/agent data changes
- [x] Retried agents receive oracle error context when oracle evaluation failed
- [ ] `executor.llmCall()` is removed
- [ ] Existing verification and oracle tests still pass
