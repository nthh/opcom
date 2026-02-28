---
id: phase-4-tui-agent-view
title: "TUI Agent View: Streaming + Interaction"
status: closed
type: feature
priority: 1
created: 2026-02-27
milestone: phase-4
deps:
  - phase-4-tui-navigation
links:
  - docs/spec/tui.md
  - docs/spec/normalized-events.md
---

# TUI Agent View: Streaming + Interaction

## Goal

Rich agent output rendering in the TUI. Not just raw text — structured tool calls, diffs, test results.

## Tasks

- [ ] NormalizedEvent → rendered output: message text, tool calls, errors
- [ ] Tool call rendering: name, input summary, output (collapsible)
- [ ] File edit rendering: show filename + diff-style additions/removals
- [ ] Test result rendering: pass/fail counts, highlighted failures
- [ ] Thinking/reasoning blocks: dimmed or collapsible
- [ ] Context usage: progress bar showing tokens used / max
- [ ] Streaming indicator: spinner or cursor while agent is streaming
- [ ] Prompt input: inline text input at bottom, send on Enter
- [ ] Agent state transitions: visual feedback when state changes
- [ ] Multi-agent cycling: n/N to switch between agents without going back to dashboard
- [ ] Error display: agent errors shown prominently with recovery suggestions

## Acceptance Criteria

- Agent output is readable and structured, not raw NDJSON
- Can prompt agents directly from TUI
- Context usage visible at all times
- Smooth streaming without flicker
