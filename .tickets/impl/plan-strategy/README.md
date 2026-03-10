---
id: plan-strategy
title: "Add spread/swarm/mixed strategy to plans"
status: closed
type: feature
priority: 2
created: 2026-03-10
deps: []
links:
  - docs/spec/orchestrator.md#plan-strategy
  - docs/spec/orchestrator.md#strategy-modes
  - docs/spec/orchestrator.md#subtask-extraction
  - docs/spec/orchestrator.md#swarm-execution
services:
  - types
  - core
---

# Plan Strategy

## Problem

Today the orchestrator has one allocation model: each agent gets one ticket, all ready tickets run in parallel (spread). This works well for N independent tickets but poorly for one large ticket that could benefit from multiple agents working its subtasks concurrently.

Two real scenarios that don't fit the current model:

1. **Large feature ticket with 10+ subtasks** — the planner creates one step for the whole thing. One agent grinds through subtasks sequentially. Other agents sit idle.
2. **Sprint focus** — team wants maximum throughput on a single deliverable (demo, release). Spreading agents across unrelated tickets dilutes focus.

The `team-formation` feature (engineer → qa → reviewer pipeline) addresses multi-*role* work on one ticket but is sequential. This ticket addresses multi-*agent* parallelism within one ticket.

## Goal

Add a `strategy` field to plans (`spread | swarm | mixed`) that controls how agents are allocated. In swarm mode, the planner extracts subtasks from a ticket's body and schedules them as parallel steps. The executor already handles `blockedBy` and concurrency — the main change is the planner producing more steps from fewer tickets.

## Design

### Types

```typescript
type PlanStrategy = "spread" | "swarm" | "mixed";

// OrchestratorConfig gains:
interface OrchestratorConfig {
  // ... existing ...
  strategy?: PlanStrategy;        // default "spread"
  swarmTarget?: string;           // ticket ID, required when strategy = "swarm"
}

// PlanStep gains:
interface PlanStep {
  // ... existing ...
  parentTicketId?: string;        // set for swarm subtask steps
  subtaskId?: string;             // e.g. "T001"
}
```

### Subtask Extraction

New function `extractSubtasks(ticketBody: string, ticketId: string)`:

Parses the `## Tasks` section of a ticket body for structured task lines:

```markdown
## Tasks

- [ ] T001 Set up auth types (parallel)
- [ ] T002 Implement token refresh (parallel)
- [ ] T003 Add session middleware (deps: T001)
- [ ] T004 Write integration tests (deps: T001, T002)
```

Parsing rules:
1. Match lines: `- [ ] <id> <description> (<modifiers>)`
2. Task ID: first word after checkbox (alphanumeric, e.g., `T001`)
3. Modifiers in parentheses:
   - `parallel` or `[P]` → no deps, can run immediately
   - `deps: T001, T002` → blocked by listed IDs
   - No modifier → depends on previous task (sequential default)
4. Already-checked tasks (`- [x]`) → status `done`, skip

Returns `ExtractedSubtask[]`:

```typescript
interface ExtractedSubtask {
  id: string;
  parentTicketId: string;
  description: string;
  deps: string[];
  parallel: boolean;
}
```

### Planner Changes

In `computePlan()`, when a ticket is a swarm target:

1. Read the ticket body and call `extractSubtasks()`
2. If subtasks found: create one `PlanStep` per subtask with `parentTicketId` and `subtaskId`
3. Parent ticket does NOT get its own step (same pattern as parent tickets with child ticket files)
4. Subtask `blockedBy` maps subtask deps to step IDs: `T003 deps T001` → step for T003 blockedBy step for T001
5. Subtasks inherit the parent ticket's `track`, `role`, and `projectId`

In `spread` mode: no change (current behavior).

In `swarm` mode:
- The swarm target ticket's subtasks become steps
- If the swarm target has ticket-level `deps` (e.g., `deps: [auth-types]`), those dependency tickets are included as regular spread steps that must complete before any subtask starts
- `maxConcurrentAgents` controls how many subtasks run simultaneously

In `mixed` mode:
- Tickets with `strategy: swarm` in frontmatter get subtask extraction
- Other tickets become normal spread steps
- Agent slots are shared — swarm subtasks compete with regular steps for slots

### Executor Changes

Minimal — the executor already handles:
- `blockedBy` between steps → subtask deps work automatically
- `maxConcurrentAgents` → limits parallel subtask execution
- Worktree isolation → each subtask gets its own worktree (parallel execution would conflict in shared worktree; merge/rebase on completion, same as regular spread steps)
- Verification → each subtask runs through the verification pipeline independently

New behavior:
- When all subtask steps for a parent complete → mark parent ticket as `closed` (if `ticketTransitions` enabled)
- Context packet for subtask agents includes: parent ticket body + specific subtask description + diffs from completed siblings

### Team Formation Interaction

A ticket can have both `team: feature-dev` and `strategy: swarm`. These compose — subtasks are extracted first, then each subtask is expanded through the team pipeline. Subtask T001 becomes T001/engineer → T001/qa → T001/reviewer. Across subtasks, parallel with separate worktrees. Within a team sequence, sequential with shared worktree. If not desired, use one or the other — they're independently useful.

### Stage Interaction

Stages work with swarm subtasks:
- Auto-staging groups subtasks by their dependency depth within the parent
- Stage 1: all parallel (no-dep) subtasks
- Stage 2: subtasks that depend on stage 1 completions
- etc.
- This gives natural review points within a large ticket

### CLI

```bash
opcom plan create --strategy swarm --target ticket-id --name "swarm: big-feature"
opcom plan create --strategy mixed --scope open --name "sprint-1"
opcom plan create --scope open --name "today"   # default: spread
```

### Ticket Frontmatter

For `mixed` mode, tickets opt into swarm via frontmatter:

```yaml
---
id: big-feature
strategy: swarm
---
```

Add `strategy?: PlanStrategy` to `WorkItem` type.

## Tasks

- [ ] Add `PlanStrategy` type and `strategy`, `swarmTarget` to `OrchestratorConfig`
- [ ] Add `parentTicketId`, `subtaskId` to `PlanStep`
- [ ] Add `strategy` to `WorkItem` (optional frontmatter field)
- [ ] Implement `extractSubtasks()` — parse `## Tasks` section for structured task lines
- [ ] Update `computePlan()` to handle swarm targets: extract subtasks → create steps
- [ ] Update `computePlan()` to handle mixed mode: detect tickets with `strategy: swarm` frontmatter
- [ ] Update executor to mark parent ticket done when all subtask steps complete
- [ ] Update context builder to include parent ticket body + sibling diffs for subtask agents
- [ ] Update `computeStages()` to work with subtask steps (group by dep depth within parent)
- [ ] Add `--strategy` and `--target` flags to `opcom plan create`
- [ ] Tests: subtask extraction (parallel, deps, sequential default, checked=done), swarm plan computation, mixed mode plan, stage computation for subtasks, parent completion

## Acceptance Criteria

- `extractSubtasks()` correctly parses task lines with `parallel`, `deps:`, and sequential defaults
- Swarm plan creates one step per subtask, parent has no step
- Subtask `blockedBy` reflects parsed deps
- Parallel subtasks all launch up to `maxConcurrentAgents`
- Parent ticket closes when all subtasks complete
- Mixed mode: swarm tickets decompose, normal tickets don't
- Stages within a swarm group by dependency depth
- Spread mode is unchanged (backward compatible)
