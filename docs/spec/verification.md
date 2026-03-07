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

The oracle validates the git diff against the ticket's acceptance criteria and linked spec. It catches semantic issues that tests miss — an agent that passes all tests but didn't actually implement the feature.

**The oracle is an agent session**, not a bespoke LLM call. It runs through the same `SessionManager` and backend infrastructure as coding agents, using a dedicated `oracle` role (see `docs/spec/roles.md`). This means:

- It works with any configured backend (claude-code, opencode, codex, etc.)
- Events are tracked in the event store and visible in the TUI
- No separate LLM call infrastructure to maintain
- The oracle agent shows up in the agents panel while running

The oracle role is read-only: no file editing, no bash, no tools. It receives the evaluation prompt as its system prompt, responds with a structured evaluation, and exits.

#### Oracle Agent Session

The executor starts an oracle agent session via `SessionManager.startSession()` with:
- Role: `oracle` (built-in)
- System prompt: the formatted oracle prompt (ticket, acceptance criteria, spec, git diff, test results)
- Backend: `plan.config.backend` (same as coding agents)
- Model: `plan.config.verification.oracleModel` (optional override)
- No worktree, no tools, no bash

The executor listens for `session_stopped` on the oracle session, collects the assistant's response text from the event stream, and parses it with `parseOracleResponse()`.

#### Oracle Role

```yaml
# Built-in role: oracle
id: oracle
name: Oracle
permissionMode: default
allowedTools: []
disallowedTools:
  - Edit
  - Write
  - NotebookEdit
  - Bash
  - Read
  - Glob
  - Grep
  - EnterPlanMode
  - ExitPlanMode
  - EnterWorktree
allowedBashPatterns: []
instructions: |
  You are a verification oracle. Evaluate whether code changes satisfy acceptance criteria.
  Respond ONLY with the structured format specified in your prompt.
  Do not use any tools. Do not attempt to read or modify files.
doneCriteria: "Evaluation complete."
runTests: false
runOracle: false
```

#### Oracle Input

Oracle receives (via system prompt, assembled by `formatOraclePrompt()`):
- Git diff (from auto-commit)
- Acceptance criteria (parsed from ticket `## Acceptance Criteria`)
- Linked spec (from ticket `links:` field)
- Test results (from stage 1)

Oracle returns per-criterion pass/fail with reasoning. All criteria must pass for the step to succeed.

#### Oracle Response Parsing

The oracle agent's assistant output text is parsed by `parseOracleResponse()` (existing, in `packages/core/src/skills/oracle.ts`). The structured format:

```markdown
## Criteria
- **Criterion**: <text>
  - **Met**: YES or NO
  - **Reasoning**: <explanation>

## Concerns
- <concern text, or "None.">
```

#### Prompt Size

The oracle prompt can be large (50KB+ git diff, spec content, test results). Because the prompt is passed as the system prompt to an agent session (not as a CLI argument), it avoids OS argument length limits. The agent adapter handles prompt delivery via its normal mechanism (stdin pipe for claude-code, HTTP body for opencode).

```typescript
interface VerificationResult {
  stepTicketId: string;
  testGate?: TestGateResult;
  oracle?: OracleResult;         // null if tests failed (oracle skipped)
  oracleError?: string;          // set if oracle agent failed to run
  oracleSessionId?: string;      // agent session ID for the oracle run
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
    runOracle: boolean;          // default true — LLM checks diff against acceptance criteria
    oracleModel?: string;        // model for oracle calls (default: project's configured model)
    maxRetries: number;          // default 2 — retries on verification failure (0 = fail immediately)
  };
}
```

Both test gate and oracle are on by default. Retries default to 2. All can be toggled per-plan.

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

## Auto-Rebase on Merge Conflict

When verification passes but the merge into main fails with a conflict, the step currently dead-ends at `needs-rebase`. The user must manually resolve conflicts outside opcom. Auto-rebase makes this recoverable.

### Flow

```
Verification passes → merge fails (conflict)
    ↓
1. Attempt git rebase onto main in the worktree
    ├─ clean rebase → re-run verification → merge → done
    └─ conflict
         ↓
2. Start agent in worktree with conflict context
    ├─ agent resolves conflicts, commits → re-run verification → merge → done
    └─ agent fails or verification fails
         ↓
3. Mark step needs-rebase (existing behavior — human intervenes)
```

### Stage 1: Clean Rebase

Before involving an agent, try a non-interactive rebase. Many conflicts are trivial (whitespace, import ordering, non-overlapping changes in the same file).

