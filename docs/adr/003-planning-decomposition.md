---
id: "003"
title: Decompose large tickets into agent-sized sub-tickets before execution
status: accepted
date: 2026-03-01
spec: docs/spec/orchestrator.md
tickets: [orchestrator-planning-sessions]
---

# ADR-003: Ticket Decomposition Before Execution

## Context

Agents assigned to large tickets (e.g., "implement cloud serverless adapters" covering 5 providers with types, adapters, detection, and tests) frequently fail or only complete a fragment. The ticket scope exceeds what a single agent session can handle.

## Decision

Before execution begins, a planning phase decomposes large tickets into sub-tickets. Sub-tickets use the existing `parent` field on WorkItem. Three modes:

1. **Agent-driven** — a planning agent reads the ticket, spec, and codebase, then creates sub-tickets
2. **Human-assisted** — agent proposes, human approves/edits
3. **Manual** — human creates sub-tickets directly

These can be mixed per-ticket in the same plan. The `plan.status = "planning"` state is where decomposition happens.

## Consequences

- Each agent gets a right-sized task with clear scope
- The DAG gets finer-grained, enabling better parallelism
- Parent tickets become epics — done when all children are done
- More tickets to manage, but the planner handles the complexity
- Planning phase adds time before execution starts
