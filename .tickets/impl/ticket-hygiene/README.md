---
id: ticket-hygiene
title: "Ticket Hygiene: Automated Status Checks + Dep Validation"
status: open
type: feature
priority: 2
deps:
  - orchestrator-plan-engine
links:
  - docs/spec/orchestrator.md
services:
  - core
  - cli
---

# Ticket Hygiene

## Goal

Automatically detect and report ticket health issues: stale tickets, orphan deps, resolved blockers that aren't unblocked, abandoned in-progress tickets. Runs as a check command and integrates into the TUI.

## Tasks

- [ ] Implement `checkHygiene()` in `packages/core/src/orchestrator/hygiene.ts`:
  - [ ] Stale tickets: open tickets with no git activity or agent work in N days
  - [ ] Orphan deps: ticket depends on an ID that doesn't exist
  - [ ] Cycle detection: circular dependency chains
  - [ ] Resolved blockers: deps are all closed but ticket is still open
  - [ ] Abandoned in-progress: marked in-progress with no running agent
- [ ] Return `HygieneReport` with categorized issues
- [ ] CLI: `opcom plan hygiene` — run checks and print report
- [ ] REST: `GET /plans/:id/hygiene`
- [ ] TUI: `H` key shows hygiene report overlay
- [ ] Integrate with briefing skill: include hygiene warnings in daily briefings
- [ ] Tests: each hygiene check with fixture data

## Acceptance Criteria

- `opcom plan hygiene` reports stale tickets, orphan deps, and unblocked-but-still-open tickets
- Cycle detection catches circular deps and names the involved tickets
- Hygiene report is actionable — each issue has a clear suggested fix
- TUI overlay shows issues grouped by severity
