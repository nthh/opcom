---
id: file-overlap-scheduling
title: "Serialize steps with overlapping files to avoid merge conflicts"
status: closed
type: feature
priority: 2
created: 2026-03-06
deps: []
links:
  - docs/spec/orchestrator.md
---

# Serialize steps with overlapping files to avoid merge conflicts

## Goal

When multiple steps are ready, check the context graph for file-level overlaps. Steps that touch the same files run sequentially instead of in parallel, reducing merge conflicts.

## Tasks

- [ ] In `startReadySteps()`, query context graph for each ready step's related files
- [ ] Collect files claimed by in-progress/verifying steps
- [ ] Filter out ready steps that overlap with claimed files or with each other
- [ ] Sort ready steps by priority (P1 first), then by blockedBy count (fewer = first), then array order
- [ ] Cache step file sets for the duration of the plan to avoid repeated graph queries
- [ ] Graceful fallback: if graph is unavailable, skip overlap detection (start all ready steps)
- [ ] Log when a step is held back due to file overlap

## Acceptance Criteria

- Two ready steps touching the same files are serialized (higher priority runs first)
- Steps with no file overlap still run in parallel
- If context graph is not available, behavior is unchanged (no crash, no blocking)
- Equal priority tie-broken by blockedBy count then array order
- Existing tests pass; new tests cover overlap detection and priority sorting
