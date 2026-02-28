---
id: phase-2-agent-adapters
title: "Agent Adapters: Claude Code + Pi"
status: closed
type: feature
priority: 0
created: 2026-02-27
milestone: phase-2
deps: []
links:
  - docs/spec/adapters.md
  - docs/spec/normalized-events.md
---

# Agent Adapters: Claude Code + Pi

## Goal

Spawn and communicate with coding agents from opcom. Each adapter normalizes backend-specific events into NormalizedEvent.

## Tasks

### Claude Code Adapter
- [ ] Spawn `claude` subprocess with `--output-format stream-json`
- [ ] Parse NDJSON stream into NormalizedEvent (message_start/delta/end, tool_start/end)
- [ ] Handle process lifecycle (start, stop, crash recovery)
- [ ] Support `--allowedTools`, `--model`, working directory config
- [ ] Track context window usage from stream metadata
- [ ] Unit tests with fixture NDJSON streams

### Pi Coding Agent Adapter
- [ ] Integrate `@mariozechner/pi-coding-agent` createAgentSession()
- [ ] Map Pi events (agent_start/end, turn_start/end, message_start/update/end, tool_execution_start/update/end) to NormalizedEvent
- [ ] Handle auto_compaction events
- [ ] Model registry for pi-opus, pi-codex presets
- [ ] Reference: ~/projects/repos/pi-mono/packages/coding-agent/src/modes/rpc/

### Shared
- [ ] AgentAdapter interface implementation for both backends
- [ ] Event subscriber (AsyncIterable<NormalizedEvent>)
- [ ] Adapter factory: `createAdapter(backend: AgentBackend)`
- [ ] Integration tests: spawn real agent, verify event stream

## Acceptance Criteria

- Can spawn claude-code and pi agents programmatically
- Both emit identical NormalizedEvent types for equivalent actions
- Clean shutdown on stop, no zombie processes
- Tests pass with mock and real agent backends
