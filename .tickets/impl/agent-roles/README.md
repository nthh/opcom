---
id: agent-roles
title: "Agent roles: per-ticket behavioral profiles for executor agents"
status: closed
type: feature
priority: 2
deps:
  - executor-eventstore-wiring
links:
  - docs/spec/roles.md
  - docs/spec/orchestrator.md
  - docs/spec/verification.md
services:
  - types
  - core
---

# Agent roles: per-ticket behavioral profiles for executor agents

## Goal

Let tickets declare a `role` (engineer, qa, reviewer, researcher, devops) that controls the agent's permission mode, tool access, system prompt instructions, done criteria, and verification gates. Roles are YAML files in `~/.opcom/roles/`, resolved by the executor before starting a session. Adapters stay unchanged — role resolution is upstream of `AgentStartConfig`.

## Tasks

- [ ] Add types
  - [ ] Create `packages/types/src/roles.ts` with `RoleDefinition` and `ResolvedRoleConfig`
  - [ ] Add `role?: string` to `WorkItem` in `packages/types/src/work-items.ts`
  - [ ] Add `role?: string` to `TicketFrontmatter` in `packages/types/src/work-items.ts`
  - [ ] Add `role?: string` to `PlanStep` in `packages/types/src/plan.ts`
  - [ ] Export new types from `packages/types/src/index.ts`
- [ ] Add role config module
  - [ ] Add `rolesDir()` and `rolePath(id)` to `packages/core/src/config/paths.ts`
  - [ ] Create `packages/core/src/config/roles.ts` with `BUILTIN_ROLES`, `loadRole()`, `resolveRoleConfig()`, `writeBuiltinRoles()`
  - [ ] Tests for loadRole, resolveRoleConfig merge logic, writeBuiltinRoles idempotency
- [ ] Wire into ticket scanning
  - [ ] Parse `role` from frontmatter in `packages/core/src/detection/tickets.ts`
  - [ ] Test that scanned tickets carry role through to WorkItem
- [ ] Wire into executor
  - [ ] `startStep()` in `packages/core/src/orchestrator/executor.ts` calls `resolveRoleConfig()` and uses resolved config for session start
  - [ ] Role instructions and doneCriteria injected via `packages/core/src/agents/context-builder.ts`
  - [ ] Test that executor uses role-derived config instead of hardcoded values

## Acceptance Criteria

- Five built-in roles (engineer, qa, reviewer, researcher, devops) are written to `~/.opcom/roles/` on first use
- A ticket with `role: qa` produces an agent session with reviewer-appropriate permissions (no Write/Edit for reviewer, test-only edits for qa)
- A ticket with no `role` field defaults to `engineer`
- User-created role files in `~/.opcom/roles/` are loaded and respected
- Resolution order is: built-in defaults → role YAML → stack-derived tools → plan-level overrides
- Existing tests continue to pass (role changes are additive)
