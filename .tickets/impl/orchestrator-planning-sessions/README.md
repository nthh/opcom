---
id: orchestrator-planning-sessions
title: "Orchestrator: LLM-Assisted Planning Sessions"
status: open
type: feature
priority: 2
deps:
  - orchestrator-plan-engine
  - phase-6-triage
links:
  - docs/spec/orchestrator.md
services:
  - core
  - cli
---

# Orchestrator: LLM-Assisted Planning Sessions

## Goal

Planning sessions use LLM to analyze current tickets, project state, and user-provided context to create or modify plans. This automates the "sit down and figure out what to do today" workflow — the agent reads all tickets, understands the dep graph, and proposes an execution plan.

## Tasks

- [ ] Define `PlanningContext` extending `ContextPacket` with ticket inventory, project summaries, current plan
- [ ] Implement planning session flow:
  - [ ] Collect all open tickets, deps, project stack info, cloud services
  - [ ] Include triage signals (staleness, priority, blocked items)
  - [ ] Include event store history (past session durations, success rates)
  - [ ] Format LLM prompt with full context
  - [ ] Parse LLM output: new tickets to create, dep modifications, plan scope
- [ ] Interactive planning: user can provide additional context ("also handle the cloud services spec")
  - [ ] Multi-turn conversation with the planning agent
  - [ ] Agent can create tickets, modify deps, update priorities
  - [ ] User approves before plan is finalized
- [ ] Integration with triage skill for priority recommendations
- [ ] CLI: `opcom plan create --assisted` for LLM-assisted planning
- [ ] TUI: `P` key opens planning session modal

## Acceptance Criteria

- `opcom plan create --assisted` starts a planning conversation that produces a plan
- Planning agent correctly reads existing tickets and their dep graph
- User can inject context ("focus on cloud services") and agent adapts the plan
- Generated plan respects existing ticket deps and doesn't create cycles
- Planning session can propose ticket decomposition (see `planning-decomposition` ticket)
