---
id: UC-005
title: "Agent Chat from Dashboard"
status: not-started
priority: P1
persona: "Developer managing agents across projects"
requires:
  specs:
    - tui
  features:
    - tui-component-model
    - tui-chat-panel
  tickets:
    - tui-component-model
    - tui-chat-panel
---

# Use Case: Agent Chat from Dashboard

## Persona

**Developer** running 1-3 agents across projects. Wants to steer agents, ask quick questions, or give follow-up instructions without leaving the dashboard context.

## Scenario

User is on the dashboard watching agents work. They see an agent is idle or heading in the wrong direction. They press `c`, type a message, and the agent receives it — no navigation required.

## Flow

### Step 1: Spot something from the dashboard

```
┌─ opcom ──────────────────────────────────────────────────────┐
│                                                               │
│  PROJECTS              │  AGENTS (2 running)                  │
│  ▸ mtnmap              │  ▸ mtnmap/auth-migration             │
│    folia               │    claude-code  idle  14m  ctx: 62%  │
│                        │    "Finished auth provider refactor"  │
│──────────────────────  │                                      │
│  WORK QUEUE            │    folia/tile-perf                    │
│  ...                   │    claude-code  streaming  3m        │
│                        │──────────────────────────────────────│
│                        │  CHAT (mtnmap/auth-migration)        │
│                        │  agent: Done. Ready for review.      │
│                        │  > _                                 │
└──────────────────────────────────────────────────────────────┘
```

### Step 2: Send a message

User presses `c` to focus chat, types a follow-up:

```
│  CHAT (mtnmap/auth-migration)                │
│  agent: Done. Ready for review.              │
│  > now add tests for the token refresh flow  │
```

Presses Enter. Agent receives the message and starts working.

### Step 3: Watch from dashboard

Chat shows the conversation while the user continues browsing projects/tickets:

```
│  CHAT (mtnmap/auth-migration)                │
│  you: now add tests for the token refresh    │
│  agent: I'll add tests for token refresh...  │
│  > _                                         │
```

### Step 4: Switch agents

User navigates to a different agent in the agents panel. Chat context switches:

```
│  CHAT (folia/tile-perf)                      │
│  agent: Running pytest tests/tiles/ -v       │
│  > _                                         │
```

## Requirements

### Must have

| Requirement | Spec | Status |
|---|---|---|
| Reusable component abstraction | `docs/spec/tui.md#component-model` | Not implemented |
| Chat panel on dashboard (L1) | `docs/spec/tui.md#chat-panel` | Not implemented |
| Chat panel on project detail (L2) | `docs/spec/tui.md#chat-panel` | Not implemented |
| Global `c` key to focus chat | `docs/spec/tui.md#chat-panel` | Not implemented |
| Chat bound to selected agent | `docs/spec/tui.md#chat-panel` | Not implemented |
| Message delivery to agent stdin | `docs/spec/tui.md#chat-panel` | Existing (agent prompt mode) |

### Nice to have

| Requirement | Spec | Status |
|---|---|---|
| Chat history persists across view switches | `docs/spec/tui.md#chat-panel` | Not implemented |
| Steer mode for streaming agents | `docs/spec/tui.md#chat-panel` | Existing (message router) |
| Start agent from chat if none running | `docs/spec/tui.md#chat-panel` | Not implemented |

## Readiness

**30%** — The underlying message delivery (agent stdin, message router) exists. What's missing is the component model to make the chat panel reusable across views, and the chat panel itself.
