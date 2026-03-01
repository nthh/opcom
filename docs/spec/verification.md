# Verification Specification

## Overview

When an agent completes a step, opcom needs to answer: "Did this actually work?" Today the executor checks write counts — a proxy that proved unreliable (agents writing the same file 5 times in a permission loop counted as "5 writes"). This spec defines a proper verification pipeline that runs after every step completion.

## Core Insight

**Verification is a pipeline, not a single check.** Different signals have different costs and confidence levels. Run cheap checks first, expensive checks only if cheap ones pass.

## Pipeline

```
Agent exits
    ↓
1. Test gate: run project tests → FAIL = step failed
    ↓
2. Oracle evaluation: LLM checks diff against acceptance criteria → FAIL = step failed
    ↓
3. Store results in event store
    ↓
4. Mark step done (or failed with structured feedback)
```

### Stage 1: Test Gate

After agent exit and auto-commit, run the project's test command:

```typescript
interface TestGateResult {
  passed: boolean;
  testCommand: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  output: string;              // last 200 lines of test output
  durationMs: number;
}
```

Run `project.testing.command` (or `npm test` fallback) in the project directory. Parse exit code — 0 is pass, anything else is fail. Capture output for oracle consumption and event store.

If tests fail, the step fails immediately. No oracle call needed — broken tests are a hard gate.

### Stage 2: Oracle Evaluation

The oracle (existing `packages/core/src/skills/oracle.ts`) validates the git diff against the ticket's acceptance criteria and linked spec. It's an LLM call — slower and more expensive, but catches semantic issues that tests miss.

Oracle receives:
- Git diff (from auto-commit)
- Acceptance criteria (parsed from ticket `## Acceptance Criteria`)
- Linked spec (from ticket `links:` field)
- Test results (from stage 1)

Oracle returns per-criterion pass/fail with reasoning. All criteria must pass for the step to succeed.

```typescript
interface VerificationResult {
  stepTicketId: string;
  testGate: TestGateResult;
  oracle?: OracleResult;         // null if tests failed (oracle skipped)
  passed: boolean;
  failureReasons: string[];      // human-readable list
}
```

### Stage 3: Event Store

Store the full verification result in a new `plan_events` entry:

```
event_type: "step_verified"
detail_json: { testGate: {...}, oracle: {...}, passed: bool }
```

This gives historical data: "How often do agents pass on first try?", "Which acceptance criteria fail most often?"

## Configuration

```typescript
interface OrchestratorConfig {
  // ... existing fields ...
  autoCommit: boolean;
  verification: {
    runTests: boolean;           // default true — run test gate
    runOracle: boolean;          // default false — oracle requires LLM config
    oracleModel?: string;        // model for oracle calls (default: project's configured model)
  };
}
```

Oracle is off by default — it requires an LLM provider to be configured. Test gate is on by default. Both can be toggled per-plan.

## Executor Integration

In `executor.ts`, the `agent_completed` handler changes from:

```
check write count → mark done/failed
```

To:

```
check write count → auto-commit → run verification pipeline → mark done/failed
```

The verification pipeline is non-blocking for the event loop — it runs as an async task and pushes a `step_verified` event when complete. Other steps can continue starting while verification runs.

## Failed Verification Behavior

When verification fails:
1. Step status = "failed" with structured error from verification result
2. If `pauseOnFailure` is true, plan pauses
3. The failure reason includes which specific criteria failed and why
4. User can: fix and retry, skip the step, or inject context and resume

The oracle's per-criterion feedback is stored so that if the step is retried, the agent gets the feedback in its context packet: "Previous attempt failed because: [oracle reasoning]"

## Non-Goals

- **Blocking on oracle for every step** — oracle is optional and off by default
- **Automatic retry** — failed steps pause the plan, human decides
- **Custom verification scripts** — use the test command for project-specific checks
- **Verifying steps that had no writes** — those already fail via write-count check
