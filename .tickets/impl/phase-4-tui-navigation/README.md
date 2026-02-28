---
id: phase-4-tui-navigation
title: "TUI Navigation: Three-Level Drill-Down"
status: closed
type: feature
priority: 0
created: 2026-02-27
milestone: phase-4
deps:
  - phase-4-tui-foundation
links:
  - docs/spec/tui.md
---

# TUI Navigation: Three-Level Drill-Down

## Goal

Implement the three-level navigation: Dashboard → Project Detail → Agent/Ticket Focus. Esc goes up, Enter goes down.

## Tasks

### Level 1: Dashboard
- [ ] Projects panel: list all projects with git state, ticket counts, last commit
- [ ] Work queue panel: priority-sorted tickets across all projects, filterable
- [ ] Agents panel: all running agents with state, duration, context %, last action
- [ ] Agent indicators under projects (show which projects have active agents)
- [ ] `w` key: start agent on selected work item
- [ ] `/` key: search/filter work queue
- [ ] `1-4` keys: filter by priority

### Level 2: Project Detail
- [ ] Ticket list: all tickets for one project, grouped by status (open → closed)
- [ ] Agent list: running agents for this project with status
- [ ] Stack panel: full detection results (languages, frameworks, infra, testing, services)
- [ ] Sub-projects list
- [ ] `d` key: start dev services
- [ ] `g` key: show git log

### Level 3: Agent Focus
- [ ] Full-screen streaming agent output
- [ ] Tool calls rendered as collapsible sections
- [ ] File edits rendered as diffs
- [ ] Test output highlighted (pass green, fail red)
- [ ] Context usage bar at bottom
- [ ] `p` key: prompt input bar
- [ ] `n/N` keys: cycle between agents
- [ ] `m` key: request merge
- [ ] Scrollback with j/k, G for bottom, g for top

### Level 3: Ticket Focus
- [ ] Ticket frontmatter rendered
- [ ] Linked spec file contents rendered (markdown)
- [ ] Dependency status shown (blocked if dep is open)
- [ ] `w` key: start agent on this ticket
- [ ] `e` key: open in $EDITOR

## Acceptance Criteria

- Can navigate all three levels with Enter/Esc
- Each level shows contextually appropriate data and keybindings
- Transitions are instant (data pre-fetched)
