---
id: workspace-engine-wiring
title: "Wire WorkspaceEngine into CLI and TUI for cross-project analysis"
status: open
type: feature
priority: 3
deps:
  - context-graph-multi-project
links:
  - docs/spec/context-graph.md
  - docs/spec/tui.md
services:
  - cli
  - context-graph
---

# Wire WorkspaceEngine

## Problem

`WorkspaceEngine` in `packages/context-graph/src/core/workspace.ts` is fully implemented with cross-project analysis capabilities but has no consumer. It's exported from the package but never instantiated anywhere — no CLI command, no TUI view, no station handler.

Implemented but unused methods:

- `aggregateDrift()` — Rank drift signals across all projects
- `detectSharedPatterns()` — Find patterns appearing in 2+ projects
- `getHealth()` — Workspace-level health dashboard
- `linkProjects()` — Cross-project dependency detection

## Goal

Surface workspace-level analysis in both CLI and TUI so users managing multiple projects can see cross-cutting insights at a glance.

## Design

### CLI Commands

```
opcom workspace health     # Aggregate health across all projects
opcom workspace drift      # Cross-project drift signals ranked by severity
opcom workspace patterns   # Shared patterns detected across projects
```

### TUI Integration

Extend the health view (`H` keybinding) with a workspace tab, or add workspace health as a section on the L1 dashboard:

```
 Workspace Health
 ────────────────────────────────
 Projects: 5 registered, 4 healthy, 1 degraded

 Drift Signals (cross-project):
   ⚠ React version mismatch: folia v18.2, mtnmap v17.0
   ⚠ Node engine constraint differs: opcom >=18, remolt >=16
   ● TypeScript version aligned: all v5.3.x

 Shared Patterns:
   vitest + @testing-library — 3 projects
   turborepo monorepo — 2 projects
   Cloudflare Workers — 2 projects
```

### Station Wiring

- Instantiate `WorkspaceEngine` in station daemon with all registered projects
- Add `workspace_health` WebSocket event for TUI updates
- Refresh workspace analysis on project scan or config change

## Tasks

- [ ] Add `opcom workspace [health|drift|patterns]` CLI commands
- [ ] Wire WorkspaceEngine instantiation in station daemon (load all registered projects)
- [ ] Add `workspace_health` WebSocket event for real-time updates
- [ ] Add workspace section to L1 dashboard or extend health view (`H`) with workspace tab
- [ ] Show cross-project drift signals with severity ranking
- [ ] Show shared patterns across projects
- [ ] Refresh workspace analysis when projects are scanned or added
- [ ] Tests: CLI output, workspace health rendering, TUI display

## Acceptance Criteria

- `opcom workspace health` shows aggregate health across all projects
- `opcom workspace drift` shows cross-project drift signals ranked by severity
- `opcom workspace patterns` shows shared patterns detected across projects
- TUI surfaces workspace health — either on L1 dashboard or via health view
- Workspace analysis updates when project state changes
