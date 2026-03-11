---
id: decomposition-in-plan-create
title: "Wire ticket decomposition into plan creation flow"
status: open
type: bugfix
priority: 1
created: 2026-03-10
deps: []
links:
  - docs/spec/orchestrator.md#ticket-decomposition
  - docs/adr/003-planning-decomposition.md
services:
  - cli
  - core
---

# Wire Decomposition into Plan Creation

## Problem

The decomposition infrastructure exists (`assessDecomposition()`, `applyDecomposition()`, `writeSubTickets()` in `packages/core/src/orchestrator/decomposition.ts` and `packages/core/src/skills/planning.ts`) but `opcom plan create` never calls it. The plan creation flow goes straight from ticket loading to `computePlan()` with no decomposition check.

This caused the plan-strategy ticket (140-line spec, 6 subsystems) to be assigned as a single plan step. The agent couldn't handle the full scope in one session and produced a scope-reduced implementation.

## Goal

Wire the existing decomposition assessment into `opcom plan create` so oversized tickets are flagged (and optionally decomposed) before execution begins.

## Design

### Plan Creation Flow (Updated)

```
opcom plan create
  ↓
loadTickets()
  ↓
assessTicketsForDecomposition()     ← NEW STEP
  ↓
  if oversized tickets found:
    display warning + decomposition suggestions
    prompt: [d] decompose  [s] skip  [a] abort
  ↓
computePlan()
  ↓
savePlan()
```

### Assessment Criteria (Already Implemented)

From `assessDecomposition()`:
- Multiple providers (R2, GCS, S3, etc.) → one ticket per provider
- Types + implementation + tests → split if each is non-trivial
- TUI + backend in same ticket → split
- Spec >200 lines → probably needs decomposition
- Already has sub-tickets → skip

### Interactive Prompt

```
⚠ 2 tickets may be too large for single agent sessions:

  plan-strategy (P2)
    Spec: 140 lines across 6 subsystems
    Suggestion: split into types, parser, planner, executor, cli

  big-feature (P1)
    Spec: 250 lines, multiple providers
    Suggestion: split by provider (cf, firebase, gcp)

  [d] decompose all  [1-2] decompose specific  [s] skip  [a] abort
```

### Decomposition Modes

1. **Automatic** — `opcom plan create --decompose` runs `assessDecomposition()` + `writeSubTickets()` without prompting
2. **Interactive** (default) — display suggestions, let user choose
3. **Skip** — `opcom plan create --no-decompose` bypasses the check entirely

### TUI Integration

When creating a plan from the TUI (pressing `P`), the decomposition prompt appears as an overlay before the plan overview screen.

## Tasks

- [ ] Call `assessTicketsForDecomposition()` in `opcom plan create` after loading tickets
- [ ] Display decomposition warnings with ticket details and suggestions (deps: call-assessticketsfordecomposition-in-opcom-plan-create-after-loading-tickets)
- [ ] Add interactive prompt: decompose / skip / abort (deps: display-decomposition-warnings-with-ticket-details-and-suggestions)
- [ ] Add `--decompose` flag for automatic mode (deps: add-interactive-prompt-decompose-skip-abort)
- [ ] Add `--no-decompose` flag to skip assessment (deps: add-interactive-prompt-decompose-skip-abort)
- [ ] Wire into TUI plan creation flow (P key → decomposition overlay → plan overview) (deps: add-interactive-prompt-decompose-skip-abort)
- [ ] Tests: oversized ticket triggers warning, decompose creates sub-tickets, skip preserves original, already-decomposed tickets are skipped (deps: add-decompose-flag-for-automatic-mode, add-no-decompose-flag-to-skip-assessment, wire-into-tui-plan-creation-flow-p-key-decomposition-overlay-plan-overview)

## Acceptance Criteria

- `opcom plan create` warns about oversized tickets before creating the plan
- User can decompose, skip, or abort from the prompt
- `--decompose` auto-decomposes without prompting
- `--no-decompose` skips the check
- Already-decomposed tickets (with sub-tickets) are not flagged
- Sub-tickets created by decomposition are included in the plan
