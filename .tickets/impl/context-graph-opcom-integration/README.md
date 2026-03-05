---
id: context-graph-opcom-integration
title: "Wire context-graph into opcom Station & Context Builder"
status: open
type: feature
priority: 1
created: 2026-03-05
milestone: phase-7
deps:
  - context-graph-ci-ingestion
links:
  - docs/spec/context-graph.md#phase-7
---

# Wire context-graph into opcom Station & Context Builder

## Goal

Make graph build automatic on project add/scan, enhance context packets with structural data from the graph, and expose graph commands through opcom CLI and TUI.

## Tasks

- [ ] T1: Run `createBuilder().build()` in background after `opcom add` / `opcom scan`
- [ ] T2: Enhanced context packets — pull related files, tests, drift signals from graph
- [ ] T3: `opcom graph build/stats/drift/query` CLI commands (delegate to context-graph)
- [ ] T4: TUI L2 project detail: GRAPH section showing node counts, edge counts, drift summary
- [ ] T5: TUI L3 drill-down: browsable drift signals with severity
- [ ] T6: `opcom graph triage` / `opcom graph generate` (delegates to context-graph + LLM)
- [ ] T7: WebSocket events: `graph_built`, `drift_detected` broadcast to TUI/Web clients
- [ ] T8: Ingest test results automatically after verification pipeline runs (Stage 1 test gate → ingest into graph)
- [ ] T9: Tests for opcom integration points

## Acceptance Criteria

- `opcom add ~/projects/folia` automatically builds a graph in background
- `opcom graph stats folia` shows graph statistics
- Context packets for tickets include related files and drift signals from graph
- Verification pipeline test gate results are automatically ingested into graph
- TUI shows graph health at a glance in project detail view
