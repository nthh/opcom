---
id: ticket-status-not-committed
title: "Bug: ticket status changes not committed after plan step completion"
status: closed
type: bug
priority: 1
links:
  - docs/spec/verification.md
services:
  - core
---

# Bug: ticket status changes not committed after plan step completion

## Problem

When a plan step completes in worktree mode, the executor calls `updateTicketStatusSafe()` which writes the ticket frontmatter (e.g. `status: open` -> `status: closed`) on the **main tree**. But it never stages or commits this change. The file modification is left as uncommitted dirty state.

The merge commit only includes changes from the worktree branch. The ticket status write happens *after* the merge, directly on the main tree filesystem. Nobody commits it.

This means:
- `git status` shows dirty ticket files after plan execution
- The status change is lost on `git checkout` or `git stash`
- Other worktree merges may be blocked by the uncommitted changes

## Root Cause

`executor.ts:1314-1323` — `updateTicketStatus()` does `writeFile()` but no `git add` / `git commit`.

`executor.ts:578-580` — called after worktree cleanup, after merge is already done:
```typescript
if (this.plan.config.ticketTransitions) {
  await this.updateTicketStatusSafe(step, "closed");
}
```

## Fix

After writing the ticket status change, stage and commit it:

```typescript
private async updateTicketStatusSafe(step: PlanStep, newStatus: string): Promise<void> {
  try {
    const project = await loadProject(step.projectId);
    if (!project) return;
    const tickets = await scanTickets(project.path);
    const ticket = tickets.find((t) => t.id === step.ticketId);
    if (ticket) {
      await updateTicketStatus(ticket.filePath, newStatus);
      // Stage and commit the ticket status change
      await execFileAsync("git", ["add", ticket.filePath], { cwd: project.path });
      await execFileAsync("git", [
        "commit", "-m", `chore: close ${step.ticketId}`,
      ], { cwd: project.path });
    }
  } catch (err) {
    log.warn("failed to update ticket status", { ticketId: step.ticketId, error: String(err) });
  }
}
```

Consider batching: if multiple steps complete in quick succession, batch ticket status commits into a single commit rather than one per step.

## Acceptance Criteria

- Ticket status changes are committed to git after plan step completion
- `git status` is clean after plan execution completes
- No uncommitted ticket file modifications left behind
