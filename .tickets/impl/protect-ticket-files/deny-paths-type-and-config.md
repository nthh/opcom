---
id: deny-paths-type-and-config
title: "Add denyPaths to RoleDefinition and configure engineer role"
status: closed
type: feature
priority: 1
parent: protect-ticket-files
deps: []
links:
  - docs/spec/roles.md
---

# Add denyPaths type and engineer role config

## Context Packet

**Goal:** Add a `denyPaths` field to `RoleDefinition` and configure the engineer role to deny `.tickets/**`.

**Non-Goals:** Enforcement logic — that's the next sub-ticket.

**Constraints:** Must not break existing role resolution. Field is optional (roles without denyPaths are unrestricted).

**Repo Anchors:**
- `packages/types/src/plan.ts` — RoleDefinition type (or wherever it lives)
- `packages/core/src/config/roles.ts` — role loading and resolution
- `packages/core/src/config/default-roles.ts` — built-in role definitions

**Oracle (Done When):**
- [ ] `RoleDefinition` has optional `denyPaths: string[]` field
- [ ] Engineer role includes `.tickets/**` in denyPaths
- [ ] `resolveRoleConfig()` passes denyPaths through to resolved config
- [ ] Existing roles without denyPaths continue to work

## Tasks

- [ ] Add `denyPaths?: string[]` to RoleDefinition type
- [ ] Add `.tickets/**` to engineer role's default denyPaths
- [ ] Ensure resolveRoleConfig passes denyPaths to resolved output
