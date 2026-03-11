---
id: cli-assessment-wiring
title: "Wire decomposition assessment into opcom plan create CLI"
status: closed
type: feature
priority: 1
parent: decomposition-in-plan-create
deps: []
links:
  - docs/spec/orchestrator.md#ticket-decomposition
---

# Wire decomposition into plan create CLI

## Context Packet

**Goal:** Call `assessTicketsForDecomposition()` during `opcom plan create`, display warnings, and let the user decompose, skip, or abort. Add `--decompose` and `--no-decompose` flags.

**Non-Goals:** TUI integration — separate sub-ticket.

**Constraints:** Must work in non-interactive mode (CI) with `--decompose` flag.

**Repo Anchors:**
- `packages/cli/src/commands/plan.ts` — `opcom plan create` command
- `packages/core/src/orchestrator/decomposition.ts` — `assessTicketsForDecomposition()`, `writeSubTickets()`
- `packages/core/src/skills/planning.ts` — `generateDecomposition()`, `formatDecompositionPrompt()`

**Oracle (Done When):**
- [ ] `opcom plan create` warns about oversized tickets before creating plan
- [ ] Interactive prompt: [d] decompose / [s] skip / [a] abort
- [ ] `--decompose` auto-decomposes without prompting
- [ ] `--no-decompose` skips assessment entirely
- [ ] Already-decomposed tickets (with sub-ticket files) are not flagged
- [ ] Sub-tickets created by decomposition appear in the resulting plan

## Tasks

- [ ] Call assessTicketsForDecomposition after loading tickets in plan create
- [ ] Display warnings with ticket details and decomposition suggestions
- [ ] Add interactive prompt with decompose/skip/abort options
- [ ] Add --decompose and --no-decompose CLI flags
- [ ] Re-scan tickets after decomposition so new sub-tickets enter the plan
