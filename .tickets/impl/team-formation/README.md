---
id: team-formation
title: "Codified team formation for multi-agent task coordination"
status: open
type: feature
priority: 3
deps:
  - skills-packages
links:
  - docs/spec/roles.md
  - docs/spec/orchestrator.md
services:
  - core
  - types
---

# Codified Team Formation

## Goal

Define standard team compositions for different task types so the orchestrator can automatically assemble the right agents for a work item. Instead of every step using a single `engineer` role, a "launch feature X" plan step could involve engineer + qa + reviewer in sequence. Inspired by auto-co's `team` skill which selects 2-5 agents per task from a pool of 14.

## Problem

Today, each plan step gets exactly one agent with one role. The role is either specified in the ticket frontmatter or defaults to `engineer`. There's no concept of "this task needs multiple roles working together" — no engineer→qa→reviewer pipeline per ticket.

## Design

### Team Definitions

Teams are defined in `~/.opcom/teams/` or as built-ins:

```yaml
# ~/.opcom/teams/feature-dev.yaml
id: feature-dev
name: Feature Development
description: "Standard feature implementation with QA and review"
steps:
  - role: engineer
    verification: test-gate
  - role: qa
    verification: test-gate
    depends_on: engineer
  - role: reviewer
    verification: none
    depends_on: qa
triggers:
  types: [feature]
  priority_min: 1
```

```yaml
# ~/.opcom/teams/research.yaml
id: research
name: Research Task
steps:
  - role: researcher
    verification: output-exists
triggers:
  types: [research]
```

```yaml
# ~/.opcom/teams/ops-task.yaml
id: ops-task
name: Operational Task
steps:
  - role: engineer
    verification: confirmation
triggers:
  types: [task, booking, coordination]
```

### Team Resolution

When the planner creates a plan step for a ticket:

1. Check ticket frontmatter for explicit `team: feature-dev`
2. If not specified, match ticket `type` against team `triggers`
3. If no match, use single-agent default (role from ticket or `engineer`)

### Multi-Step Expansion

When a team has multiple steps, the planner expands a single ticket into a sequence of sub-steps:

```
Ticket: implement-auth (type: feature)
  → Step 1: implement-auth/engineer (engineer role, test-gate verification)
  → Step 2: implement-auth/qa (qa role, test-gate verification, blocked by step 1)
  → Step 3: implement-auth/reviewer (reviewer role, none verification, blocked by step 2)
```

Sub-steps share the same worktree. Each agent picks up where the previous left off.

### Built-in Teams

- `solo-engineer` — single engineer, test-gate (default, current behavior)
- `feature-dev` — engineer → qa → reviewer
- `research` — single researcher, output-exists
- `ops-task` — single agent, confirmation verification

### Types

```typescript
interface TeamDefinition {
  id: string;
  name: string;
  description?: string;
  steps: TeamStep[];
  triggers?: {
    types?: string[];
    priority_min?: number;
    tags?: Record<string, string[]>;
  };
}

interface TeamStep {
  role: string;
  verification?: VerificationMode;
  depends_on?: string;  // role id of preceding step
  skills?: string[];    // skills to include in context
}
```

## Tasks

- [ ] Define `TeamDefinition` and `TeamStep` types
- [ ] Implement team loading from `~/.opcom/teams/` YAML files
- [ ] Define 4 built-in teams (solo-engineer, feature-dev, research, ops-task)
- [ ] Implement team resolution (ticket frontmatter → type trigger → default)
- [ ] Implement multi-step expansion in planner (single ticket → sub-steps)
- [ ] Sub-steps share worktree and pass context forward
- [ ] Add `team` field to `TicketFrontmatter`
- [ ] Add `opcom teams [list|show]` CLI commands
- [ ] Tests for team loading, resolution, and expansion

## Acceptance Criteria

- Ticket with `team: feature-dev` expands to engineer → qa → reviewer sub-steps
- Ticket with `type: feature` auto-matches `feature-dev` team via triggers
- Ticket with no team or type match uses single-agent default
- Sub-steps execute in order with shared worktree
- Built-in teams ship with opcom
- Users can define custom teams in ~/.opcom/teams/
- `opcom teams list` shows available teams
