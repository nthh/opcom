---
id: phase-6-oracle
title: "LLM Skill: Oracle Checking"
status: closed
type: feature
priority: 3
created: 2026-02-27
milestone: phase-6
deps:
  - phase-6-triage
links: []
---

# LLM Skill: Oracle Checking

## Goal

Verify agent work against specs and acceptance criteria. "Did the agent actually implement what the ticket asked for?"

## Tasks

- [ ] Collect oracle inputs: ticket acceptance criteria, spec requirements, git diff of agent's changes, test results
- [ ] LLM prompt: evaluate whether changes satisfy each acceptance criterion
- [ ] Per-criterion pass/fail with reasoning
- [ ] Flag gaps: criteria not addressed, unrelated changes, missing tests
- [ ] Run automatically when agent marks work as complete
- [ ] Oracle report shown in TUI agent view and ticket view
- [ ] `opcom oracle <session-id>` CLI command
- [ ] Optional: block merge until oracle passes

## Acceptance Criteria

- Oracle identifies unaddressed acceptance criteria
- Oracle flags out-of-scope changes
- False positive rate is acceptable (< 20% spurious failures)