```typescript
async attemptRebase(stepId: string): Promise<RebaseResult> {
  const info = this.worktrees.get(stepId);
  const cwd = info.worktreePath;

  // Rebase the worktree branch onto current main
  try {
    await execFileAsync("git", ["rebase", mainBranch], { cwd });
    return { rebased: true, conflict: false };
  } catch (err) {
    // Check if rebase hit conflicts
    if (isConflict(err)) {
      await execFileAsync("git", ["rebase", "--abort"], { cwd });
      return { rebased: false, conflict: true, conflictFiles: parseConflictFiles(err) };
    }
    return { rebased: false, conflict: false, error: String(err) };
  }
}

interface RebaseResult {
  rebased: boolean;
  conflict: boolean;
  conflictFiles?: string[];
  error?: string;
}
```

If the rebase succeeds cleanly, re-run the verification pipeline (tests may break due to upstream changes) and then merge. This is a fast path that requires no agent involvement.

### Stage 2: Agent-Assisted Conflict Resolution

If the clean rebase fails, start an agent in the worktree with conflict context. The agent resolves conflicts, commits, and exits — then verification and merge retry.

The agent receives a context packet with:

```markdown
## Merge Conflict Resolution

Your branch `work/tui-health-view` has conflicts with `main`. Resolve them.

### Conflicting Files
- src/tui/views/dashboard.ts
- src/tui/views/plan-step-focus.ts

### Instructions
- Run `git rebase main` to start the rebase.
- For each conflict, read the file, understand both sides, and resolve correctly.
- Do NOT drop changes from either side unless one is clearly obsolete.
- After resolving each file, `git add <file>` then `git rebase --continue`.
- Run tests relevant to the conflicting files to verify the resolution.
- Do not modify files that are not part of the conflict.
```

The agent uses the same role as the original step (typically `engineer`) but with focused instructions. It gets the conflict file list and both sides of the diff for context.

### Stage 3: Hard Fail

If the agent fails to resolve conflicts (exits without completing the rebase) or post-rebase verification fails:
- Step status = `"needs-rebase"` (existing behavior)
- Plan pauses if `pauseOnFailure` is true
- Worktree preserved for manual intervention
- Event store records the full attempt chain: original merge → rebase attempt → agent resolution attempt

### Configuration

```typescript
interface VerificationConfig {
  // ... existing fields ...
  autoRebase: boolean;          // default true — attempt auto-rebase on merge conflict
}
```

`autoRebase: false` preserves current behavior (immediate `needs-rebase` on conflict).

### Executor Integration

In `handleWorktreeCompletion()`, the merge conflict handler changes from:

```
merge conflict → mark needs-rebase → pause
```

To:

```
merge conflict → attempt clean rebase
    ├─ success → re-verify → merge
    └─ conflict → start agent with conflict context
         ├─ agent resolves → re-verify → merge
         └─ failure → mark needs-rebase → pause
```

```typescript
if (mergeResult.conflict) {
  if (!this.plan.config.verification.autoRebase) {
    // Existing behavior: immediate needs-rebase
    step.status = "needs-rebase";
    // ...
    return;
  }

  // Stage 1: attempt clean rebase
  const rebaseResult = await this.worktreeManager.attemptRebase(step.ticketId);

  if (rebaseResult.rebased) {
    // Clean rebase succeeded — re-verify and merge
    const reVerification = await this.runVerification(step, event, roleVerify);
    if (reVerification && !reVerification.passed) {
      // Post-rebase verification failed — enter retry loop or fail
      // (same logic as normal verification failure)
    }
    const reMerge = await this.worktreeManager.merge(step.ticketId);
    if (reMerge.merged) {
      // Success — complete the step
    }
    return;
  }

  if (rebaseResult.conflict) {
    // Stage 2: start agent to resolve conflicts
    step.status = "ready";
    step.rebaseConflict = {
      files: rebaseResult.conflictFiles ?? [],
      baseBranch: "main",
    };
    // startStep() will detect rebaseConflict and build conflict-resolution context
    return;
  }

  // Rebase failed for non-conflict reason — needs-rebase
  step.status = "needs-rebase";
  // ...
}
```

### Step State Addition

```typescript
interface PlanStep {
  // ... existing fields ...
  rebaseConflict?: {
    files: string[];             // conflicting file paths
    baseBranch: string;          // branch being rebased onto
  };
}
```

When `rebaseConflict` is set on a step, `startStep()` builds a conflict-resolution context packet instead of the normal ticket context. The `rebaseConflict` field is cleared after the agent completes.

### Event Store

Auto-rebase emits events for traceability:

