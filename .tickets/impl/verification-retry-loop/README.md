---
id: verification-retry-loop
title: "Verification retry loop: automatic agent retry on verification failure"
status: closed
type: feature
priority: 1
deps:
  - executor-test-gate
links:
  - docs/spec/verification.md
services:
  - types
  - core
---

# Verification retry loop: automatic agent retry on verification failure

## Goal

When verification fails after an agent completes a step, automatically retry by starting a new agent session with structured failure feedback instead of immediately failing the step. This avoids pausing the plan for every test failure and gives agents a chance to fix their mistakes.

## Tasks

- [x] Add step state fields to `PlanStep` in `packages/types/src/plan.ts`
  - [x] `attempt?: number` — current attempt (1 = first try, 2+ = retry)
  - [x] `previousVerification?: VerificationResult` — feedback from last failed attempt
- [x] Add `maxRetries` to `VerificationConfig` in `packages/types/src/plan.ts`
  - Default 2 (agent gets up to 2 chances to fix failures before hard-fail)
  - `maxRetries: 0` disables retry loop (fail immediately)
- [x] Add `maxRetries` to `OrchestratorSettings` in `packages/types/src/workspace.ts`
- [x] Add `maxRetries` default to `persistence.ts` default config
- [x] Add `orchestrator.maxRetries` to settings definitions in `packages/core/src/config/settings.ts`
- [x] Implement retry logic in `handleWorktreeCompletion` in `packages/core/src/orchestrator/executor.ts`
  - [x] After verification fails, check `attempt < maxAttempts`
  - [x] If retries remain: increment attempt, store previousVerification, reset status to "ready", clear sessionId
  - [x] Preserve worktree across retries (worktreePath/worktreeBranch stay set)
  - [x] If retries exhausted: hard fail with structured error
  - [x] Emit `step_retry` plan event for traceability
- [x] Render retry context in `contextPacketToMarkdown` in `packages/core/src/agents/context-builder.ts`
  - [x] Accept optional `previousVerification` parameter
  - [x] Render `## Previous Attempt` section with test failures (code block) and unmet oracle criteria
  - [x] Include `### What to fix` focus instructions
- [x] Tests for retry logic, context rendering, and configuration

## Acceptance Criteria

- When verification fails and retries remain, the step transitions back to "ready" with incremented attempt
- previousVerification is stored on the step for the next agent session
- When retries are exhausted, the step hard-fails with a structured error message
- maxRetries: 0 means fail immediately on first verification failure
- Worktree is preserved across retries so the agent picks up where it left off
- The retry agent's system prompt includes a "Previous Attempt" section with failure details
- step_retry events are emitted to the event store
