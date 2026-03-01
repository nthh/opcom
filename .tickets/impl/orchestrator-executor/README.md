---
id: orchestrator-executor
title: "Orchestrator: Executor Loop — Agent Assignment + Pause/Resume"
status: closed
type: feature
priority: 1
deps:
  - orchestrator-plan-engine
  - event-store
links:
  - docs/spec/orchestrator.md
services:
  - core
  - cli
---

# Orchestrator: Executor Loop

## Goal

The runtime loop that walks the plan DAG, starts agents on unblocked steps, monitors completion, and recomputes on changes. Supports pause/resume with context injection. This is the "ralph loop with structure."

## Tasks

- [ ] Implement `Executor` class in `packages/core/src/orchestrator/executor.ts`:
  - [ ] Event-driven loop: compute ready → start agents → wait → react → recompute
  - [ ] Concurrency control: `maxConcurrentAgents` limit
  - [ ] Agent start: build ContextPacket with plan context, start via SessionManager
  - [ ] Agent completion detection: listen to SessionManager `session_stopped` events
  - [ ] Step transitions: ready → in-progress → done/failed
  - [ ] Plan completion: detect when all steps are done/skipped
- [ ] Pause/resume:
  - [ ] Pause: stop starting new agents, running agents continue
  - [ ] Resume: recompute plan from current ticket state, continue loop
  - [ ] Context injection while paused: append to `plan.context`
- [ ] Ticket status transitions (when `config.ticketTransitions` is true):
  - [ ] Agent starts → ticket `open` → `in-progress`
  - [ ] Agent completes → ticket `in-progress` → `closed`
  - [ ] Write status back to ticket file YAML frontmatter
- [ ] Plan event logging to EventStore (`plan_events` table)
- [ ] REST endpoints: `POST /plans/:id/execute`, `POST /plans/:id/pause`, `POST /plans/:id/resume`, `POST /plans/:id/steps/:ticketId/skip`
- [ ] WebSocket events: `step_started`, `step_completed`, `step_failed`, `plan_completed`, `plan_paused`
- [ ] CLI: `opcom plan execute`, `opcom plan pause`, `opcom plan resume`, `opcom plan context "text"`, `opcom plan skip <ticket>`
- [ ] TUI: PLAN panel replaces WORK QUEUE when plan active
  - [ ] Step status icons (●○◌✓✗⊘)
  - [ ] Track grouping display
  - [ ] Status bar with plan progress
  - [ ] `Space` to pause/resume, `c` to inject context, `w` to manually start step, `s` to skip
  - [ ] Plan completion summary view
- [ ] Tests: loop execution with mock agents, pause/resume, context injection, ticket transitions

## Acceptance Criteria

- `opcom plan execute` starts the loop, agents appear on ready steps respecting concurrency limit
- When an agent finishes, the next unblocked step starts automatically
- `Space` in TUI pauses the plan — no new agents start, running agents continue
- `c` while paused lets user type context, which is included in subsequent agent context packets
- `Space` again resumes — plan recomputes from current ticket state
- Plan completion shows summary with per-track timing
- Ticket files update their status frontmatter as agents start/complete
