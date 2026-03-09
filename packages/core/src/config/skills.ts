import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { skillsDir, skillPath } from "./paths.js";
import { parseFrontmatter } from "../detection/tickets.js";
import type { SkillDefinition, WorkItem, RoleDefinition } from "@opcom/types";

// --- Built-in skill definitions ---

export const BUILTIN_SKILLS: Record<string, SkillDefinition> = {
  "code-review": {
    id: "code-review",
    name: "Code Review",
    description: "Structured code review methodology",
    version: "1.0.0",
    triggers: ["review", "code review", "PR review"],
    compatibleRoles: ["reviewer", "engineer"],
    projects: [],
    content: `# Code Review Skill

## When to Use
Use this skill when reviewing code changes for correctness, style, and potential issues.

## Process
1. Read the diff or changed files to understand the scope of changes.
2. Check for correctness: does the code do what it claims?
3. Check for edge cases: nil/null handling, boundary conditions, empty inputs.
4. Check for style: naming conventions, code organization, readability.
5. Check for security: injection risks, auth checks, data validation.
6. Check for performance: unnecessary allocations, N+1 queries, missing indexes.

## Output Format
Structure your review as:

### Summary
One paragraph describing what the changes do.

### Issues
- **[severity]** file:line — description of issue

Severity levels: critical, warning, nit

### Suggestions
- Optional improvements that aren't blocking.

## Anti-Patterns
- Don't nitpick formatting if a formatter is configured.
- Don't request changes that are out of scope for the PR.
- Don't block on style preferences — only on correctness and security.`,
  },

  "test-writing": {
    id: "test-writing",
    name: "Test Writing",
    description: "Test strategy and pattern guidance",
    version: "1.0.0",
    triggers: ["test", "testing", "write tests", "test coverage"],
    compatibleRoles: ["engineer", "qa"],
    projects: [],
    content: `# Test Writing Skill

## When to Use
Use this skill when writing tests for new or modified functionality.

## Process
1. Identify the public API surface to test (exports, endpoints, commands).
2. Write happy-path tests first — the most common usage.
3. Write edge-case tests: empty inputs, boundary values, error conditions.
4. Write integration tests for cross-module interactions if applicable.
5. Run the tests you wrote to verify they pass.

## Test Structure
Each test should follow Arrange-Act-Assert:
- **Arrange**: Set up preconditions and inputs.
- **Act**: Call the function or trigger the behavior.
- **Assert**: Verify the output or side effects.

## Naming Convention
Test names should describe the behavior, not the implementation:
- Good: "returns empty array when no items match"
- Bad: "test filter function"

## Coverage Strategy
- Cover all branches in conditional logic.
- Cover error paths (thrown exceptions, returned errors).
- Cover boundary values (0, 1, max, empty string, null).
- Don't test private/internal functions directly — test through the public API.

## Anti-Patterns
- Don't mock what you don't own — use real implementations where possible.
- Don't write tests that depend on execution order.
- Don't test framework behavior — only test your code.
- Don't write tests that always pass regardless of the implementation.`,
  },

  "research": {
    id: "research",
    name: "Deep Research",
    description: "Multi-source research with structured output",
    version: "1.0.0",
    triggers: ["research", "investigate", "analyze", "compare", "evaluate options"],
    compatibleRoles: ["researcher", "engineer", "planner"],
    projects: [],
    content: `# Deep Research Skill

## When to Use
Use this skill when a ticket requires gathering information from multiple sources,
comparing options, or producing a research report.

## Process
1. Define research questions from the ticket requirements.
2. Search multiple sources: documentation, code examples, web resources.
3. Cross-reference findings — don't rely on a single source.
4. Evaluate options against project constraints (stack, scale, cost).
5. Produce a structured report with citations and recommendations.

## Output Format

### Question
Restate the research question clearly.

### Findings
Numbered findings with source references:
1. **Finding** — explanation (source: URL or doc reference)

### Comparison (if evaluating options)
| Criterion | Option A | Option B | Option C |
|-----------|----------|----------|----------|
| ...       | ...      | ...      | ...      |

### Recommendation
Clear recommendation with justification tied to project constraints.

## Anti-Patterns
- Don't research indefinitely — cap at 3 search rounds per question.
- Don't present raw search results — synthesize and summarize.
- Don't recommend without justification tied to the specific context.
- Don't ignore project constraints (existing stack, team size, budget).`,
  },

  "deployment": {
    id: "deployment",
    name: "Deployment",
    description: "Deployment checklists and platform-specific guidance",
    version: "1.0.0",
    triggers: ["deploy", "deployment", "release", "ship", "infrastructure"],
    compatibleRoles: ["devops", "engineer"],
    projects: [],
    content: `# Deployment Skill

## When to Use
Use this skill when deploying services, setting up CI/CD, or managing infrastructure changes.

## Pre-Deployment Checklist
1. All tests passing on the branch.
2. No uncommitted changes in the working tree.
3. Environment variables documented and set.
4. Database migrations reviewed and tested.
5. Rollback plan identified.

## Deployment Process
1. Verify the build succeeds locally or in CI.
2. Deploy to staging/preview environment first if available.
3. Run smoke tests against the deployed environment.
4. Deploy to production.
5. Monitor logs and metrics for the first 15 minutes.

## Platform-Specific Notes

### Docker/Kubernetes
- Verify image tags are pinned (not :latest in production).
- Check resource limits (CPU, memory) are set.
- Verify health check endpoints respond correctly.

### Serverless (Cloudflare Workers, AWS Lambda)
- Check cold start performance is acceptable.
- Verify environment bindings are configured.
- Test with production-like payload sizes.

### Static Sites (Vercel, Netlify)
- Verify build output is correct.
- Check redirects and headers configuration.
- Test with CDN cache invalidation.

## Anti-Patterns
- Don't deploy on Fridays unless it's an emergency.
- Don't skip staging in favor of "it works locally."
- Don't deploy without a rollback plan.
- Don't make infrastructure changes without dry-run validation.`,
  },

  "planning": {
    id: "planning",
    name: "Task Planning",
    description: "Task decomposition and implementation planning",
    version: "1.0.0",
    triggers: ["plan", "decompose", "break down", "implementation plan"],
    compatibleRoles: ["planner", "engineer"],
    projects: [],
    content: `# Task Planning Skill

## When to Use
Use this skill when decomposing a large ticket into smaller tasks,
or when creating an implementation plan for a complex feature.

## Process
1. Read the full specification and acceptance criteria.
2. Identify the deliverables — what artifacts must exist when done.
3. Identify dependencies — what must be built first.
4. Decompose into tasks that are each independently testable.
5. Order tasks by dependency, with independent tasks parallelizable.

## Task Sizing
Each task should be:
- Completable in a single agent session (< 1 hour of work).
- Independently verifiable (has its own tests or acceptance criteria).
- Small enough that failure doesn't waste significant work.

## Dependency Identification
- Data model changes before API changes before UI changes.
- Type definitions before implementations.
- Shared utilities before consumers.
- Tests can often be written in parallel with implementation.

## Output Format
A numbered list of tasks with:
1. **Task title** — brief description
   - Files: list of files to create/modify
   - Depends on: task numbers
   - Acceptance: how to verify this task is done

## Anti-Patterns
- Don't create tasks smaller than a single function.
- Don't create tasks that can't be verified independently.
- Don't plan more than 2 levels deep — plans change during implementation.
- Don't over-specify implementation details — let the implementer decide.`,
  },
};

