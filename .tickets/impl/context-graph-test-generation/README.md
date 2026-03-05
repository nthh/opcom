---
id: context-graph-test-generation
title: "AI Test Generation from Triage Results"
status: open
type: feature
priority: 2
created: 2026-03-05
milestone: phase-6
deps:
  - context-graph-llm-triage
links:
  - docs/spec/context-graph.md#phase-6
---

# AI Test Generation from Triage Results

## Goal

When triage identifies a real gap, an LLM agent generates tests. It receives spec content, implementing code, existing tests, and test hints — then writes new tests using the project's framework. Generated tests go through human review.

## Tasks

- [ ] T1: Test generation context packet: spec + code + existing tests + hints
- [ ] T2: Generation prompt template — produces test code with spec section references
- [ ] T3: Test type classification: assertion, snapshot, benchmark (stored in graph meta)
- [ ] T4: `context-graph generate-tests --dry-run` — show what would be generated
- [ ] T5: `context-graph generate-tests` — write tests to files
- [ ] T6: `context-graph generate-tests --pr` — create branch + open PR
- [ ] T7: Feedback loop: record approved/modified/rejected outcomes in graph
- [ ] T8: Test preferences file (`~/.context/<project>/test-preferences.md`) for few-shot learning
- [ ] T9: Integration with opcom work items — generation creates tickets that agents work on
- [ ] T10: Tests with mocked LLM + fixture projects

## Acceptance Criteria

- Generated tests use the correct framework (pytest for Python, vitest for TS)
- Each generated test includes a comment referencing the spec section it covers
- `--dry-run` shows the test plan without writing files
- `--pr` creates a branch and opens a PR (requires gh CLI)
- Rejected test reasons are stored for triage refinement
- Generated tests actually pass when run (verified by test gate)
