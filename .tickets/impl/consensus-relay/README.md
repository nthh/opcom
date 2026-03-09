---
id: consensus-relay
title: "Mutable project summary document for cross-session context"
status: closed
type: feature
priority: 2
deps: []
links:
  - docs/spec/adapters.md
  - docs/spec/config.md
services:
  - core
---

# Mutable Project Summary Document for Cross-Session Context

## Goal

Add a mutable "consensus" summary document per project that agents read at session start and update at session end. This gives incoming agents immediate context about project state without replaying the event store. Inspired by auto-co's `consensus.md` relay pattern.

## Problem

Today, agents start cold. The context packet includes stack info, ticket content, and spec — but not "what happened recently." If Agent A finished a feature and Agent B starts on a related ticket, Agent B has no idea what A did unless the human explains it. The event store has the data, but it's append-only and expensive to replay into a context window.

## Design

### Summary File

Each project gets a `summary.md` in its project directory (or `.opcom/summaries/<project-id>.md`):

```markdown
# Project Summary

## Current State
- Phase: Building
- Last activity: 2026-03-08T14:30:00Z
- Active work: auth-migration (in-progress), offline-sync (ready)

## Recent Completions
- tile-server-perf: completed 2026-03-07, optimized query pipeline (3x speedup)
- fix-login-redirect: completed 2026-03-06, fixed OAuth callback race condition

## Key Decisions
- Switched from REST to tRPC for internal APIs (2026-03-05)
- Adopted Drizzle ORM over Prisma for edge compatibility (2026-03-04)

## Open Questions
- Should we migrate auth to Clerk or keep Firebase Auth?
- Performance budget for initial page load — 2s or 3s target?

## Next Priority
P0 auth-migration — blocking three other tickets
```

### Lifecycle

1. **On agent start**: summary.md contents are included in the context packet (new `summary` field on `ContextPacket`)
2. **On agent completion**: executor updates summary.md with what changed — completed tickets, key decisions, new state
3. **On plan completion**: full summary rewrite with stage results
4. **Manual edit**: user can edit summary.md directly to inject context

### Atomic Writes

Write to `.summary.tmp` then rename to `summary.md` to prevent corruption if the process crashes mid-write (same pattern as auto-co).

### Context Packet Integration

```typescript
interface ContextPacket {
  // ... existing fields ...
  summary?: string;  // contents of project summary.md
}
```

The context builder reads `summary.md` and includes it as a `## Project Summary` section in the rendered context. This gives agents a narrative understanding of recent project activity without replaying events.

### Update Logic

The executor calls `updateProjectSummary()` after each step completion:

```typescript
async function updateProjectSummary(
  projectId: string,
  completedStep: PlanStep,
  plan: Plan,
): Promise<void> {
  // Read existing summary
  // Append completed step to "Recent Completions"
  // Update "Current State" with plan status
  // Update "Next Priority" with next ready step
  // Atomic write
}
```

For richer updates (key decisions, open questions), the oracle or a dedicated summarizer agent could produce a more nuanced summary after each stage.

## Tasks

- [ ] Define summary.md format and location convention
- [ ] Add `summary?: string` to `ContextPacket`
- [ ] Implement `readProjectSummary()` and `updateProjectSummary()` in core
- [ ] Integrate into context builder — include summary in rendered context
- [ ] Update executor to call `updateProjectSummary()` after step completion
- [ ] Implement atomic write (tmp + rename)
- [ ] Create initial summary on `opcom init` (from project description)
- [ ] Tests for summary read/write/update lifecycle

## Acceptance Criteria

- Agent context packet includes project summary when summary.md exists
- Summary is updated after each step completion with what changed
- Summary survives process crashes (atomic write)
- `opcom init` creates initial summary from project description
- Summary is human-readable and hand-editable
