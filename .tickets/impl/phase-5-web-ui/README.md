---
id: phase-5-web-ui
title: "Web UI Dashboard"
status: closed
type: feature
priority: 2
created: 2026-02-27
milestone: phase-5
deps:
  - phase-3-server
  - phase-4-tui-navigation
links: []
---

# Web UI Dashboard

## Goal

Browser-based dashboard served from opcom station daemon. Same data as TUI but with richer rendering.

## Tasks

- [ ] Tech selection: React + Vite (or similar lightweight SPA)
- [ ] Served from station daemon at configurable port
- [ ] WebSocket client: same protocol as TUI
- [ ] Dashboard view: projects, agents, work queue (mirrors L1)
- [ ] Project detail view: tickets, agents, stack (mirrors L2)
- [ ] Agent view: streaming output with markdown rendering, syntax highlighting
- [ ] Ticket view: rendered markdown spec with frontmatter
- [ ] Multi-agent split view: watch multiple agents side-by-side
- [ ] Agent prompt: text input to message agents
- [ ] Responsive layout for different screen sizes
- [ ] `opcom web` command to open browser to dashboard

## Acceptance Criteria

- Dashboard shows same data as TUI in real-time
- Agent streaming output renders cleanly with formatting
- Can start/stop/prompt agents from web UI
- Multiple agents viewable simultaneously
