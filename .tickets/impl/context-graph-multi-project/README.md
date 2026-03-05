---
id: context-graph-multi-project
title: "Cross-Project Analysis & Shared Patterns"
status: open
type: feature
priority: 3
created: 2026-03-05
milestone: phase-8
deps:
  - context-graph-opcom-integration
links:
  - docs/spec/context-graph.md#phase-8
---

# Cross-Project Analysis & Shared Patterns

## Goal

When opcom manages multiple projects, enable cross-project drift analysis, shared pattern detection, and workspace-level testing health dashboard.

## Tasks

- [ ] T1: Cross-project graph linking (project A depends on project B's types)
- [ ] T2: `opcom graph drift --all` — aggregate drift across all projects
- [ ] T3: `opcom graph triage --all` — cross-project triage
- [ ] T4: Shared pattern detection — same drift pattern across projects suggests shared template
- [ ] T5: Workspace-level testing health dashboard in TUI
- [ ] T6: Tests for cross-project scenarios

## Acceptance Criteria

- Drift signals from all projects are viewable in a single ranked list
- Common patterns (e.g., "connector files are never tested") are identified across projects
- Workspace dashboard shows per-project graph health
