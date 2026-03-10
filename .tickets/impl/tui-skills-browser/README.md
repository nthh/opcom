---
id: tui-skills-browser
title: "TUI: Skills browser for discovering available capabilities"
status: closed
type: feature
priority: 3
deps:
  - skills-packages
links:
  - docs/spec/tui.md
services:
  - cli
---

# TUI: Skills Browser

## Problem

Skills are reusable capability packages that get injected into agent context, but users have no way to discover or inspect them from the TUI. The only way to see what skills exist is `opcom skills list` in the CLI. During plan execution, there's no indication of which skills are active for a given agent.

## Goal

Users can browse available skills from the TUI and see which skills are active on running agents.

## Design

### Skills List View

Accessible from the settings view (O keybinding) or as a sub-panel, show:

```
  Skills (5 built-in, 2 custom)
  ─────────────────────────────
  ● code-review     "Structured review methodology"         built-in
  ● test-writing    "Test strategy and patterns"             built-in
  ● deployment      "Deployment checklists per platform"     built-in
  ● research        "Multi-source research protocol"         built-in
  ● planning        "Task decomposition methodology"         built-in
  ○ my-sql-review   "SQL query review for Turso/Neon"        custom
  ○ ios-release     "iOS OTA release checklist"              custom
```

`●` = active for current project/agent, `○` = available but not triggered.

### Agent Focus Enhancement

In the agent focus view (L3), show which skills were included in the agent's context packet:

```
  Skills: code-review, test-writing
```

## Tasks

- [ ] Add skills list as a section in settings view or as a new focus view
- [ ] Show built-in vs custom, active vs available status
- [ ] Show active skills on agent focus view
- [ ] Wire skill data from station → TUI
- [ ] Tests: skills list rendering, active skill display on agent focus

## Acceptance Criteria

- Users can browse all available skills from the TUI
- Built-in and custom skills are visually distinguished
- Agent focus view shows which skills were injected into that agent's context
- Skills that match the current project/ticket are highlighted
