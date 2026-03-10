---
id: tui-role-detail
title: "TUI: Show role definition details on agent focus view"
status: open
type: feature
priority: 3
deps: []
links:
  - docs/spec/roles.md
  - docs/spec/tui.md
services:
  - cli
---

# TUI: Role Detail on Agent Focus

## Problem

When viewing an agent in the focus view, the user sees the agent's session events but not which role it's operating under or what that role permits. The role defines permissions, allowed bash patterns, tools, and done criteria — all critical for understanding why an agent behaves the way it does. This information is only accessible by reading the role definition files directly.

## Goal

Surface role metadata in the agent focus view so users understand what capabilities and constraints an active agent has.

## Design

### Agent Focus Header

Add a role summary section to the agent focus view header:

```
  Agent: agent-abc123 (engineer)
  Role: engineer — "Implementation and testing"
  Permissions: read, edit, bash (npm test, npm run build, git *)
  Done: tests pass, no lint errors
```

### Role Detail Expansion

Pressing a keybinding (e.g. `R`) in agent focus expands full role details:

```
  Role: engineer
  ─────────────
  Permissions: read, edit, bash
  Allowed Bash: npm test, npm run build, git *
  Tools: Read, Edit, Write, Bash, Grep, Glob
  Done Criteria: tests pass, no lint errors
  Skills: code-review, test-writing
```

## Tasks

- [ ] Add role name to agent focus header (may already be partially shown)
- [ ] Add role summary line showing permissions and done criteria
- [ ] Add `R` keybinding to toggle expanded role detail section
- [ ] Wire role definition data into agent session or fetch from core
- [ ] Tests: role header rendering, detail expansion toggle

## Acceptance Criteria

- Agent focus view shows which role the agent is using
- Role permissions and done criteria are visible at a glance
- Full role detail is one keypress away
- Role info doesn't clutter the default view — it's a compact summary with expand option
