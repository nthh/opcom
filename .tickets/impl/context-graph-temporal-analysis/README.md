---
id: context-graph-temporal-analysis
title: "Commit Replay & Temporal Analysis Queries"
status: closed
type: feature
priority: 2
created: 2026-03-05
milestone: phase-3
deps:
  - context-graph-ci-ingestion
links:
  - docs/spec/context-graph.md#phase-3
---

# Commit Replay & Temporal Analysis Queries

## Goal

Wire the existing `builder.replay()` to useful analysis: churn hotspots, file coupling, velocity tracking, coverage regression detection. These are the signals that feed drift scoring.

## Tasks

- [ ] T1: Churn analysis query — files by change frequency in last N days
- [ ] T2: Coupling analysis — files that co-change in the same commit
- [ ] T3: Velocity tracking — tickets closed per week from commit messages
- [ ] T4: Coverage regression — specs that lost test coverage between runs
- [ ] T5: `context-graph churn [--since 90d]` CLI command
- [ ] T6: `context-graph coupling [--min-cochanges 3]` CLI command
- [ ] T7: Compound risk score: churn × no-test-coverage = priority
- [ ] T8: Tests for all analysis queries

## Acceptance Criteria

- `context-graph churn` lists files by change frequency with test coverage status
- `context-graph coupling` shows file pairs that change together without shared tests
- Churn data combined with test coverage produces a ranked "highest risk" list
- Replay works on repos with 1000+ commits without running out of memory
