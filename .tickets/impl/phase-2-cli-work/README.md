---
id: phase-2-cli-work
title: "CLI: opcom work + agent commands"
status: closed
type: feature
priority: 1
created: 2026-02-27
milestone: phase-2
deps:
  - phase-2-context-builder
links: []
---

# CLI: opcom work + agent commands

## Goal

CLI commands to start agents against work items and manage running sessions.

## Tasks

- [ ] `opcom work <project>/<ticket>` — start agent on a specific ticket with context packet
- [ ] `opcom work <project>` — start agent on highest-priority open ticket
- [ ] `opcom agent list` — show running sessions with state, duration, project, ticket
- [ ] `opcom agent stop <id>` — stop a running session
- [ ] `opcom agent prompt <id> <message>` — send message to running agent
- [ ] `opcom agent log <id>` — tail agent event log
- [ ] Backend selection: `--backend claude-code|pi` flag (default claude-code)
- [ ] Model selection: `--model opus|sonnet|codex` flag
- [ ] Worktree mode: `--worktree` flag creates git worktree for isolation
- [ ] Status output: show agent state in `opcom status` dashboard

## Acceptance Criteria

- `opcom work folia/tile-server-perf` starts an agent with full context
- `opcom agent list` shows all running agents with real-time state
- `opcom status` shows agents under their projects
