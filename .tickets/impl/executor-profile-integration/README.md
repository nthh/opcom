---
id: executor-profile-integration
title: "Wire executor and verification pipeline to use project profile"
status: closed
type: feature
priority: 2
created: 2026-03-10
deps:
  - project-profile
links:
  - docs/spec/config.md#project-profile
  - docs/spec/config.md#profile-precedence
  - docs/spec/orchestrator.md
services:
  - core
---

# Executor Profile Integration

## Problem

The verification pipeline uses a generic test command (`npm test` or whatever `testing.command` was detected). But projects have specific fast-gate commands (`make test-smoke`, `pytest -m unit`, `vitest run tests/smoke/`) that are more appropriate for the verification loop. The profile stores these, but nothing reads them.

Similarly, agent constraints from the profile (forbidden commands) are not enforced — they're just stored data. And the context builder doesn't inject profile-derived information into agent prompts.

## Goal

Wire the executor, verification pipeline, and context builder to read the project profile. The test gate uses `profile.commands.test` when available. Forbidden commands are enforced (or warned) during agent execution. Workflow rules appear in agent context packets.

## Design

### Verification Pipeline

In the test gate (`packages/core/src/orchestrator/verification.ts` or equivalent):

```typescript
function resolveTestCommand(project: ProjectConfig, planConfig: OrchestratorConfig): string {
  // Priority: plan-level override > profile > detected testing > fallback
  if (planConfig.testCommand) return planConfig.testCommand;
  if (project.profile?.commands?.test) return project.profile.commands.test;
  if (project.testing?.command) return project.testing.command;
  return "npm test";  // last resort
}
```

For stage-level smoke tests (between stages), use `profile.commands.testFull` if available — the full suite is appropriate at stage boundaries even if the per-step gate uses the fast command.

### Forbidden Command Enforcement

When an agent invokes a bash command, check against `profile.agentConstraints.forbiddenCommands`:

```typescript
function checkForbiddenCommand(
  command: string,
  constraints: AgentConstraints | undefined,
): { allowed: boolean; rule?: string } {
  if (!constraints?.forbiddenCommands) return { allowed: true };
  for (const forbidden of constraints.forbiddenCommands) {
    if (command.includes(forbidden)) {
      return { allowed: false, rule: forbidden };
    }
  }
  return { allowed: true };
}
```

Enforcement level is **warn** by default — log a warning and emit an event, but don't block the command. The executor's `allowedBashPatterns` already provides hard blocking; forbidden commands from the profile complement it with project-specific soft warnings. A future setting could upgrade to hard block.

### Context Builder

When building a context packet for an agent, inject profile-derived context:

```typescript
// In ContextBuilder
if (project.profile?.agentConstraints) {
  const { commitRules, workflowRules } = project.profile.agentConstraints;
  if (commitRules?.length || workflowRules?.length) {
    contextSections.push({
      heading: "Project Constraints",
      content: formatConstraints(commitRules, workflowRules),
    });
  }
}
```

This is supplemental to the full agent config file (CLAUDE.md) which is already included. The profile constraints are a structured summary that agents can parse more reliably than natural language in a large markdown file.

### Traceability Integration

When a `FieldMapping` has `type: "use-case"`, the ticket scanner creates edges in the context graph:

```typescript
// In ticket analyzer
for (const mapping of profile.fieldMappings ?? []) {
  if (mapping.type === "use-case" && workItem.tags[mapping.field]) {
    for (const ucId of workItem.tags[mapping.field]) {
      edges.push({
        source: `ticket:${workItem.id}`,
        target: `use_case:${ucId}`,
        relation: "implements",
      });
    }
  }
}
```

This closes the loop — project-specific frontmatter fields like `demand: [UC-001]` automatically create traceability edges, making `opcom uc show UC-001` aware of tickets from any project that uses the `demand` field convention.

## Tasks

- [ ] Implement `resolveTestCommand()` with profile > detected > fallback precedence
- [ ] Wire test gate to use `resolveTestCommand()` instead of hardcoded command
- [ ] Wire stage smoke tests to use `profile.commands.testFull` when available
- [ ] Implement `checkForbiddenCommand()` — soft warn on match
- [ ] Emit `forbidden_command_warning` event when an agent invokes a forbidden command
- [ ] Update context builder to inject `commitRules` and `workflowRules` as a structured section
- [ ] Update ticket analyzer to create `implements` edges for `use-case` field mappings
- [ ] Add `testCommand` to `OrchestratorConfig` for plan-level override
- [ ] Tests: test command resolution precedence, forbidden command matching, context injection, use-case edge creation

## Acceptance Criteria

- Verification pipeline uses `profile.commands.test` when available
- Stage smoke tests use `profile.commands.testFull` when available
- Fallback chain: plan override > profile > detected testing.command > `npm test`
- Forbidden commands produce warning events (not hard blocks)
- Agent context packets include structured constraints from profile
- Tickets with `demand: [UC-001]` (when field mapped as `use-case`) create `implements` edges to `use_case:UC-001`
- Projects without profiles behave exactly as before