/**
 * Parse a SKILL.md file into a SkillDefinition.
 * Expects YAML frontmatter (--- delimited) followed by markdown content.
 */
export function parseSkillMd(content: string, fallbackId: string): SkillDefinition | null {
  const parsed = parseFrontmatter(content);
  if (!parsed) return null;

  // Extract the body (everything after the closing ---)
  const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)/);
  const body = bodyMatch ? bodyMatch[1].trim() : "";

  const id = typeof parsed.name === "string" ? parsed.name : fallbackId;

  return {
    id,
    name: typeof parsed.name === "string" ? parsed.name : capitalize(fallbackId),
    description: typeof parsed.description === "string" ? parsed.description : "",
    version: typeof parsed.version === "string" ? parsed.version : "0.0.0",
    triggers: Array.isArray(parsed.triggers) ? parsed.triggers.map(String) : [],
    compatibleRoles: Array.isArray(parsed["compatible-roles"])
      ? parsed["compatible-roles"].map(String)
      : [],
    projects: Array.isArray(parsed.projects) ? parsed.projects.map(String) : [],
    content: body,
  };
}

/**
 * Load a skill by ID.
 * Checks ~/.opcom/skills/<id>/SKILL.md first, then falls back to built-in.
 */
export async function loadSkill(skillId: string): Promise<SkillDefinition | null> {
  // Try user-defined skill
  const userPath = skillPath(skillId);
  if (existsSync(userPath)) {
    try {
      const content = await readFile(userPath, "utf-8");
      const skill = parseSkillMd(content, skillId);
      if (skill) {
        skill.id = skillId; // directory name is the canonical ID
        return skill;
      }
    } catch {
      // Fall through to built-in
    }
  }

  // Fall back to built-in
  return BUILTIN_SKILLS[skillId] ?? null;
}

