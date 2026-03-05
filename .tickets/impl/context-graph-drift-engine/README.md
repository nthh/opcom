---
id: context-graph-drift-engine
title: "Composite Drift Detection Engine"
status: open
type: feature
priority: 1
created: 2026-03-05
milestone: phase-4
deps:
  - context-graph-ci-ingestion
  - context-graph-temporal-analysis
links:
  - docs/spec/context-graph.md#phase-4
---

# Composite Drift Detection Engine

## Goal

Upgrade drift detection from simple queries to a scored, prioritized engine. Each drift signal gets a severity score combining multiple factors (churn, test results, spec importance). Output is a ranked list of actionable gaps — the input for LLM triage.

## Tasks

- [ ] T1: Define DriftSignal interface with severity scoring
- [ ] T2: Implement 9 signal types: spec_no_tests, file_no_tests, test_regression, flaky_test, stale_assertion, coupling_gap, churn_untested, ticket_no_spec, orphan_code
- [ ] T3: Composite severity scoring: base severity × contextual multipliers (churn rate, spec reference count, co-change frequency)
- [ ] T4: Attach context to each signal (spec content, code content, test content) for LLM consumption
- [ ] T5: `context-graph drift --json` for machine-readable output
- [ ] T6: `context-graph drift --type <type> --min-severity <N>` filtering
- [ ] T7: Suggested action field per signal (write_test, update_spec, update_test, ignore)
- [ ] T8: Tests for scoring, ranking, and all 9 signal types

## Acceptance Criteria

- `context-graph drift` outputs signals ranked by composite severity score
- High-churn untested files rank higher than low-churn untested files
- Test regressions always rank as high severity
- `--json` output includes full context for each signal (for LLM consumption)
- Each signal includes a suggested action
