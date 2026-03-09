---
id: structured-state-files
title: "Separate JSONL state files by concern (decisions, metrics, artifacts)"
status: open
type: feature
priority: 3
deps: []
links:
  - docs/spec/orchestrator.md
services:
  - core
---

# Structured State Files by Concern

## Goal

Partition the event store into separate, append-only JSONL files organized by concern: decisions, metrics, and artifacts. This makes state queryable without parsing a monolithic event stream and enables focused dashboards. Inspired by auto-co's four-file state architecture (`decisions.jsonl`, `tasks.jsonl`, `metrics.jsonl`, `artifacts.jsonl`).

## Problem

Today opcom tracks plan events in a single event store. Querying "what decisions were made?" or "what artifacts were produced?" requires filtering through all event types. Dashboards need to parse the entire stream to extract metrics. Separate files make each concern independently queryable.

## Design

### State Directory

```
~/.opcom/state/
├── decisions.jsonl      # strategic decisions with rationale
├── metrics.jsonl        # operational metrics per plan/step
└── artifacts.jsonl      # produced outputs (commits, files, deploys)
```

Work item state is already tracked in `.tickets/` — no separate `tasks.jsonl` needed.

### decisions.jsonl

Captures significant decisions made during plan execution:

```jsonl
{"timestamp":"2026-03-08T14:30:00Z","planId":"p1","stepId":"auth-migration","agent":"engineer","decision":"Used Clerk instead of Firebase Auth","rationale":"Better edge runtime support, simpler API","confidence":0.9}
{"timestamp":"2026-03-08T15:00:00Z","planId":"p1","stepId":"auth-migration","agent":"oracle","decision":"Approved auth migration implementation","rationale":"All 5 acceptance criteria met","confidence":1.0}
```

Sources:
- Oracle evaluations (each criterion pass/fail is a decision)
- Agent session completion (what approach was taken)
- Plan-level decisions (skip step, pause, manual override)

### metrics.jsonl

Captures operational metrics per step and plan:

```jsonl
{"timestamp":"2026-03-08T14:30:00Z","planId":"p1","stepId":"auth-migration","metric":"step_duration_ms","value":720000}
{"timestamp":"2026-03-08T14:30:00Z","planId":"p1","stepId":"auth-migration","metric":"test_pass_rate","value":0.98,"detail":"147/150 tests passed"}
{"timestamp":"2026-03-08T14:30:00Z","planId":"p1","stepId":"auth-migration","metric":"attempts","value":1}
{"timestamp":"2026-03-08T14:30:00Z","planId":"p1","metric":"plan_progress","value":0.6,"detail":"3/5 steps done"}
```

Sources:
- Test gate results (pass rate, duration, failure counts)
- Step timing (start to completion)
- Retry counts
- Plan progress snapshots

### artifacts.jsonl

Tracks every output produced during execution:

```jsonl
{"timestamp":"2026-03-08T14:30:00Z","planId":"p1","stepId":"auth-migration","type":"commit","ref":"abc123","path":"src/auth/","agent":"engineer"}
{"timestamp":"2026-03-08T14:30:00Z","planId":"p1","stepId":"auth-migration","type":"file","path":"docs/research/auth-comparison.md","agent":"researcher"}
{"timestamp":"2026-03-08T15:00:00Z","planId":"p1","stepId":"auth-migration","type":"merge","ref":"def456","path":"main","agent":"executor"}
```

Sources:
- Git commits (from worktree merges)
- Files created/modified (from agent events)
- Deployments (from CI/CD integration)

### Writer API

```typescript
interface StateWriter {
  appendDecision(entry: DecisionEntry): Promise<void>;
  appendMetric(entry: MetricEntry): Promise<void>;
  appendArtifact(entry: ArtifactEntry): Promise<void>;
}

interface StateReader {
  readDecisions(filter?: { planId?: string; stepId?: string }): AsyncIterable<DecisionEntry>;
  readMetrics(filter?: { planId?: string; metric?: string }): AsyncIterable<MetricEntry>;
  readArtifacts(filter?: { planId?: string; type?: string }): AsyncIterable<ArtifactEntry>;
}
```

All writes are append-only. Files are never truncated or rewritten.

### Integration Points

The executor emits state entries at natural points:
- `step_verified` → decision entry (oracle result) + metric entry (test results, duration)
- `step_completed` → artifact entries (commits merged)
- `plan_completed` → metric entry (overall plan stats)

### Relationship to Event Store

These files **complement** the existing plan event store, not replace it. The event store tracks the execution timeline (step started, agent spawned, etc.). State files track the **outputs** (what was decided, measured, produced). They can be built from events but are easier to query when separate.

## Tasks

- [ ] Define `DecisionEntry`, `MetricEntry`, `ArtifactEntry` types
- [ ] Implement `StateWriter` with atomic JSONL append
- [ ] Implement `StateReader` with filtering
- [ ] Integrate state writing into executor (step_verified, step_completed, plan_completed)
- [ ] Create `~/.opcom/state/` directory on init
- [ ] Add `opcom state [decisions|metrics|artifacts]` CLI commands for querying
- [ ] Tests for write, read, and filtering

## Acceptance Criteria

- Step completion writes decision, metric, and artifact entries to separate files
- Each file is valid JSONL (one JSON object per line)
- Files are append-only — never truncated
- `opcom state decisions` shows decisions with rationale
- `opcom state metrics` shows operational metrics
- `opcom state artifacts` shows produced outputs
- State files survive process crashes (append is atomic at line level)
