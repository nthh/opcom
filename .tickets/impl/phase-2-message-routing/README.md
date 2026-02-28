---
id: phase-2-message-routing
title: "Inter-Agent Message Routing"
status: closed
type: feature
priority: 2
created: 2026-02-27
milestone: phase-2
deps:
  - phase-2-session-manager
links:
  - docs/spec/adapters.md
---

# Inter-Agent Message Routing

## Goal

Agents need to communicate: worker → merger, worker → reviewer, worker → session manager. Delivery modes handle timing.

## Tasks

- [ ] MessageRouter class: send(from, to, message, delivery)
- [ ] Delivery modes: prompt (immediate if idle), followUp (queue until turn ends), steer (inject mid-stream)
- [ ] Message queue per agent for followUp delivery
- [ ] Route agent-to-user messages (surface in TUI/Web)
- [ ] Route user-to-agent messages (from TUI prompt)
- [ ] Message log: persist inter-agent messages for debugging
- [ ] Tests: verify delivery ordering and mode behavior

## Acceptance Criteria

- Messages delivered reliably between agents
- followUp messages queued and delivered when agent becomes idle
- User can see agent-to-agent messages in the UI
