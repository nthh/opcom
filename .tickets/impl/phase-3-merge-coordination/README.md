---
id: phase-3-merge-coordination
title: "Merge Coordination"
status: closed
type: feature
priority: 1
created: 2026-02-27
milestone: phase-3
deps:
  - phase-3-server
  - phase-2-message-routing
links:
  - docs/spec/server-api.md
---

# Merge Coordination

## Goal

Serialize branch merges from agent worktrees. One merge at a time, with validation. Inspired by middleman's merger agent pattern.

## Tasks

- [ ] Merge queue: ordered list of pending merge requests
- [ ] Merge executor: checkout target, merge source, run validation
- [ ] Validation pipeline: configurable steps (typecheck, tests, lint)
- [ ] Conflict handling: report conflicts back to requesting agent or user
- [ ] Auto-merge mode: merge immediately if validation passes
- [ ] Manual-merge mode: queue for user approval
- [ ] Merge request API: POST /agents/:id/merge-request
- [ ] Merge status events: merge_queued, merge_started, merge_succeeded, merge_failed
- [ ] Worktree cleanup after successful merge

## Acceptance Criteria

- Agent working in worktree can request merge to main
- Merges serialized: no concurrent merges to same target branch
- Validation runs before merge completes
- Conflicts reported clearly with actionable info
