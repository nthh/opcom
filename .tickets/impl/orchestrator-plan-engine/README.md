---
id: orchestrator-plan-engine
title: "Orchestrator: Plan Engine — DAG Computation + Persistence"
status: open
type: feature
priority: 1
deps:
  - phase-3-server
links:
  - docs/spec/orchestrator.md
services:
  - types
  - core
  - cli
---

# Orchestrator: Plan Engine

## Goal

Compute execution plans from ticket dependency graphs. Plans are derived (not authored) — the ticket `deps` fields encode the DAG, the planner adds execution metadata: what's unblocked, what can parallelize, track grouping.

## Tasks

- [ ] Define types in `packages/types/src/plan.ts`: `Plan`, `PlanStep`, `PlanScope`, `StepStatus`, `OrchestratorConfig`
- [ ] Export from `packages/types/src/index.ts`
- [ ] Implement `computePlan()` in `packages/core/src/orchestrator/planner.ts`:
  - [ ] Scope resolution (by ticket IDs, project IDs, or query)
  - [ ] DAG construction from ticket `deps`
  - [ ] Cycle detection
  - [ ] Status computation (blocked/ready based on dep status)
  - [ ] Preserve existing step status on recomputation
- [ ] Implement `computeTracks()` — group steps into parallel execution paths by connectivity
- [ ] Plan persistence: save/load from `~/.opcom/plans/<id>.yaml`
- [ ] Context persistence: `~/.opcom/plans/<id>.context.md`
- [ ] REST endpoints: `GET/POST /plans`, `GET/PATCH/DELETE /plans/:id`
- [ ] WebSocket event: `plan_updated`
- [ ] CLI: `opcom plan create`, `opcom plan show`, `opcom plan` (list)
- [ ] Tests: DAG computation, cycle detection, track grouping, recomputation with preserved state

## Acceptance Criteria

- `opcom plan create --scope open --name "today"` creates a plan from all open tickets
- `opcom plan show` renders the DAG with tracks and step status in terminal
- Plan recomputes correctly when tickets change (deps added/removed, status updated)
- Cycle detection errors before creating an invalid plan
