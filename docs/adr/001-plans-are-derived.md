---
id: "001"
title: Plans are derived from tickets, not authored
status: accepted
date: 2026-02-28
spec: docs/spec/orchestrator.md
---

# ADR-001: Plans Are Derived From Tickets

## Context

The orchestrator needs to manage execution order across multiple tickets with dependencies. Two approaches: maintain a separate plan document (like a project plan), or compute the plan from the ticket graph.

## Decision

Plans are computed, not authored. The ticket `deps` fields encode the dependency DAG. The planner reads ticket state and computes what's blocked, ready, and done. When tickets change, the plan recomputes.

## Consequences

- No plan/ticket sync problem — tickets are the single source of truth
- Recomputation is cheap (pure function over ticket state)
- Plans don't persist editorial intent — if you want to force ordering beyond deps, you add a dep
- Plans can't express "do A before B" without a real dependency between A and B
