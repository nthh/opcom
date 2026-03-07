# Agent Roles

## Overview

opcom's executor currently treats every agent identically — same permission mode, same system prompt structure, same tool restrictions. But work items can require fundamentally different agent behaviors: an engineer writes code and tests, a QA tester verifies without modifying production code, a reviewer reads without editing, a researcher explores without committing. Roles let tickets declare the behavioral profile an agent should adopt when executing them.

## Core Insight

**Roles are opcom-owned configuration, not backend-specific mechanisms.** Role resolution happens upstream of adapter calls — by the time `startSession()` fires, `AgentStartConfig` already carries the fully resolved permissions, tools, and instructions. Adapters don't need to know roles exist.

## Role Definition

A role is a YAML file in `~/.opcom/roles/` with one file per role. Only `id` is required; all other fields fall back to built-in defaults.

```yaml
# ~/.opcom/roles/engineer.yaml
id: engineer
name: Engineer
permissionMode: acceptEdits
allowedTools: []
disallowedTools:
  - EnterPlanMode
  - ExitPlanMode
  - EnterWorktree
allowedBashPatterns: []        # empty = inherit from stack detection
instructions: |
  - All changes MUST include tests.
  - Run tests relevant to your changes during development (specific test files, not the full suite).
  - The full test suite will be run by the verification pipeline after you finish. Do not run it yourself.
doneCriteria: "Code committed. Relevant tests passing."
runTests: true
runOracle: null                # null = inherit from plan config
```

### Schema

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | *required* | Unique identifier, matches filename |
| `name` | `string` | Capitalized `id` | Human-readable display name |
| `permissionMode` | `string` | `"acceptEdits"` | Permission mode passed to agent backend |
| `allowedTools` | `string[]` | `[]` | Tools explicitly allowed (merged with stack-derived tools) |
| `disallowedTools` | `string[]` | `[]` | Tools explicitly denied |
| `allowedBashPatterns` | `string[]` | `[]` | Bash command patterns (merged with stack-derived patterns) |
| `instructions` | `string` | `""` | Markdown injected into agent system prompt as role-specific requirements |
| `doneCriteria` | `string` | `""` | Injected into the "when to stop" section of the prompt |
| `runTests` | `boolean` | `true` | Whether verification runs the test gate |
| `runOracle` | `boolean \| null` | `null` | Whether verification runs the oracle gate; `null` inherits from plan config |

## Built-in Roles

opcom ships five built-in roles. These are the defaults — users can override any of them by placing a file with the same `id` in `~/.opcom/roles/`.

### engineer (default)

The standard implementation role. Writes code, writes tests, commits.

```yaml
id: engineer
name: Engineer
permissionMode: acceptEdits
disallowedTools:
  - EnterPlanMode
  - ExitPlanMode
  - EnterWorktree
instructions: |
  - All changes MUST include tests.
  - Run tests relevant to your changes during development (specific test files, not the full suite).
  - The full test suite will be run by the verification pipeline after you finish. Do not run it yourself.
  - Commit completed work with a descriptive message.
doneCriteria: "Code committed. Relevant tests passing."
runTests: true
runOracle: null
```

### qa

Verification-focused. Writes test files only — cannot modify production code.

```yaml
id: qa
name: QA Tester
permissionMode: acceptEdits
disallowedTools:
  - EnterPlanMode
  - ExitPlanMode
  - EnterWorktree
instructions: |
  - You are a QA tester. Write tests that verify the ticket's acceptance criteria.
  - Do NOT modify production source code. Only create or edit test files.
  - Run the test files you wrote to verify they pass. Do not run the full test suite.
doneCriteria: "Tests written and passing that cover all acceptance criteria."
runTests: true
runOracle: null
```

### reviewer

Read-only code review. Cannot edit files or run destructive commands.

```yaml
id: reviewer
name: Reviewer
permissionMode: default
allowedTools: []
disallowedTools:
  - Edit
  - Write
  - NotebookEdit
  - EnterPlanMode
  - ExitPlanMode
  - EnterWorktree
allowedBashPatterns:
  - "git log*"
  - "git diff*"
  - "git show*"
instructions: |
  - Review the code changes for correctness, style, and potential issues.
  - Output a structured review with: summary, issues found, suggestions.
  - Do NOT modify any files.
doneCriteria: "Review report written to stdout."
runTests: false
runOracle: false
```

### researcher

Exploration and analysis. Read-only access, web search allowed.

```yaml
id: researcher
name: Researcher
permissionMode: default
disallowedTools:
  - Edit
  - Write
  - NotebookEdit
  - EnterPlanMode
  - ExitPlanMode
  - EnterWorktree
instructions: |
  - Research the topic described in the ticket.
  - Summarize findings with references.
  - Do NOT modify any files.
doneCriteria: "Research summary written to stdout."
runTests: false
runOracle: false
```

### devops

Infrastructure and CI/CD work. Broader bash access, config file editing.

```yaml
id: devops
name: DevOps
permissionMode: acceptEdits
disallowedTools:
  - EnterPlanMode
  - ExitPlanMode
  - EnterWorktree
allowedBashPatterns:
  - "docker *"
  - "kubectl *"
  - "helm *"
  - "terraform *"
  - "pulumi *"
instructions: |
  - Focus on infrastructure, CI/CD, and deployment configuration.
  - Validate changes with dry-runs where possible.
  - Do NOT modify application business logic.
doneCriteria: "Infrastructure changes applied. Dry-run or validation passing."
runTests: false
runOracle: null
```

## Ticket Role Declaration

