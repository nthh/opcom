---
id: phase-2-context-builder
title: "Context Builder"
status: closed
type: feature
priority: 1
created: 2026-02-27
milestone: phase-2
deps:
  - phase-2-session-manager
links:
  - docs/spec/adapters.md
---

# Context Builder

## Goal

Assemble context packets from project detection + ticket + spec so agents start with full project knowledge. No manual onboarding.

## Tasks

- [ ] ContextPacket type: project profile, work item, spec contents, git state, agent config, memory
- [ ] Build context from ProjectConfig + WorkItem: load ticket frontmatter, read linked spec files, include CLAUDE.md
- [ ] Inject context into Claude Code adapter (augment system prompt or prepend to conversation)
- [ ] Inject context into Pi adapter (system prompt configuration)
- [ ] Include testing/linting commands so agent knows how to verify its work
- [ ] Include service definitions so agent knows the runtime topology
- [ ] Handle missing data gracefully (no spec file, no CLAUDE.md, etc.)
- [ ] Unit tests: verify context packet assembly for each project type

## Acceptance Criteria

- Agent receives project stack, ticket detail, spec contents, and testing commands without user intervention
- Works for projects with and without tickets/specs
- Context is concise (not dumping entire files, just what's relevant)
