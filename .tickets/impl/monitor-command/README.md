---
id: monitor-command
title: "opcom monitor: live CLI dashboard for plan execution"
status: closed
type: feature
priority: 2
deps:
  - event-store
  - orchestrator-plan-engine
links:
  - docs/spec/config.md#monitor-command
---

## Goal

Add an `opcom monitor` CLI command that provides a live terminal dashboard showing plan execution status at a glance. It reads plan state from YAML and events from the SQLite events.db to display plan progress, active agents, recent events, and errors/stalls in a compact CLI view. Supports an `--once` mode for non-interactive (agent-friendly) usage.

## Tasks

- [ ] Implement `opcom monitor` command entry point with flag parsing (`--plan`, `--agents`, `--errors`, `--once`)
- [ ] Build plan progress section: steps done / in-progress / ready counts from plan YAML
- [ ] Build active agents section: agent name, duration, and event counts from events.db
- [ ] Build recent events stream section: last N events from events.db
- [ ] Build errors/stalls section: filter events for errors and stall detections
- [ ] Implement 2-second refresh loop for default (live) mode
- [ ] Implement `--once` mode: print snapshot and exit (suitable for piping or agent consumption)
- [ ] Add flag filters: `--plan` (plan-only), `--agents` (agents-only), `--errors` (errors-only)
- [ ] Wire into CLI command registry
- [ ] Add tests for monitor output formatting and flag behavior
- [ ] Link to config spec monitor-command section

## Acceptance Criteria

- `opcom monitor` displays a live-refreshing (2s) dashboard with plan progress, active agents, recent events, and errors
- `--once` flag prints the dashboard once and exits with code 0
- `--plan`, `--agents`, `--errors` flags filter output to the relevant section
- Reads plan state from plan YAML files and event data from events.db SQLite
- Works correctly when no plan is active (shows empty/no-plan message)
- `--once` output is plain text suitable for agent consumption (no ANSI escape codes that break parsing)