Tickets declare their role via the `role` field in frontmatter. If omitted, the role defaults to `engineer`.

```yaml
---
id: add-health-checks
title: "Add health check endpoints"
status: open
type: feature
priority: 2
role: devops
deps: []
---
```

The ticket scanner parses `role` from `TicketFrontmatter` and stores it on `WorkItem.role`.

## Resolution Order

When the executor starts a step, it resolves the agent's configuration by layering sources in order. Later layers override earlier ones.

```
1. Built-in defaults         — hardcoded fallback values
2. Role definition           — ~/.opcom/roles/<role>.yaml (or built-in role)
3. Stack-derived tools       — deriveAllowedBashTools() from project detection
4. Plan-level overrides      — OrchestratorConfig fields (allowedBashPatterns, verification)
```

### Merge rules

- **`permissionMode`**: role wins unless plan overrides (plan override not yet supported)
- **`allowedTools`**: union of role + stack-derived
- **`disallowedTools`**: role value used directly (disallowed always wins over allowed)
- **`allowedBashPatterns`**: union of role + stack-derived + plan-level
- **`instructions`**: role value replaces the hardcoded Requirements block in context-builder
- **`doneCriteria`**: role value replaces the hardcoded done criteria in context-builder
- **`runTests`**: role value, unless plan verification config explicitly overrides
- **`runOracle`**: role value if non-null, otherwise falls back to plan verification config

## Types

### RoleDefinition

The raw shape of a role YAML file.

```typescript
export interface RoleDefinition {
  id: string;
  name?: string;
  permissionMode?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  allowedBashPatterns?: string[];
  instructions?: string;
  doneCriteria?: string;
  runTests?: boolean;
  runOracle?: boolean | null;
}
```

### ResolvedRoleConfig

The fully resolved configuration ready to feed into `AgentStartConfig`. All fields are present — no optionals.

```typescript
export interface ResolvedRoleConfig {
  roleId: string;
  name: string;
  permissionMode: string;
  allowedTools: string[];
  disallowedTools: string[];
  allowedBashPatterns: string[];
  instructions: string;
  doneCriteria: string;
  runTests: boolean;
  runOracle: boolean;
}
```

### WorkItem addition

```typescript
export interface WorkItem {
  // ... existing fields ...
  role?: string;  // role id, default: "engineer"
}
```

### TicketFrontmatter addition

```typescript
export interface TicketFrontmatter {
  // ... existing fields ...
  role?: string;
}
```

### PlanStep addition

```typescript
export interface PlanStep {
  // ... existing fields ...
  role?: string;  // cached from ticket at plan creation time
}
```

## File Layout

### New files

| File | Purpose |
|---|---|
| `packages/types/src/roles.ts` | `RoleDefinition`, `ResolvedRoleConfig` type exports |
| `packages/core/src/config/roles.ts` | `loadRole()`, `resolveRoleConfig()`, `writeBuiltinRoles()`, `BUILTIN_ROLES` |

### Modified files

| File | Change |
|---|---|
| `packages/types/src/work-items.ts` | Add `role?: string` to `WorkItem` and `TicketFrontmatter` |
| `packages/types/src/plan.ts` | Add `role?: string` to `PlanStep` |
| `packages/core/src/config/paths.ts` | Add `rolesDir()`, `rolePath(id)` |
| `packages/core/src/detection/tickets.ts` | Parse `role` from frontmatter |
| `packages/core/src/orchestrator/executor.ts` | `startStep()` calls `resolveRoleConfig()` and uses result for `AgentStartConfig` |
| `packages/core/src/agents/context-builder.ts` | Role `instructions` and `doneCriteria` replace hardcoded blocks |

## Executor Integration

The executor's `startStep()` method currently hardcodes permission mode and tool lists. With roles, it becomes:

```typescript
async startStep(step: PlanStep): Promise<void> {
  const project = await this.loadProject(step.projectId);
  const roleId = step.role ?? "engineer";
  const roleDef = await loadRole(roleId);
  const resolved = resolveRoleConfig(roleDef, project.stack, this.plan.config);

  const session = await this.sessionManager.startSession(
    step.projectId,
    this.plan.config.backend,
    {
      projectPath: project.path,
      workItemId: step.ticketId,
      contextPacket,
      cwd: agentCwd,
      worktree: this.plan.config.worktree,
      permissionMode: resolved.permissionMode,
      disallowedTools: resolved.disallowedTools,
      allowedTools: resolved.allowedTools,
      allowedBashPatterns: resolved.allowedBashPatterns,
      additionalDirs: [project.path],
    },
    step.ticketId,
  );
}
```

## Persistence

Roles directory: `~/.opcom/roles/`

```
~/.opcom/roles/
  engineer.yaml
  qa.yaml
  reviewer.yaml
  researcher.yaml
  devops.yaml
  my-custom-role.yaml      # user-defined
```

`writeBuiltinRoles()` writes the five built-in role files on first run (or when missing). User edits to these files are preserved — the function only writes if the file does not exist.

## CLI

No new commands in this phase. Roles are managed by editing YAML files directly. A future `opcom roles list|show|edit` command set is possible but out of scope.

## Non-Goals

- **Ticket pipelines** — sequencing roles (engineer → qa → reviewer) is a separate concern
- **Role inheritance/composition** — roles are flat, no `extends` or mixins
- **Runtime role switching** — a step's role is fixed at plan creation time
- **Role-based model selection** — model choice stays in `OrchestratorConfig`
- **Plugin system** — roles are static YAML, not executable code
- **Per-step role override in plan UI** — role comes from the ticket, not the plan editor
