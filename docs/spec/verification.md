# Verification Specification

## Overview

When an agent completes a step, opcom needs to answer: "Did this actually work?" Today the executor checks write counts — a proxy that proved unreliable (agents writing the same file 5 times in a permission loop counted as "5 writes"). This spec defines a proper verification pipeline that runs after every step completion.

## Core Insight

**Verification is a pipeline, not a single check.** Different signals have different costs and confidence levels. Run cheap checks first, expensive checks only if cheap ones pass.

## Test Responsibility Split

Agents and the verifier have distinct testing responsibilities:

- **Agent**: runs tests *relevant to its changes* during development — the test files it wrote, the test files for the modules it modified. This is iterative, local feedback to catch obvious breakage while coding.
- **Verifier**: runs the *full project test suite* after the agent exits. This is the authoritative gate that catches regressions the agent didn't think to check.

The agent should **not** run the full test suite (`npm test`, `vitest`, etc.). That's the verifier's job. The agent runs targeted tests (specific files, specific patterns) to iterate on its work, then commits and exits. The verifier runs the full suite on the committed state — a controlled, trusted environment.

This avoids two problems:
1. **Redundant compute** — running the full suite twice (once by agent, once by verifier).
2. **Agent test-fix loops** — agents entering long, often counterproductive fix cycles when the full suite fails. The verifier provides structured failure feedback instead.

## Pipeline

```
Agent exits (has run relevant tests during development)
    ↓
1. Test gate: run full project test suite → FAIL = retry or fail
    ↓
2. Oracle evaluation: LLM checks diff against acceptance criteria → FAIL = retry or fail
    ↓
3. Store results in event store
    ↓
4. Mark step done (or failed with structured feedback)
```

### Stage 1: Test Gate

After agent exit and auto-commit, run the project's full test command:

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

If tests fail, the step enters the retry loop (see below). No oracle call needed — broken tests are a hard gate.

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
    runTests: boolean;           // default true — run full test suite as gate
    runOracle: boolean;          // default false — oracle requires LLM config
    oracleModel?: string;        // model for oracle calls (default: project's configured model)
    maxRetries: number;          // default 2 — retries on verification failure (0 = fail immediately)
  };
}
```

Oracle is off by default — it requires an LLM provider to be configured. Test gate is on by default. Retries default to 2. All can be toggled per-plan.

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

## Verification Retry Loop

When verification fails, the executor can automatically retry the step by starting a new agent session with structured failure feedback. This avoids pausing the plan for every test failure.

### Flow

```
Agent exits → verification fails
    ↓
attempt < maxRetries?
    ├─ yes → start new agent session with failure context → agent fixes → verification runs again
    └─ no  → step fails, plan pauses (if pauseOnFailure)
```

### Configuration

```typescript
interface VerificationConfig {
  runTests: boolean;           // default true
  runOracle: boolean;          // default false
  oracleModel?: string;
  maxRetries: number;          // default 2 — how many times to retry after verification failure
}
```

`maxRetries: 0` disables the retry loop (current behavior — fail immediately). Default is 2, meaning the agent gets up to 2 chances to fix verification failures before the step hard-fails.

### Step State

```typescript
interface PlanStep {
  // ... existing fields ...
  attempt: number;             // current attempt (1 = first try, 2 = first retry, etc.)
  maxAttempts: number;         // 1 + maxRetries
  previousVerification?: VerificationResult;  // feedback from last failed attempt
}
```

### Retry Context

When retrying, the executor builds a new context packet that includes structured feedback from the failed verification. This is injected as a `## Previous Attempt` section in the agent's system prompt:

```markdown
## Previous Attempt

This is attempt 2 of 3. Your previous attempt failed verification.

### Test Failures
The full project test suite found 3 failing tests:

```
FAIL src/utils/parser.test.ts > parseConfig > handles empty input
  Expected: null
  Received: undefined

FAIL src/utils/parser.test.ts > parseConfig > validates schema
  AssertionError: expected false to be true

