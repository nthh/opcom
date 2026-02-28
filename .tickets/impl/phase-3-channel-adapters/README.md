---
id: phase-3-channel-adapters
title: "Channel Adapters: Slack, WhatsApp, Telegram"
status: closed
type: feature
priority: 1
created: 2026-02-27
milestone: phase-3
deps:
  - phase-3-server
links:
  - docs/spec/server-api.md
---

# Channel Adapters: Slack, WhatsApp, Telegram

## Goal

Interact with opcom from messaging apps. Not just notifications — full bidirectional control. Start agents, check status, approve merges, all from Slack/WhatsApp/Telegram.

## Why

Developers already live in Slack and messaging apps. The TUI is for focused work at the desk. Messaging is for quick checks, mobile access, and async updates. middleman proved this pattern works with Slack and Telegram integrations.

## Architecture

Each messaging platform is a "channel adapter" — a client that connects to the station daemon just like the TUI or Web UI. The station daemon routes commands identically regardless of source.

```
Channel Adapter Interface:
  - receiveMessage(channel, user, text) → parse into opcom command
  - sendMessage(channel, user, text) → format response for platform
  - sendRichMessage(channel, user, blocks) → platform-specific rich formatting
```

Commands are natural language, parsed into opcom operations:
- "status" / "what's going on" → project status summary
- "status folia" → single project detail
- "work on mtnmap/auth-migration" → start agent
- "agents" / "what's running" → list active agents
- "stop the folia agent" → stop session
- "approve merge" → merge approval (in reply thread)

## Tasks

### Core Channel Router
- [ ] ChannelAdapter interface: receive, send, sendRich
- [ ] Command parser: natural language → opcom commands (simple pattern matching, not LLM)
- [ ] Response formatter: opcom data → platform-appropriate text/blocks
- [ ] Source tracking: know which channel/thread originated each command
- [ ] Reply threading: agent updates go to the thread that started the agent
- [ ] Per-channel config in ~/.opcom/channels/

### Slack
- [ ] Slack Bot (Socket Mode or Events API)
- [ ] Slash commands: `/opcom status`, `/opcom work folia/ticket`
- [ ] Rich message formatting with Slack blocks (status tables, diffs, buttons)
- [ ] Thread-based agent updates (start agent in a thread, updates flow there)
- [ ] Interactive buttons: approve merge, stop agent, view diff
- [ ] App Home tab: workspace dashboard
- [ ] OAuth install flow
- [ ] Config: ~/.opcom/channels/slack.yaml (bot token, channels)

### WhatsApp
- [ ] WhatsApp Business API (or Meta Cloud API)
- [ ] Text commands: parse natural language messages
- [ ] Formatted responses (bold, code blocks via WhatsApp markdown)
- [ ] Agent completion notifications
- [ ] Config: ~/.opcom/channels/whatsapp.yaml (phone number, API token)

### Telegram
- [ ] Telegram Bot API (long polling or webhook)
- [ ] Bot commands: /status, /work, /agents, /stop
- [ ] Inline keyboards for interactive actions (approve/reject merge)
- [ ] Formatted responses (Telegram markdown/HTML)
- [ ] Agent completion notifications
- [ ] Config: ~/.opcom/channels/telegram.yaml (bot token)

### Discord (bonus)
- [ ] Discord Bot with slash commands
- [ ] Rich embeds for status, agent output
- [ ] Thread-based agent tracking

## Example Flows

### Slack: Morning check-in
```
You:     /opcom status
opcom:   ┌ personal workspace ─────────────┐
         │ mtnmap    main ✓   25 tickets    │
         │ folia     main ✓   35 tickets    │
         │ conversi  main ✓   0 tickets     │
         │ 0 agents running                  │
         └──────────────────────────────────┘
```

### Slack: Start work from phone
```
You:     work on folia/tile-server-perf
opcom:   Starting claude-code on folia/tile-server-perf...
         Context: Python+Docker, P1 feature, spec loaded
         I'll update this thread with progress.

... 15 min later (in same thread) ...

opcom:   ✅ Agent completed folia/tile-server-perf
         8 files changed, 2 new, all tests pass
         [Approve Merge] [View Diff] [Stop]
```

### WhatsApp: Quick check while commuting
```
You:     what's running?
opcom:   *2 agents active*

         🤖 mtnmap/auth-migration
         claude-code · streaming · 14m
         Currently editing auth/provider.tsx

         🤖 folia/change-detection
         pi-opus · idle · 22m
         Waiting for review
```

### Telegram: Approve merge
```
opcom:   Agent completed folia/tile-server-perf
         8 files changed, tests pass

         [✅ Approve] [📄 Diff] [❌ Reject]

You:     [taps ✅ Approve]

opcom:   ✅ Merged to main (commit abc1234)
```

## Acceptance Criteria

- Can check status, start agents, and approve merges from Slack
- Agent updates flow to the originating Slack thread
- WhatsApp and Telegram work for basic commands (status, work, agents, stop)
- Same command produces same result regardless of channel
- Channel config is simple (bot token + channel selection)
