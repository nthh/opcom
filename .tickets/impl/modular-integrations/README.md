---
id: modular-integrations
title: "Integration registry: configurable feature modules"
status: open
type: feature
priority: 2
created: 2026-03-06
deps: []
links:
  - docs/spec/adapters.md
---

# Integration registry: configurable feature modules

## Goal

Make opcom integrations configurable per workspace. Each integration (work sources, notifications, CI/CD, context-graph, etc.) should be a feature module that can be enabled/disabled from config. The station and TUI should only load and display what's active.

## Motivation

Today all adapters are compiled in and instantiated based on detection. There's no way to:
- Disable an integration you don't use (e.g., Jira when you only use .tickets)
- Enable an integration that isn't auto-detected (e.g., GitHub Issues for a project)
- See which integrations are active or configure them from the TUI
- Add a new integration category without touching station/TUI wiring code

## Design

Workspace config (`~/.opcom/config.yaml`) gains an `integrations` section:

```yaml
integrations:
  work-sources: [tickets, github-issues]
  notifications: [slack]
  cicd: [github-actions]
  agent-backends: [claude-code]
  context-graph: true
```

Each module implements a common interface:
- `id` — unique key (e.g., `github-issues`, `slack`)
- `category` — work-sources | notifications | cicd | agent-backends | features
- `init(config)` — called on station start if enabled
- `teardown()` — called on station stop

A registry maps category+id to the module. Station reads config, activates what's listed.

## Tasks

- [ ] T1: Define `IntegrationModule` interface and `IntegrationRegistry` class
- [ ] T2: Refactor existing adapters (Jira, Slack, GitHub Actions, etc.) to implement the interface
- [ ] T3: Add `integrations` section to workspace config schema + defaults
- [ ] T4: Station reads config and only initializes enabled modules
- [ ] T5: `opcom integrations list` CLI command — shows available/active modules
- [ ] T6: `opcom integrations enable/disable <id>` CLI commands
- [ ] T7: TUI settings panel shows integration status with enable/disable
- [ ] T8: Per-project overrides — project config can override workspace defaults
- [ ] T9: Tests for registry, config loading, enable/disable lifecycle

## Acceptance Criteria

- Integrations not listed in config are not loaded (no Jira polling if not configured)
- `opcom integrations list` shows all available modules with active/inactive status
- Enabling/disabling an integration persists to config and takes effect on next station start
- Adding a new integration only requires implementing the interface and registering it
- Existing behavior is preserved — default config enables everything that was previously always-on
