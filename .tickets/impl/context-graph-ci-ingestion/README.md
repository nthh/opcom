---
id: context-graph-ci-ingestion
title: "CI Result Ingestion & Test Time Series"
status: open
type: feature
priority: 1
created: 2026-03-05
milestone: phase-2
deps: []
links:
  - docs/spec/context-graph.md#phase-2
---

# CI Result Ingestion & Test Time Series

## Goal

Track test results as time series data in the context graph. Every test run (CI or local) produces a snapshot of pass/fail/skip/duration per test, linked to the commit that produced it. Enables regression detection, flaky test identification, and coverage trend tracking.

## Tasks

- [ ] T1: Add `test_results` + `run_summary` tables to schema.ts
- [ ] T2: Build pytest JSON report parser (`parsers/pytest.ts`)
- [ ] T3: Build vitest JSON parser (`parsers/vitest.ts`)
- [ ] T4: Build JUnit XML parser (`parsers/junit.ts`) — universal fallback
- [ ] T5: `context-graph ingest <file>` CLI command with auto-detection
- [ ] T6: Wire test_results to graph edges (test node → status metadata)
- [ ] T7: Add queries: new failures, flaky tests, slowest tests, coverage trend
- [ ] T8: Tests for all parsers + ingestion flow

## Acceptance Criteria

- `context-graph ingest results.json` parses pytest/vitest/JUnit output and stores per-test pass/fail/duration
- `context-graph query "SELECT * FROM test_results WHERE status='fail'"` returns failing tests
- Flaky test detection works: tests with alternating pass/fail in recent runs are flagged
- Each run is tied to a commit hash and timestamp
- Ingesting the same run twice is idempotent
