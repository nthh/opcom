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

- [ ] Define settings schema and available configuration keys
- [ ] Implement `opcom settings` CLI command with list/get/set subcommands
- [ ] Add TUI settings panel accessible from the dashboard
- [ ] Persist changes back to `~/.opcom/` YAML config files
- [ ] Add validation for setting values

## Acceptance Criteria

- Users can view all current settings from CLI and TUI
- Users can modify settings without hand-editing YAML
- Invalid values are rejected with clear error messages
- Changes persist across restarts
