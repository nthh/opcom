---
id: integration-branch-planner
title: "Planner detection of integration parents"
status: closed
type: feature
priority: 2
created: 2026-03-15
parent: integration-branches
deps:
  - integration-branch-types
links:
  - docs/spec/orchestrator.md#integration-branches
---

# Planner Detection of Integration Parents

## Context Packet

**Goal:** Make `computePlan()` detect parent tickets with child `.md` files and set `integrationBranch` on each child step, so the executor knows to use integration branch topology.

**Non-Goals:** Executor behavior changes — this ticket only sets the field. Creating/merging the integration branch is handled in the executor ticket.

**Constraints:**
- Detection must be automatic — no new frontmatter field required
- Only applies when `worktree: true` in plan config
- Must not change DAG computation, dep resolution, or track assignment
- Parent tickets remain excluded from plan steps (existing behavior)

**Repo Anchors:**
- `packages/core/src/orchestrator/planner.ts` — `computePlan()`, `findParentTicketIds()`, step construction loop
- `packages/types/src/plan.ts` — PlanStep with new `integrationBranch` field
- `packages/types/src/work-items.ts` — WorkItem `parent` field used for detection

**Prior Art:** `findParentTicketIds()` already identifies parent tickets. The planner already excludes parents from steps and tracks parent/child relationships. This change piggybacks on that existing detection.

**Oracle (Done When):**
- [ ] Child steps of a parent ticket have `integrationBranch: "work/<parent-id>"` set when `worktree: true`
- [ ] Non-child tickets (standalone) have no `integrationBranch` set
- [ ] When `worktree: false`, no `integrationBranch` is set (feature is worktree-only)
- [ ] DAG computation, blockedBy resolution, and track assignment are unchanged
- [ ] Existing planner tests pass, no regressions

**Risks:** Edge case — nested parents (parent of parent). Current detection uses a flat `parent` field, so nesting shouldn't occur. If it does, only the immediate parent's integration branch applies.

## Tasks

- [ ] In `computePlan()`, after parent exclusion, set `integrationBranch` on child steps
- [ ] Add planner unit tests for integration branch detection (deps: in-computeplan-after-parent-exclusion-set-integrationbranch-on-child-steps)
