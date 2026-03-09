# Skills — Reusable Capability Packages

## Overview

Skills are standalone, composable capability packages that provide domain-specific knowledge and methodology to agents. While **roles** define *who* an agent is (engineer, reviewer, researcher), **skills** define *how* to do something (code review methodology, test writing strategy, deployment checklist). Any role can use any compatible skill.

## Skill Structure

Skills live in `~/.opcom/skills/<skill-id>/` as directories containing a `SKILL.md` file:

```
~/.opcom/skills/
├── code-review/
│   └── SKILL.md
├── test-writing/
│   └── SKILL.md
├── research/
│   └── SKILL.md
├── deployment/
│   └── SKILL.md
├── planning/
│   └── SKILL.md
└── my-custom-skill/       # user-defined
    └── SKILL.md
```

## SKILL.md Format

Each skill is a markdown file with YAML frontmatter:

```yaml
---
name: deep-research
description: "Multi-source research with citation verification"
version: 1.0.0
triggers:
  - research
  - investigate
  - analyze
compatible-roles:
  - researcher
  - engineer
projects: []
---

# Deep Research Skill

## When to Use
...

## Process
...
```

### Frontmatter Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | Capitalized directory name | Human-readable skill name |
| `description` | `string` | `""` | Short description |
| `version` | `string` | `"0.0.0"` | Semver version |
| `triggers` | `string[]` | `[]` | Keywords that trigger automatic inclusion |
| `compatible-roles` | `string[]` | `[]` | Roles this skill works with (empty = all) |
| `projects` | `string[]` | `[]` | Project IDs this skill applies to (empty = all) |

## Types

### SkillDefinition

```typescript
interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  triggers: string[];
  compatibleRoles: string[];
  content: string;
  projects: string[];
}
```

### SkillEntry

Compact reference included in a ContextPacket:

```typescript
interface SkillEntry {
  name: string;
  content: string;
}
```

### RoleDefinition addition

```typescript
interface RoleDefinition {
  // ... existing fields ...
  skills?: string[];  // explicit skill IDs this role should use
}
```

### ContextPacket addition

```typescript
interface ContextPacket {
  // ... existing fields ...
  skills?: SkillEntry[];
}
```

## Skill Resolution

When building a context packet, skills are matched through three mechanisms:

1. **Role-declared skills**: The role's `skills: [...]` field explicitly includes skill IDs.
2. **Work item tags**: `tags: { skills: ["research", "deployment"] }` in ticket frontmatter.
3. **Trigger matching**: Skill `triggers` keywords are matched against the work item's `type`, `title`, and `tag` keys.

### Filtering

Matched skills are filtered by:
- **Role compatibility**: If a skill has `compatibleRoles`, the current role must be listed.
- **Project scope**: If a skill has `projects`, the current project must be listed.

## Built-in Skills

opcom ships five built-in skills:

| Skill | Compatible Roles | Triggers |
|---|---|---|
| `code-review` | reviewer, engineer | review, code review, PR review |
| `test-writing` | engineer, qa | test, testing, write tests, test coverage |
| `research` | researcher, engineer, planner | research, investigate, analyze, compare, evaluate options |
| `deployment` | devops, engineer | deploy, deployment, release, ship, infrastructure |
| `planning` | planner, engineer | plan, decompose, break down, implementation plan |

Built-in skills are written to `~/.opcom/skills/` on first run via `writeBuiltinSkills()`. User edits are preserved — the function only writes files that don't exist.

## User-Defined Skills

Users create custom skills by adding a directory in `~/.opcom/skills/`:

```bash
mkdir -p ~/.opcom/skills/pricing-analysis
cat > ~/.opcom/skills/pricing-analysis/SKILL.md << 'EOF'
---
name: Pricing Analysis
description: "Competitive pricing analysis methodology"
version: 1.0.0
triggers:
  - pricing
  - cost analysis
compatible-roles: []
projects: []
---

# Pricing Analysis Skill
...
EOF
```

## Context Packet Integration

The context builder calls `matchSkills(workItem, role, projectId)` during packet assembly. Matched skills are included as `SkillEntry[]` in the context packet, which renders as markdown sections in the system prompt:

```markdown
## Skills
### Code Review
[skill content...]

### Test Writing
[skill content...]
```

## CLI

```
opcom skills [list]          List available skills
opcom skills show <id>       Show skill details
```

## File Layout

| File | Purpose |
|---|---|
| `packages/types/src/skills.ts` | `SkillDefinition`, `SkillEntry` type exports |
| `packages/core/src/config/skills.ts` | `loadSkill()`, `listSkills()`, `matchSkills()`, `writeBuiltinSkills()`, `BUILTIN_SKILLS`, `parseSkillMd()` |
| `packages/core/src/config/paths.ts` | `skillsDir()`, `skillPath(id)` |
| `packages/cli/src/commands/skills.ts` | CLI commands |