```
step_rebase_attempted: { stepId, clean: true/false }
step_rebase_agent_started: { stepId, conflictFiles: [...] }
step_rebase_resolved: { stepId, method: "clean" | "agent" }
step_rebase_failed: { stepId, reason: "..." }
```

### TUI Integration

When auto-rebase is in progress, the step shows a distinct status in the dashboard:

| Icon | Status |
|------|--------|
| `⟳` | rebasing (yellow) — auto-rebase in progress |
| `⇄` | needs-rebase (red) — auto-rebase failed, manual intervention needed |

The step detail view (Enter on a rebasing step) shows which files conflicted and whether a clean rebase or agent resolution is being attempted.

## Zero-Commit Oracle Arbitration

When an agent exits without making any commits, the step currently hard-fails immediately. But this is ambiguous — the agent may have found that the work was already done (e.g., a previous step already implemented the feature, or the ticket describes existing behavior). The oracle can resolve this ambiguity.

### Flow

```
Agent exits with 0 commits
    |
Oracle enabled?
    |-- yes -> run oracle against current state (no diff)
    |           |-- criteria met -> step done (already implemented)
    |           |-- criteria unmet -> step failed (agent didn't do the work)
    |-- no  -> step failed (can't verify, assume failure -- current behavior)
```

When oracle is enabled (now the default), the executor skips the "no commits = failure" short-circuit and instead sets the step to `verifying`, then runs the oracle against the current codebase state with an empty diff. If the oracle confirms all acceptance criteria are met, the step completes as done — no commits needed. If the oracle finds unmet criteria, the step fails with structured feedback (same as normal oracle failure).

Tests are irrelevant in this path — if the agent made no changes, the test suite result is the same as before the step started.

This means having oracle enabled naturally handles the "ticket already done" case without special logic — it's the normal verification pipeline running on an empty diff.

### Executor Changes

In `handleWorktreeCompletion()`, the `!hasWork` branch changes from immediate failure to:

```typescript
if (!hasWork) {
  const roleVerify = this.stepVerification.get(step.ticketId);
  const verification = roleVerify ?? this.plan.config.verification;

  if (verification.runOracle) {
    // Oracle can arbitrate: is the work already done?
    step.status = "verifying";
    await savePlan(this.plan);
    this.emit("plan_updated", { plan: this.plan });

    const result = await this.runVerification(step, event, {
      runTests: false,   // tests are irrelevant (no changes)
      runOracle: true,
    });

    if (result?.passed) {
      // Oracle confirms criteria are met — step is done
      step.status = "done";
      step.verification = result;
      // ... complete step (no merge needed — no commits)
      return;
    }
    // Oracle says criteria unmet — fall through to failure
  }

  const reason = "Agent exited without making any commits";
  await this.failStep(step, reason);
  // ... existing failure handling
}
```

## Verification Progress Visibility

While verification runs (step status `verifying`), the TUI should expose what's happening inside the pipeline rather than showing an opaque spinner.

### Sub-Phase Tracking

The executor tracks which verification sub-phase is active:

```typescript
interface PlanStep {
  // ... existing fields ...
  verifyingPhase?: "testing" | "oracle";
}
```

The executor sets `step.verifyingPhase = "testing"` before running the test gate and `step.verifyingPhase = "oracle"` before running the oracle. The TUI reads this to show distinct states.

### TUI Display

**Dashboard plan panel** — step row shows sub-phase:
- `◎ testing...` (yellow) — test suite running
- `◎ oracle...` (yellow) — oracle LLM call in progress

**Plan step focus view** — when step is `verifying`, show:
- Current sub-phase with elapsed time: `Testing... (12s)` or `Oracle evaluation... (8s)`
- If test gate completed and oracle is running: show test results above oracle spinner
- Oracle model name (from config) so the user knows which LLM is being called

### Executor Events

The executor emits granular events for TUI consumption:

```
step_verify_phase: { stepTicketId, phase: "testing" | "oracle", startedAt }
```

The TUI subscribes to these events to update the display in real time, rather than polling step state.

## Non-Goals

- **Unbounded retries** — max 2 retries by default, configurable but always finite
- **Custom verification scripts** — use the test command for project-specific checks
- **Smart retry strategies** — no backoff, no partial re-execution; each retry is a fresh agent session with failure context
- **Cross-branch rebase** — auto-rebase only handles rebasing onto the plan's target branch (typically main), not arbitrary branch combinations
- **Interactive rebase** — only non-interactive rebase is attempted; history rewriting is out of scope
- **Streaming test output** — test output is captured and displayed after completion, not streamed live (simplifies implementation, avoids TUI flicker)
