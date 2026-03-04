---
id: oracle-verification-gate
title: "Executor: Oracle Verification After Step Completion"
status: closed
type: feature
priority: 2
deps:
  - executor-test-gate
links:
  - docs/spec/verification.md
services:
  - core
---

# Executor: Oracle Verification After Step Completion

## Goal

Wire the existing oracle skill into the executor's step completion flow. After tests pass, the oracle evaluates the git diff against the ticket's acceptance criteria and linked spec. This catches semantic issues — an agent that passes tests but didn't actually implement the feature.

## Tasks

- [ ] Add `VerificationResult` type to `packages/types/src/plan.ts`
  - `{ stepTicketId, testGate: TestGateResult, oracle?: OracleResult, passed, failureReasons }`
- [ ] Wire `runOracle()` into executor after test gate passes:
  - [ ] Call `collectOracleInputs()` with project path, session ID, work item
  - [ ] Feed test results into oracle input
  - [ ] If oracle fails: step.status = "failed" with per-criterion feedback
  - [ ] Store oracle result in plan_events as `step_oracle` event
- [ ] Configure LLM call provider for oracle:
  - [ ] Use `config.verification.oracleModel` or project default
  - [ ] Oracle requires an LLM endpoint — fail gracefully if not configured
- [ ] Store oracle per-criterion results in event store for analytics:
  - [ ] "Which criteria fail most often?"
  - [ ] "Average attempts per ticket before oracle passes"
- [ ] On retry: include previous oracle feedback in agent context packet
  - [ ] Executor passes `step.error` (oracle reasoning) to context builder
  - [ ] Agent sees "Previous attempt failed: [criterion X not met because Y]"
- [ ] Tests: mock oracle LLM call, verify pass/fail behavior, verify event store entries

## Acceptance Criteria

- Oracle evaluates each acceptance criterion from the ticket against the git diff
- Steps fail if any criterion is not met, with per-criterion reasoning
- Oracle results are stored in event store and queryable
- Oracle is off by default — enabled via `config.verification.runOracle`
- Retry agents receive previous oracle feedback in their context
