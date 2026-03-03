---
id: executor-eventstore-wiring
title: "Wire EventStore into Executor at all call sites"
status: closed
type: bug
priority: 1
deps: []
services:
  - core
  - cli
---

# Wire EventStore into Executor at all call sites

## Problem

The `Executor` constructor accepts an optional `EventStore` as its 3rd argument, and `logPlanEvent()` calls are wired throughout the executor (plan_started, step_started, step_completed, step_failed, plan_paused, plan_completed, etc.). However, **no call site passes an EventStore**, so the `plan_events` table in SQLite is always empty — 0 rows across 14+ plan executions.

## Affected Call Sites

1. `packages/cli/src/commands/plan.ts:196` — `new Executor(plan, sessionManager)`
2. `packages/cli/src/tui/client.ts:551` — `new Executor(this.activePlan, this.localSessionManager)`
3. `packages/core/src/server/station.ts:692` — `new Executor(plan, this.sessionManager)`

## Fix

At each call site, instantiate or reuse an `EventStore` and pass it as the 3rd arg:

```ts
const executor = new Executor(plan, sessionManager, eventStore);
```

The `SessionManager.init()` already accepts `{ eventStore }` at some call sites, so the instance may already be available. Ensure the same `EventStore` instance is shared between `SessionManager` and `Executor` so both session events and plan events land in the same DB.

## Acceptance Criteria

- All 3 call sites pass an `EventStore` to `Executor`
- `plan_events` table populates during plan execution
- `opcom analytics` or future plan-history views can query plan event data
- Existing tests still pass
