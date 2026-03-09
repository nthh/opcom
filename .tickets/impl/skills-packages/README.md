---
id: skills-packages
title: "Skills as reusable capability packages, separate from roles"
status: open
type: feature
priority: 3
deps: []
links:
  - docs/spec/roles.md
  - docs/spec/adapters.md
services:
  - core
  - types
---

# Skills as Reusable Capability Packages

## Goal

Separate "skills" (how to do something) from "roles" (who does it). Today, role-specific knowledge is embedded in `RoleDefinition.instructions`. Skills should be standalone, composable capability packages that any role can invoke. Inspired by auto-co's 37-skill arsenal where agents pick the right skill for the task.

## Problem

Opcom's `RoleDefinition` conflates identity with capability. The `engineer` role has inline instructions about testing and committing. But what about deployment knowledge? Research methodology? Pricing analysis? These are cross-cutting capabilities that shouldn't be owned by a single role.

Auto-co demonstrates the power of separation: 14 agent personas x 37 skills = flexible capability matrix. Any agent can invoke any skill. Skills are versioned, documented, and composable.

## Design

### Skill Structure

Skills live in `~/.opcom/skills/<skill-id>/` (user-defined) or ship as built-ins:

```
~/.opcom/skills/
├── deep-research/
│   ├── SKILL.md          # Main capability definition
│   ├── references/       # Supporting docs, examples
│   └── templates/        # Output templates
├── deployment/
│   ├── SKILL.md
│   └── references/
│       ├── vercel.md
│       ├── railway.md
│       └── cloudflare.md
└── code-review/
    └── SKILL.md
```

### SKILL.md Format

```yaml
---
name: deep-research
description: "Multi-source research with citation verification"
version: 1.0.0
triggers:
  - "research"
  - "investigate"
  - "analyze market"
compatible-roles:
  - researcher
  - engineer
  - planner
---

# Deep Research Skill

## When to Use
Use this skill when a ticket requires gathering information from multiple sources,
comparing options, or producing a research report.

## Process
1. Define research questions from the ticket
2. Search multiple sources (web, docs, code)
3. Cross-reference findings
4. Produce structured report with citations

## Output Format
...

## Anti-Patterns
- Don't research indefinitely — cap at 3 search rounds
- Don't present raw search results — synthesize
...
```

### Skill Resolution

When building a context packet, the context builder:
1. Reads the work item's `type` and `tags`
2. Matches against skill `triggers`
3. Includes matched skill content in the context packet
4. Role can also explicitly declare `skills: [deep-research, code-review]`

### Built-in Skills

Ship with opcom:
- `code-review` — structured review methodology
- `test-writing` — test strategy and patterns
- `deployment` — deployment checklists per platform
- `research` — multi-source research protocol
- `planning` — task decomposition methodology

### User-Defined Skills

Users create skills in `~/.opcom/skills/` following the same format. Skills are project-agnostic by default but can be scoped to specific projects via `projects:` in frontmatter.

### Context Packet Integration

```typescript
interface ContextPacket {
  // ... existing fields ...
  skills?: Array<{
    name: string;
    content: string;  // rendered SKILL.md
  }>;
}
```

## Tasks

- [ ] Define `SkillDefinition` type (id, name, description, version, triggers, compatible-roles, content)
- [ ] Define skill directory structure convention
- [ ] Implement `loadSkill()` and `listSkills()` in core
- [ ] Implement skill matching (work item type/tags → matching skills)
- [ ] Add `skills` field to `ContextPacket`
- [ ] Update context builder to include matched skills
- [ ] Ship 3-5 built-in skills
- [ ] Add `opcom skills [list|show|create]` CLI commands
- [ ] Tests for skill loading and matching

## Acceptance Criteria

- Skills are standalone directories with SKILL.md
- Context builder includes relevant skills in agent context
- Roles can declare which skills they use
- Work item type/tags can trigger skill inclusion
- Built-in skills ship with opcom
- Users can create custom skills in ~/.opcom/skills/
- `opcom skills list` shows available skills
