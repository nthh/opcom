---
id: dev-startup-on-init
title: "Dev startup on init: start dev environments during first-run setup"
status: closed
type: feature
priority: 2
deps:
  - unified-init-pipeline
  - dev-command-detection
links:
  - docs/spec/environments.md#dev-startup-on-init
---

## Goal

Wire ProcessManager into the init pipeline so dev environments can be started during first-run setup. In interactive mode, prompt the user to start the dev environment after project configuration completes. In agent mode, print the dev command in the command guide output.

## Tasks

- [ ] Resolve dev command from `profile.commands.dev` or the project's services list
- [ ] Create a synthetic `ServiceDefinition` when a dev command exists but no matching service is defined
- [ ] Wire ProcessManager into the unified init pipeline
- [ ] In interactive mode, prompt to start the dev environment after project config completes
- [ ] In agent mode, include the dev command in the printed command guide
- [ ] Add tests for dev command resolution (profile command, service fallback, synthetic service)
- [ ] Add tests for interactive prompt and agent-mode output paths

## Acceptance Criteria

- Running `opcom init` in interactive mode offers to start the dev environment when a dev command is detected
- Running `opcom init` in agent mode prints the resolved dev command in the command guide
- Dev command is resolved from `profile.commands.dev` first, falling back to services list
- A synthetic `ServiceDefinition` is created when a dev command exists without a matching service
- No errors when no dev command is detected (graceful skip)
