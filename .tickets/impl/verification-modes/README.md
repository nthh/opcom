---
id: verification-modes
title: "Per-work-item verification modes"
status: closed
type: feature
priority: 2
deps:
  - init-folder
links:
  - docs/spec/verification.md
services:
  - core
  - types
  - cli
---

# Per-Work-Item Verification Modes

## Goal

Allow individual work items to specify how they should be verified, instead of using a single project-wide verification pipeline. This enables mixed projects where code tasks use test gates while operational tasks use human confirmation or output checking.

## What Already Exists

Verification already has per-role toggling via `runTests: boolean` and `runOracle: boolean | null` on `RoleDefinition`. The resolution order is: role value (if non-null) → plan-level `VerificationConfig` → default. So a `researcher` role already skips tests and oracle. The executor stores resolved verification per step in `stepVerification: Map<string, { runTests, runOracle }>`.

## What's Missing

The existing system only has on/off toggles for two code-oriented gates. It cannot:
- **Pause for human confirmation** — no `pending-confirmation` status or TUI prompt exists
- **Check artifact existence** — no "did the agent produce a file?" check
- **Let a ticket override its own verification** — verification comes from role or plan, never from the work item frontmatter itself
- **Express intent** — `runTests: false, runOracle: false` means "skip everything," but there's no way to say "I specifically need human confirmation"

## New Behavior

Work items can specify a `verification` field in their frontmatter:

```yaml
---
id: book-tokyo-hotel
title: "Book hotel in Tokyo"
status: open
type: task
verification: confirmation
---
```

### Verification Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `test-gate` | Run project test suite (existing) | Code changes |
| `oracle` | LLM evaluates against acceptance criteria (existing) | Code or doc changes |
| `confirmation` | Human confirms done via TUI/CLI | Real-world tasks (bookings, calls) |
| `output-exists` | Check that expected file/artifact was produced | Research, reports, docs |
| `none` | Mark done on agent exit | Fire-and-forget tasks |

### Resolution Order

1. Work item `verification` field (most specific)
2. Role-level verification config (from role definition)
3. Plan-level `config.verification` (current default)
4. Global defaults (test-gate + oracle)

### Confirmation Mode

When a step's verification mode is `confirmation`:
1. Agent completes and exits
2. Step enters `pending-confirmation` status (new status)
3. TUI shows the step with a confirmation prompt
4. User presses Enter/Y to confirm, or N to reject (re-enters ready queue)
5. Step moves to `done` or back to `ready`

### Output-Exists Mode

When a step's verification mode is `output-exists`:
1. Agent completes and exits
2. Executor checks for expected output files (defined in ticket `links:` or a new `outputs:` frontmatter field)
3. If files exist and are non-empty → done
4. If missing → retry or fail

## Tasks

- [ ] Add `VerificationMode` type: `"test-gate" | "oracle" | "confirmation" | "output-exists" | "none"`
- [ ] Add optional `verification` field to `TicketFrontmatter` and `WorkItem`
- [ ] Add `"pending-confirmation"` to `StepStatus` union
- [ ] Update executor to check work item verification mode before running pipeline
- [ ] Implement confirmation mode: step pauses, emits event, waits for user input
- [ ] Implement output-exists mode: check for expected files after agent exit
- [ ] Implement none mode: skip verification entirely
- [ ] Add TUI confirmation prompt for pending-confirmation steps
- [ ] Update context builder to not inject test instructions for non-test-gate items
- [ ] Tests for each verification mode
- [ ] Tests for resolution order (item > role > plan > global)

## Acceptance Criteria

- Work item with `verification: confirmation` pauses after agent exit and waits for human confirmation
- Work item with `verification: none` marks done immediately on agent exit
- Work item with `verification: output-exists` checks for expected files
- Work item without `verification` field falls back to plan-level config
- Mixed plans work: code tasks run tests, operational tasks use confirmation, in the same plan
- `pending-confirmation` shows in TUI with clear user action
