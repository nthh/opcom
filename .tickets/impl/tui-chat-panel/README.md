---
id: tui-chat-panel
title: "TUI: Chat Panel for Agent Interaction"
status: closed
type: feature
priority: 1
created: 2026-03-08
deps:
  - tui-component-model
links:
  - docs/spec/tui.md#chat-panel
services:
  - cli
---

# TUI: Chat Panel for Agent Interaction

## Problem

To talk to an agent, you must navigate to Agent Focus (Level 3) and press `p`. This takes you away from the dashboard context — you lose sight of other projects, tickets, and agents. The most common interaction (telling an agent what to do) requires the most navigation.

## Goal

Add a persistent chat panel to the dashboard (L1) and project detail (L2) screens so users can message agents without leaving their current view.

## Tasks

- [ ] Implement `ChatComponent` following `TuiComponent` interface
  - Chat history display (scrollable, last N messages)
  - Input line with cursor at bottom
  - Agent binding (follows selected agent in agents panel)
  - Empty state when no agent selected
- [ ] Update `getLayout()` in `layout.ts` to allocate chat panel in right column
  - L1: right column splits — agents top, chat bottom
  - L2: right column adds chat below existing panels
- [ ] Add `c` global keybinding to focus chat panel from any component
- [ ] Wire message sending to existing agent prompt mechanism (`chat_ticket` / stdin)
  - Use `prompt` delivery for idle agents
  - Use `steer` delivery for streaming agents
- [ ] Extract chat messages from agent event stream (filter `message_start`/`message_delta` events for display)
- [ ] Handle edge cases:
  - Agent stops mid-conversation — show status, allow restart via `w`
  - Agent switches — swap chat history
  - Terminal too small — hide chat panel, show only on focus
- [ ] Tests: chat rendering, message send/receive, agent binding, focus management

## Acceptance Criteria

- Chat panel visible on dashboard and project detail screens
- Pressing `c` from anywhere focuses the chat panel
- Typing a message and pressing Enter delivers it to the selected agent
- Agent responses appear in the chat panel in real-time
- Switching selected agent in agents panel switches chat context
- Chat history persists when switching between views
- Works for both idle agents (prompt) and streaming agents (steer)
