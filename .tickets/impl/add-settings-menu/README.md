---
id: add-settings-menu
title: Add Settings Menu
status: closed
type: feature
priority: 3
deps: []
links: []
---

## Goal

Add a settings menu to opcom that lets users view and modify workspace configuration without manually editing YAML files. This should cover core preferences like default project paths, agent defaults, notification settings, and TUI display options.

## Tasks

- [x] Define settings schema and available configuration keys
- [x] Implement `opcom settings` CLI command with list/get/set subcommands
- [x] Add TUI settings panel accessible from the dashboard
- [x] Add `e` key on plan overview screen to edit plan-specific config before execution
- [x] Persist changes back to `~/.opcom/` YAML config files
- [x] Add validation for setting values

## Acceptance Criteria

- Users can view all current settings from CLI and TUI
- Users can modify settings without hand-editing YAML
- Plan overview `e` key lets users tweak plan config (maxConcurrentAgents, backend, worktree, verification, etc.) before starting
- Plan config changes are per-plan, not global
- Invalid values are rejected with clear error messages
- Changes persist across restarts
