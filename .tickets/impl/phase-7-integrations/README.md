---
id: phase-7-integrations
title: "External Integrations: Notifications + GitHub"
status: closed
type: feature
priority: 3
created: 2026-02-27
milestone: phase-7
deps:
  - phase-3-server
  - phase-7-scheduling
links: []
---

# External Integrations: Notifications + GitHub

## Goal

Connect opcom to external services: push notifications when agents complete or need attention, sync with GitHub issues.

## Tasks

### Notifications
- [ ] Notification system: pluggable backends (Slack, Discord, Telegram, desktop)
- [ ] Configurable triggers: agent_completed, agent_error, merge_failed, all_agents_idle
- [ ] Desktop notifications (native macOS/Linux)
- [ ] Slack webhook integration
- [ ] Discord webhook integration
- [ ] Notification preferences in ~/.opcom/config.yaml

### GitHub Integration
- [ ] GitHubIssuesAdapter: sync issues ↔ WorkItem
- [ ] Map GitHub labels → priority, type
- [ ] Map GitHub milestones → parent tickets
- [ ] Auto-create PR from agent worktree on merge request
- [ ] PR description from context packet + agent summary
- [ ] `opcom github sync <project>` CLI command

### Voice Input (stretch)
- [ ] Voice transcription integration (whisper or similar)
- [ ] Voice → text → opcom command pipeline
- [ ] "Start an agent on the tile server ticket" via voice

## Acceptance Criteria

- Slack/Discord notifications fire within 5s of trigger event
- GitHub issues sync bi-directionally with WorkItem
- PR creation includes useful context from detection + agent work
