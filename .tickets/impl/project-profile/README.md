---
id: project-profile
title: "Add project profile for operational semantics"
status: closed
type: feature
priority: 2
created: 2026-03-10
deps: []
links:
  - docs/spec/config.md#project-profile
  - docs/spec/config.md#profile-schema
  - docs/spec/config.md#profile-field-mappings
  - docs/spec/config.md#profile-agent-constraints
services:
  - types
  - core
  - cli
---

# Project Profile

## Problem

`ProjectConfig` captures what a project *is* (stack, services, git) but not how to *operate* it. The test gate in the executor has no way to know that project A uses `make test-smoke` while project B uses `npm test`. Ticket frontmatter fields like `demand` or `domains` are ingested as opaque tags with no semantic meaning. Agent config files (CLAUDE.md) are detected but not parsed for enforceable constraints.

This means:
- The executor uses a generic test command instead of the project's actual fast gate
- Ticket field semantics are lost — `demand: [UC-001]` doesn't create traceability edges
- Agent constraints from CLAUDE.md are only available as raw text, not enforceable rules

## Goal

Add a `profile` section to `ProjectConfig` that stores operational semantics: build/test/deploy commands, ticket field mappings, and agent constraints. This is the bridge between "what detection found" and "how orchestration should behave."

## Design

### ProjectProfile Type

```typescript
interface ProjectProfile {
  commands?: ProfileCommands;
  fieldMappings?: FieldMapping[];
  agentConstraints?: AgentConstraints;
}

interface ProfileCommands {
  test?: string;           // fast gate command (verification pipeline)
  testFull?: string;       // full suite (stage smoke tests)
  build?: string;
  deploy?: string;
  lint?: string;
}

type FieldMappingType = "use-case" | "tag" | "link" | "ignore";

interface FieldMapping {
  field: string;           // frontmatter field name
  type: FieldMappingType;  // semantic interpretation
  pattern?: string;        // optional validation pattern
}

interface AgentConstraints {
  forbiddenCommands?: string[];
  commitRules?: string[];
  workflowRules?: string[];
}
```

### ProjectConfig Extension

```typescript
interface ProjectConfig {
  // ... existing fields ...
  profile?: ProjectProfile;
}
```

### YAML Persistence

The profile is stored inline in the existing `~/.opcom/projects/<id>.yaml`:

```yaml
id: myproject
name: myproject
path: /Users/me/projects/myproject
lastScannedAt: "2026-03-10T00:00:00Z"
stack: { ... }
profile:
  commands:
    test: "make test-smoke"
    testFull: "make test"
    build: "make build"
    deploy: "make deploy"
  fieldMappings:
    - field: demand
      type: use-case
      pattern: "UC-*"
    - field: domains
      type: tag
  agentConstraints:
    forbiddenCommands:
      - "git reset"
      - "git stash"
```

### CLI Display

`opcom status` shows profile info when present:

```
myproject  main ✓  Python + TypeScript
  Test: make test-smoke  Deploy: make deploy
  Fields: demand→use-case, domains→tag
  Constraints: 2 forbidden commands
```

### TUI Integration

Project detail view (L2) gains a profile section below the existing stack/services info:

```
  PROFILE
    Test:    make test-smoke
    Deploy:  make deploy
    Fields:  demand → use-case, domains → tag
    Agents:  2 forbidden commands, 1 commit rule
```

## Tasks

- [ ] Add `ProjectProfile`, `ProfileCommands`, `FieldMapping`, `AgentConstraints` types to `packages/types/src/project.ts`
- [ ] Add `profile?: ProjectProfile` to `ProjectConfig`
- [ ] Update config loader (`packages/core/src/config/loader.ts`) to read/write profile from project YAML
- [ ] Update `opcom status` to display profile summary
- [ ] Update TUI project detail view to show profile section
- [ ] Apply field mappings in ticket scanner — when `type: use-case`, store values in `WorkItem.links` with `use_case:` prefix instead of just `tags`
- [ ] Tests: profile round-trips through YAML save/load, field mappings affect WorkItem construction, missing profile is gracefully handled

## Acceptance Criteria

- `ProjectProfile` type exists with commands, fieldMappings, agentConstraints
- Profile persists in project YAML alongside existing fields
- `opcom status` shows profile when present
- TUI project detail shows profile section
- Field mappings of type `use-case` create proper links on WorkItems (not just tags)
- Projects without a profile are unaffected (backward compatible)
