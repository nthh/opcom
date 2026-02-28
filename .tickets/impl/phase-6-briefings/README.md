---
id: phase-6-briefings
title: "LLM Skill: Briefing Generation"
status: closed
type: feature
priority: 2
created: 2026-02-27
milestone: phase-6
deps:
  - phase-3-server
links: []
---

# LLM Skill: Briefing Generation

## Goal

"What happened since yesterday?" — LLM summarizes git activity, ticket state changes, and agent completions across all projects.

## Tasks

- [ ] Collect signals: git log since last briefing, ticket status changes, agent session summaries
- [ ] Format signal data as structured context for LLM
- [ ] LLM prompt: generate concise briefing from signals
- [ ] `opcom briefing` CLI command
- [ ] Briefing displayed in TUI as overlay or dedicated view
- [ ] Configurable briefing scope: all projects, one project, time range
- [ ] Cache/persist briefings in ~/.opcom/briefings/

## Acceptance Criteria

- `opcom briefing` produces a useful 1-page summary of recent activity
- Covers git commits, ticket progress, agent work across all projects
- Takes < 10s to generate
