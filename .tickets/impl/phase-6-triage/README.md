---
id: phase-6-triage
title: "LLM Skill: Triage + Priority Recommendations"
status: closed
type: feature
priority: 2
created: 2026-02-27
milestone: phase-6
deps:
  - phase-6-briefings
links: []
---

# LLM Skill: Triage + Priority Recommendations

## Goal

"What should I work on next?" — LLM analyzes ticket priorities, dependency chains, git staleness, spec coverage, and agent availability to recommend next actions.

## Tasks

- [ ] Collect triage inputs: open tickets with priorities and deps, git staleness per project, spec coverage gaps, current agent workload
- [ ] LLM prompt: recommend top 3-5 actions with reasoning
- [ ] Consider dependency chains (don't recommend blocked tickets)
- [ ] Consider agent capacity (don't overload one project)
- [ ] `opcom triage` CLI command
- [ ] Triage recommendations in TUI work queue (suggested badge)
- [ ] Auto-triage option: run on `opcom status` and highlight recommendations

## Acceptance Criteria

- Triage recommendations are sensible given ticket state and priorities
- Blocked tickets never recommended
- Reasoning is transparent (shows why each action was recommended)
