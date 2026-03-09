---
id: stall-detection
title: "Stall detection and circuit-breaking for stuck agents"
status: closed
type: feature
priority: 2
deps: []
links:
  - docs/spec/verification.md
  - docs/spec/orchestrator.md
services:
  - core
---

# Stall Detection and Circuit-Breaking

## Goal

Detect when agents or plan steps are stuck in unproductive loops and automatically escalate or change direction. Inspired by auto-co's hard rule: "If the same Next Action appears 2 consecutive cycles, you are stalled. Change direction."

## Problem

Today the executor retries failed steps up to `maxRetries` times, but it doesn't detect subtler stalls:
- An agent running for 30 minutes without producing commits
- A step that keeps retrying with the same failure pattern
- A plan where no steps have progressed in N minutes
- An agent stuck in a permission-denial loop or test-fix cycle

The retry loop handles hard failures but not soft stalls where the agent is technically running but not making progress.

## Design

### Stall Signals

| Signal | Detection | Action |
|--------|-----------|--------|
| **Long-running agent** | Agent session active > threshold (configurable, default 20 min) with no commits | Warn in TUI, optionally auto-stop |
| **Repeated failure** | Same step fails with same error pattern across retries | Escalate to human instead of retrying |
| **Plan stall** | No step transitions (ready→in-progress, in-progress→done) for > threshold | Pause plan, notify user |
| **Repeated action** | Same verification failure reason across 2+ retries | Include "you are repeating the same mistake" in retry context |

### Implementation

```typescript
interface StallDetector {
  checkAgentStall(session: AgentSession, events: NormalizedEvent[]): StallSignal | null;
  checkStepStall(step: PlanStep, history: VerificationResult[]): StallSignal | null;
  checkPlanStall(plan: Plan): StallSignal | null;
}

interface StallSignal {
  type: "long-running" | "repeated-failure" | "plan-stall" | "repeated-action";
  stepId?: string;
  sessionId?: string;
  message: string;
  suggestion: string;  // what to do about it
  durationMs: number;
}
```

### Configuration

```typescript
interface StallConfig {
  agentTimeoutMs: number;        // default 20 * 60 * 1000 (20 min)
  planStallTimeoutMs: number;    // default 30 * 60 * 1000 (30 min)
  maxIdenticalFailures: number;  // default 2 — same error pattern = stall
  enabled: boolean;              // default true
}
```

### Executor Integration

The executor runs stall checks periodically (every 60s) while the plan is executing:

1. For each in-progress step, check agent duration and commit activity
2. Compare consecutive verification failure reasons for pattern matching
3. Check plan-level progress (any step transitions in last N minutes?)
4. Emit `stall_detected` event with signal details
5. If `pauseOnFailure` is true, pause the plan on stall detection

### TUI Display

Stall signals show in the dashboard:
- `⚠ stalled (20m no commits)` — yellow warning on agent row
- `⚠ plan stalled (no progress 30m)` — yellow warning on plan header
- Step detail view shows stall history and suggestions

### Anti-Pattern Injection

When retrying after a stall-detected failure, inject a "you are stalled" section in the retry context:

```markdown
## Stall Warning

You have attempted this step 2 times with the same failure:
- "TypeError: Cannot read property 'id' of undefined"

You are repeating the same mistake. Try a fundamentally different approach:
- Re-read the relevant source code before making changes
- Check if the API has changed since the spec was written
- Consider whether the ticket's approach needs revision
```

## Tasks

- [ ] Define `StallDetector` interface and `StallSignal` type
- [ ] Implement agent stall detection (duration + commit activity)
- [ ] Implement repeated failure detection (compare error patterns across retries)
- [ ] Implement plan-level stall detection (no transitions in threshold)
- [ ] Add stall check loop to executor (periodic, every 60s)
- [ ] Emit `stall_detected` events
- [ ] Add stall warning injection to retry context
- [ ] Add `StallConfig` to `OrchestratorConfig`
- [ ] TUI display for stall warnings
- [ ] Tests for each stall signal type

## Acceptance Criteria

- Agent running > 20 min without commits triggers a stall warning
- Same failure pattern across 2 retries triggers stall escalation
- Plan with no step transitions for 30 min triggers plan stall
- Stall signals are visible in TUI
- Retry context includes "you are stalled" warning when applicable
- Stall detection is configurable and can be disabled
