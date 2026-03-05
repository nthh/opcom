---
id: context-graph-llm-triage
title: "LLM Drift Triage Agent"
status: open
type: feature
priority: 2
created: 2026-03-05
milestone: phase-5
deps:
  - context-graph-drift-engine
links:
  - docs/spec/context-graph.md#phase-5
---

# LLM Drift Triage Agent

## Goal

When drift signals exceed a threshold, an LLM triages them: is this gap real or expected? What's the right action? What priority? This filters the noise (34 "untested files" becomes 5 actionable test gaps) and produces structured output for test generation.

## Tasks

- [ ] T1: Triage prompt template — drift signals + context → structured output
- [ ] T2: TriageResult interface: verdict, action, priority, reasoning, testHints
- [ ] T3: `context-graph triage` command — reads drift, calls LLM, outputs results
- [ ] T4: Model selection: Haiku for classification, configurable via `--model`
- [ ] T5: Batch processing — triage top N signals in one LLM call (cheaper than N calls)
- [ ] T6: Triage → ticket creation (P1 results auto-create opcom tickets)
- [ ] T7: Triage history — store results so we don't re-triage the same signal
- [ ] T8: Tests with mocked LLM responses

## Acceptance Criteria

- `context-graph triage` filters 34 drift signals down to ~5 actionable items
- __init__.py and similar expected-untested files are correctly classified as "expected"
- P1 triage results include concrete test hints (what to test, not just "write a test")
- Triage results are stored and don't re-trigger for already-triaged signals
- Works with Anthropic API (ANTHROPIC_API_KEY env var)
