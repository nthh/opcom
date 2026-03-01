---
id: planning-decomposition
title: "Planning Sessions: Ticket Decomposition into Agent-Sized Sub-Tickets"
status: open
type: feature
priority: 2
deps:
  - orchestrator-planning-sessions
links:
  - docs/spec/orchestrator.md
services:
  - core
  - cli
---

# Planning Sessions: Ticket Decomposition

## Goal

Before plan execution, a planning phase reviews each ticket and decomposes large ones into agent-sized sub-tickets. Sub-tickets go back into the ticket graph as normal tickets with `parent` linking. The planner recomputes and now the DAG has right-sized steps.

## Tasks

- [ ] Add decomposition logic to planning session flow:
  - [ ] Planning agent reads ticket + spec + codebase
  - [ ] Estimates scope: is this one-session or needs decomposition?
  - [ ] Criteria: multiple providers, types+impl+tests, TUI+backend, spec >200 lines
  - [ ] Creates sub-tickets in `.tickets/` with `parent: <original-ticket-id>`
  - [ ] Sub-tickets get deps on each other (e.g., types before adapters)
- [ ] Parent ticket handling in planner:
  - [ ] Parent ticket status = "done" when all children are done
  - [ ] Parent ticket is excluded from plan steps (children are the steps)
  - [ ] `recomputePlan()` handles parent-child rollup
- [ ] Three planning modes:
  - [ ] Agent-driven: `opcom plan create --assisted --decompose`
  - [ ] Human-assisted: agent proposes in TUI, human approves/edits before execution
  - [ ] Manual: human creates sub-tickets, planner picks them up
- [ ] Update `plan.status = "planning"` to be a real phase:
  - [ ] Planning state shows proposed decompositions in TUI
  - [ ] User reviews sub-tickets, edits, then approves to move to "executing"
- [ ] Tests: decomposition creates valid sub-tickets, parent rollup works, planner handles new tickets

## Acceptance Criteria

- Large tickets are decomposed into sub-tickets before agents are assigned
- Sub-tickets have correct deps and `parent` field
- Parent ticket auto-closes when all children complete
- User can review decomposition before execution starts
- Manual sub-ticket creation works without the planning agent
