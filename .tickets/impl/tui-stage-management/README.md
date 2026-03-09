---
id: tui-stage-management
title: "Stages: group by feature area with review gates, not dep depth"
status: open
type: feature
priority: 2
deps:
  - plan-lifecycle
links:
  - docs/spec/orchestrator.md#plan-stages
  - docs/spec/tui.md
services:
  - core
  - cli
---

# Stages: Feature-Area Grouping with Review Gates

## Problem

Stages are meant to be review checkpoints — "do this batch of related work, pause, let me test and review, then continue." But `computeStages` groups by **dependency depth** (all no-dep tickets in stage 0, their dependents in stage 1, etc.), which produces stages like:

- Stage 0: 10 unrelated tickets across 8 tracks (geo, auth, pipeline, TUI, ...)
- Stage 1: 1 ticket that depends on one of them

That's not a reviewable batch — it's the entire plan minus one ticket. A stuck step in stage 0 (like a rebase) blocks everything in stage 1 even when the actual dep chain is clear.

### What stages should be

Stages should group **major feature areas** so the user can review a coherent chunk:

- Stage 1: "geo pipeline foundation" — geospatial-libs, h3-validation, pipeline-v2 sub-tickets
- Stage 2: "serving layer" — edge-serving, tile-warming, publish-and-serve
- Stage 3: "UI + demos" — siting-demo, data-quality-demo, geo-workbench

Each stage is a meaningful milestone. When it completes, the user tests the geo pipeline before the serving layer builds on top of it.

## Design

### Auto-stage computation (replace current)

Instead of dep-depth waves, group by **track**. Each track is already a connected component in the dep graph — it represents a feature area. Stages become:

1. Group steps by track
2. Order tracks by priority (highest-priority track first) and dependency (if track B depends on track A, A comes first)
3. Batch tracks into stages based on `maxStageSize` config (default: ~5-8 steps per stage)
4. Deps within a stage are fine — the executor already handles intra-stage ordering via `blockedBy`

### Explicit stages (keep existing)

Users can still override with explicit stage definitions in plan config. No change needed.

### TUI visibility

- Show current stage indicator on plan panel (e.g. "Stage 1/3: geo pipeline")
- Show stage boundaries in the step list (separator between stages)
- Visual indicator on steps blocked by stage gating vs blocked by deps
- Keybinding to advance stage (e.g. `A`) with confirmation
- Keybinding to view stage breakdown in plan detail

## Tasks

- [ ] Replace `computeStages` — group by track instead of dep depth
- [ ] Add stage naming (derive from track names or allow user labels)
- [ ] Add `maxStageSize` to `OrchestratorConfig` (default ~5-8)
- [ ] Add `advance_stage` command to `ClientCommand`
- [ ] Wire `advance_stage` handler in station → executor
- [ ] Show current stage indicator on plan panel
- [ ] Show stage boundaries in step list
- [ ] Visual indicator: stage-gated vs dep-blocked
- [ ] Keybinding `A` to advance stage with confirmation
- [ ] Update spec (`docs/spec/orchestrator.md#plan-stages`) to reflect track-based staging
- [ ] Tests: track-based stage computation, stage naming, advance command, TUI rendering

## Acceptance Criteria

- Auto-computed stages group related tickets (same track) together
- Each stage is a reviewable batch of work, not "everything with no deps"
- A stuck step in one track doesn't block unrelated tracks in future stages
- Plan panel shows which stage is executing, its name, and total count
- User can force-advance past a stuck stage
- Existing explicit stage definitions still work
