---
id: tui-integration
title: "Wire decomposition into TUI plan creation flow"
status: closed
type: feature
priority: 2
parent: decomposition-in-plan-create
deps:
  - cli-assessment-wiring
links:
  - docs/spec/orchestrator.md#ticket-decomposition
  - docs/spec/tui.md
---

# TUI decomposition integration

## Context Packet

**Goal:** When creating a plan from the TUI (pressing P), show a decomposition overlay before the plan overview if oversized tickets are detected.

**Non-Goals:** CLI prompt logic — already done in cli-assessment-wiring.

**Constraints:** Must use existing TUI overlay patterns. Non-blocking — user can skip.

**Repo Anchors:**
- `packages/cli/src/tui/` — TUI components
- `packages/cli/src/tui/plan-overview.ts` — plan creation flow

**Oracle (Done When):**
- [ ] P key in TUI triggers decomposition check before plan overview
- [ ] Overlay shows oversized tickets with decompose/skip options
- [ ] After decompose, plan overview reflects new sub-tickets

## Tasks

- [ ] Add decomposition overlay component
- [ ] Wire into P key flow before plan overview
- [ ] Handle decompose and skip actions