FAIL src/server/routes.test.ts > /api/config > returns 400 on invalid body
  Expected status: 400
  Received: 500
```

### What to fix
- Focus on the failing tests listed above.
- Run those specific test files to verify your fix before finishing.
- Do not modify unrelated code.
```

The retry prompt includes:
- **Attempt number** — so the agent knows urgency
- **Test output** — failed test names, assertion errors, stack traces (from `TestGateResult.output`)
- **Oracle feedback** — if oracle ran, which acceptance criteria were unmet and why
- **Focus instructions** — telling the agent to fix the specific failures, not start over

### Executor Behavior

```typescript
// In handleWorktreeCompletion, after verification fails:
if (verification && !verification.passed) {
  const attempt = step.attempt ?? 1;
  const maxAttempts = 1 + (this.plan.config.verification.maxRetries ?? 2);

  if (attempt < maxAttempts) {
    // Retry: start a new agent session with failure feedback
    step.attempt = attempt + 1;
    step.previousVerification = verification;
    step.status = "ready";  // re-enter the ready pool
    step.agentSessionId = undefined;
    // Worktree is preserved — agent picks up where it left off
    await this.recomputeAndContinue();  // will start the step again
    return;
  }

  // Out of retries — hard fail
  await this.failStep(step, ...);
}
```

Key behaviors:
- **Worktree is preserved** across retries. The agent picks up in the same worktree with its previous commits intact, so it only needs to fix the failures.
- **Each retry is a new agent session.** The previous session is gone, but the failure context is injected into the new session's prompt.
- **The retry agent gets the same role, tools, and permissions** as the original.
- **Retries count against `maxConcurrentAgents`** — a retrying step occupies an agent slot like any other in-progress step.

### Context Builder Integration

`contextPacketToMarkdown()` accepts an optional `VerificationResult` and renders the `## Previous Attempt` section:

```typescript
export function contextPacketToMarkdown(
  packet: ContextPacket,
  roleConfig?: ResolvedRoleConfig,
  previousVerification?: VerificationResult,
): string {
  // ... existing rendering ...

  if (previousVerification) {
    lines.push(`## Previous Attempt`);
    lines.push(`This is a retry. Your previous attempt failed verification.`);
    if (previousVerification.testGate && !previousVerification.testGate.passed) {
      lines.push(`### Test Failures`);
      lines.push(previousVerification.testGate.output);
    }
    if (previousVerification.oracle && !previousVerification.oracle.passed) {
      lines.push(`### Unmet Acceptance Criteria`);
      for (const c of previousVerification.oracle.criteria.filter(c => !c.met)) {
        lines.push(`- ${c.criterion}: ${c.reasoning}`);
      }
    }
    lines.push(`### What to fix`);
    lines.push(`- Focus on the failures above. Do not start over.`);
    lines.push(`- Run the specific failing tests to verify your fix.`);
    lines.push(`- Do not modify unrelated code.`);
  }
}
```

### Event Store

Retries emit distinct events for traceability:

```
step_retry: { attempt: 2, previousVerification: {...} }
step_verified: { attempt: 2, verification: {...} }
```

This enables queries like "How often do agents pass on first try vs. retry?" and "Which types of failures are recoverable?"

## Failed Verification Behavior

When verification fails and retries are exhausted:
1. Step status = "failed" with structured error from the final verification result
2. If `pauseOnFailure` is true, plan pauses
3. The failure reason includes which specific criteria failed and why
4. User can: fix manually, skip the step, or inject context and resume
5. All verification results from all attempts are stored in the event store

## Non-Goals

- **Blocking on oracle for every step** — oracle is optional and off by default
- **Unbounded retries** — max 2 retries by default, configurable but always finite
- **Custom verification scripts** — use the test command for project-specific checks
- **Verifying steps that had no writes** — those already fail via write-count check
- **Smart retry strategies** — no backoff, no partial re-execution; each retry is a fresh agent session with failure context
