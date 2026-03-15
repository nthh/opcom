---
id: integration-branches
title: "Integration branches for parent tickets"
status: open
type: feature
priority: 2
created: 2026-03-15
deps: []
links:
  - docs/adr/006-integration-branches.md
  - docs/spec/orchestrator.md#integration-branches
---

# Integration Branches for Parent Tickets

Parent tickets with child `.md` files create an integration branch (`work/<parent-id>`) that serves as the merge target for all children. Children branch from and merge to the integration branch using the full DAG for parallel scheduling. One final verification gate runs on the complete integration branch before merging to main.

This provides atomic feature delivery, natural code sharing between children, and easy abandonment — without changing the DAG, scheduling, or worktree-per-step model.

See [ADR-006](../../../docs/adr/006-integration-branches.md) and the [spec section](../../../docs/spec/orchestrator.md#integration-branches) for full design.