/**
 * List all available skills (user-defined + built-in).
 * User-defined skills with the same ID override built-ins.
 */
export async function listSkills(): Promise<SkillDefinition[]> {
  const skills = new Map<string, SkillDefinition>();

  // Start with built-ins
  for (const [id, skill] of Object.entries(BUILTIN_SKILLS)) {
    skills.set(id, skill);
  }

  // Override with user-defined skills
  const dir = skillsDir();
  if (existsSync(dir)) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const id = entry.name;
        const mdPath = join(dir, id, "SKILL.md");
        if (existsSync(mdPath)) {
          try {
            const content = await readFile(mdPath, "utf-8");
            const skill = parseSkillMd(content, id);
            if (skill) {
              skill.id = id;
              skills.set(id, skill);
            }
          } catch {
            // Skip unreadable
          }
        }
      }
    } catch {
      // Dir not listable
    }
  }

  return Array.from(skills.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Match skills for a given work item and role.
 * A skill matches if any of:
 * 1. The role explicitly declares it in `skills: [...]`
 * 2. A trigger keyword appears in the work item's type, title, or tag keys
 * 3. The work item's tags contain a "skills" key with matching skill IDs
 *
 * Filters by compatible role (if specified) and project scope.
 */
export async function matchSkills(
  workItem: WorkItem | undefined,
  role: RoleDefinition | undefined,
  projectId?: string,
): Promise<SkillDefinition[]> {
  const allSkills = await listSkills();
  const matched = new Set<string>();

  // 1. Role-declared skills
  if (role?.skills) {
    for (const skillId of role.skills) {
      matched.add(skillId);
    }
  }

  // 2. Work item tag-declared skills (tags: { skills: ["research", "deployment"] })
  if (workItem?.tags?.skills) {
    for (const skillId of workItem.tags.skills) {
      matched.add(skillId);
    }
  }

  // 3. Trigger-based matching against work item type, title, and tag keys
  if (workItem) {
    const searchText = [
      workItem.type,
      workItem.title,
      ...Object.keys(workItem.tags),
    ].join(" ").toLowerCase();

    for (const skill of allSkills) {
      if (skill.triggers.length === 0) continue;
      for (const trigger of skill.triggers) {
        if (searchText.includes(trigger.toLowerCase())) {
          matched.add(skill.id);
          break;
        }
      }
    }
  }

  // Filter and resolve
  const results: SkillDefinition[] = [];
  for (const skillId of matched) {
    const skill = allSkills.find(s => s.id === skillId);
    if (!skill) continue;

    // Check project scope
    if (skill.projects.length > 0 && projectId && !skill.projects.includes(projectId)) {
      continue;
    }

    // Check role compatibility
    if (skill.compatibleRoles.length > 0 && role?.id && !skill.compatibleRoles.includes(role.id)) {
      continue;
    }

    results.push(skill);
  }

  return results.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Write built-in skill directories to ~/.opcom/skills/ if they don't exist.
 * Preserves user edits — only writes if the directory/file doesn't exist.
 */
export async function writeBuiltinSkills(): Promise<void> {
  const dir = skillsDir();
  await mkdir(dir, { recursive: true });

  for (const [id, skill] of Object.entries(BUILTIN_SKILLS)) {
    const skillDir = join(dir, id);
    const mdPath = join(skillDir, "SKILL.md");
    if (!existsSync(mdPath)) {
      await mkdir(skillDir, { recursive: true });
      const yaml = skillToMd(skill);
      await writeFile(mdPath, yaml, "utf-8");
    }
  }
}

// --- Helpers ---

function skillToMd(skill: SkillDefinition): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${skill.name}`);
  lines.push(`description: ${JSON.stringify(skill.description)}`);
  lines.push(`version: ${skill.version}`);

  if (skill.triggers.length > 0) {
    lines.push("triggers:");
    for (const t of skill.triggers) lines.push(`  - ${t}`);
  } else {
    lines.push("triggers: []");
  }

  if (skill.compatibleRoles.length > 0) {
    lines.push("compatible-roles:");
    for (const r of skill.compatibleRoles) lines.push(`  - ${r}`);
  } else {
    lines.push("compatible-roles: []");
  }

  if (skill.projects.length > 0) {
    lines.push("projects:");
    for (const p of skill.projects) lines.push(`  - ${p}`);
  } else {
    lines.push("projects: []");
  }

  lines.push("---");
  lines.push("");
  lines.push(skill.content);
  lines.push("");

  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
