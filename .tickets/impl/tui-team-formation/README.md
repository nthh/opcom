---
id: tui-team-formation
title: "TUI: Team formation display on plan steps and ticket views"
status: open
type: feature
priority: 2
deps:
  - team-formation
links:
  - docs/spec/tui.md
  - docs/spec/orchestrator.md
services:
  - cli
---

# TUI: Team Formation Display

## Problem

Team formation defines how tickets expand into multi-agent pipelines (engineer → qa → reviewer), but the TUI has zero visibility into this. During plan execution, users see individual plan steps without understanding why a ticket spawned 3 sub-steps, which team formation was applied, or where in the pipeline a given agent sits. The `opcom teams list|show` CLI commands exist but the TUI doesn't surface any of this.

## Goal

Users can see team formation context in the TUI — which team is applied to a ticket, what the pipeline looks like, and where each step sits in that pipeline.

## Design

### Plan Step Context

On the plan panel (L2) and plan overview (L3), annotate sub-steps with their team pipeline position:

```
  ✓ implement-auth/engineer  [feature-dev 1/3]
  ● implement-auth/qa        [feature-dev 2/3]
  ○ implement-auth/reviewer  [feature-dev 3/3]
```

### Ticket Focus Enhancement

When viewing a ticket in focus view (L3), show the resolved team:

```
  Team: feature-dev (auto: type=feature)
  Pipeline: engineer → qa → reviewer
```

If the team was explicitly set via frontmatter vs auto-resolved via triggers, indicate which.

### Plan Overview

In the plan overview DAG, group sub-steps visually to show they belong to the same team expansion. Draw a bracket or indent to make the pipeline clear.

## Tasks

- [ ] Add team formation metadata to plan step rendering in plan panel
- [ ] Show pipeline position badge (e.g. `[feature-dev 2/3]`) on sub-steps
- [ ] Show resolved team info in ticket focus view (team name, resolution method, pipeline)
- [ ] Group team-expanded sub-steps visually in plan overview DAG
- [ ] Wire team data from station → TUI via WebSocket events
- [ ] Tests: team badge rendering, ticket focus team display, plan overview grouping

## Acceptance Criteria

- Plan steps that are team sub-steps show which team and their position in the pipeline
- Ticket focus view shows which team formation was applied and how it was resolved
- Plan overview groups team-expanded sub-steps visually
- Single-agent steps (solo-engineer) don't show noisy team badges
