import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { rolesDir, rolePath } from "./paths.js";
import type { RoleDefinition, ResolvedRoleConfig, StackInfo, OrchestratorConfig } from "@opcom/types";
import { parseFrontmatter } from "../detection/tickets.js";

// --- Built-in role definitions ---

export const BUILTIN_ROLES: Record<string, RoleDefinition> = {
  engineer: {
    id: "engineer",
    name: "Engineer",
    permissionMode: "acceptEdits",
    disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
    instructions: [
      "- All changes MUST include tests.",
      "- Run the project's test command before finishing.",
      "- Commit completed work with a descriptive message.",
    ].join("\n"),
    doneCriteria: "Code committed. Tests passing.",
    runTests: true,
    runOracle: null,
  },
  qa: {
    id: "qa",
    name: "QA Tester",
    permissionMode: "acceptEdits",
    disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
    instructions: [
      "- You are a QA tester. Write tests that verify the ticket's acceptance criteria.",
      "- Do NOT modify production source code. Only create or edit test files.",
      "- Run all tests and report results.",
    ].join("\n"),
    doneCriteria: "Tests written and passing that cover all acceptance criteria.",
    runTests: true,
    runOracle: null,
  },
  reviewer: {
    id: "reviewer",
    name: "Reviewer",
    permissionMode: "default",
    disallowedTools: ["Edit", "Write", "NotebookEdit", "EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
    allowedBashPatterns: ["git log*", "git diff*", "git show*"],
    instructions: [
      "- Review the code changes for correctness, style, and potential issues.",
      "- Output a structured review with: summary, issues found, suggestions.",
      "- Do NOT modify any files.",
    ].join("\n"),
    doneCriteria: "Review report written to stdout.",
    runTests: false,
    runOracle: false,
  },
  researcher: {
    id: "researcher",
    name: "Researcher",
    permissionMode: "default",
    disallowedTools: ["Edit", "Write", "NotebookEdit", "EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
    instructions: [
      "- Research the topic described in the ticket.",
      "- Summarize findings with references.",
      "- Do NOT modify any files.",
    ].join("\n"),
    doneCriteria: "Research summary written to stdout.",
    runTests: false,
    runOracle: false,
  },
  devops: {
    id: "devops",
    name: "DevOps",
    permissionMode: "acceptEdits",
    disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
    allowedBashPatterns: ["docker *", "kubectl *", "helm *", "terraform *", "pulumi *"],
    instructions: [
      "- Focus on infrastructure, CI/CD, and deployment configuration.",
      "- Validate changes with dry-runs where possible.",
      "- Do NOT modify application business logic.",
    ].join("\n"),
    doneCriteria: "Infrastructure changes applied. Dry-run or validation passing.",
    runTests: false,
    runOracle: null,
  },
};

/**
 * Load a role definition by ID.
 * Checks ~/.opcom/roles/<id>.yaml first (user override), then falls back to built-in.
 */
export async function loadRole(roleId: string): Promise<RoleDefinition> {
  // Try user-defined role file
  const userPath = rolePath(roleId);
  if (existsSync(userPath)) {
    try {
      const content = await readFile(userPath, "utf-8");
      const parsed = parseRoleYaml(content);
      if (parsed && parsed.id) return parsed;
    } catch {
      // Fall through to built-in
    }
  }

  // Fall back to built-in
  const builtin = BUILTIN_ROLES[roleId];
  if (builtin) return builtin;

  // Unknown role — return minimal definition with the ID
  return { id: roleId };
}

/**
 * Resolve a role definition into a fully-populated config by layering:
 * 1. Built-in defaults
 * 2. Role definition values
 * 3. Stack-derived bash tools (merged into allowedBashPatterns)
 * 4. Plan-level overrides
 */
export function resolveRoleConfig(
  role: RoleDefinition,
  stackBashPatterns: string[],
  planConfig: OrchestratorConfig,
): ResolvedRoleConfig {
  // Merge allowedBashPatterns: role + stack-derived + plan-level
  const bashPatterns = new Set<string>();
  if (role.allowedBashPatterns) {
    for (const p of role.allowedBashPatterns) bashPatterns.add(p);
  }
  for (const p of stackBashPatterns) bashPatterns.add(p);
  if (planConfig.allowedBashPatterns) {
    for (const p of planConfig.allowedBashPatterns) bashPatterns.add(p);
  }

  // runOracle: role value if non-null, otherwise plan verification config
  const runOracle = role.runOracle != null
    ? role.runOracle
    : planConfig.verification.runOracle;

  // runTests: role value if defined, otherwise plan verification config
  const runTests = role.runTests != null
    ? role.runTests
    : planConfig.verification.runTests;

  return {
    roleId: role.id,
    name: role.name ?? capitalize(role.id),
    permissionMode: role.permissionMode ?? "acceptEdits",
    allowedTools: role.allowedTools ?? [],
    disallowedTools: role.disallowedTools ?? ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
    allowedBashPatterns: Array.from(bashPatterns),
    instructions: role.instructions ?? "",
    doneCriteria: role.doneCriteria ?? "",
    runTests,
    runOracle,
  };
}

/**
 * Write built-in role files to ~/.opcom/roles/ if they don't exist.
 * Preserves user edits — only writes missing files.
 */
export async function writeBuiltinRoles(): Promise<void> {
  const dir = rolesDir();
  await mkdir(dir, { recursive: true });

  for (const [id, role] of Object.entries(BUILTIN_ROLES)) {
    const path = rolePath(id);
    if (!existsSync(path)) {
      const yaml = roleToYaml(role);
      await writeFile(path, yaml, "utf-8");
    }
  }
}

// --- YAML helpers ---

/**
 * Parse a role YAML file. Uses the same lightweight parser as ticket frontmatter
 * but wraps the whole file (roles don't use --- delimiters).
 */
export function parseRoleYaml(content: string): RoleDefinition | null {
  // If the content has frontmatter delimiters, use them; otherwise wrap it
  const hasFrontmatter = content.trimStart().startsWith("---");
  const toParse = hasFrontmatter ? content : `---\n${content}\n---`;

  const parsed = parseFrontmatter(toParse);
  if (!parsed || !parsed.id) return null;

  const role: RoleDefinition = {
    id: String(parsed.id),
  };

  if (parsed.name != null) role.name = String(parsed.name);
  if (parsed.permissionMode != null) role.permissionMode = String(parsed.permissionMode);
  if (Array.isArray(parsed.allowedTools)) role.allowedTools = parsed.allowedTools.map(String);
  if (Array.isArray(parsed.disallowedTools)) role.disallowedTools = parsed.disallowedTools.map(String);
  if (Array.isArray(parsed.allowedBashPatterns)) role.allowedBashPatterns = parsed.allowedBashPatterns.map(String);
  if (typeof parsed.instructions === "string") role.instructions = parsed.instructions;
  if (typeof parsed.doneCriteria === "string") role.doneCriteria = parsed.doneCriteria;
  if (typeof parsed.runTests === "boolean") role.runTests = parsed.runTests;
  if (parsed.runOracle === false) role.runOracle = false;
  else if (parsed.runOracle === true) role.runOracle = true;
  // null stays as default (undefined → inherits from plan)

  return role;
}

function roleToYaml(role: RoleDefinition): string {
  const lines: string[] = [];
  lines.push(`id: ${role.id}`);
  if (role.name) lines.push(`name: ${role.name}`);
  if (role.permissionMode) lines.push(`permissionMode: ${role.permissionMode}`);

  if (role.allowedTools && role.allowedTools.length > 0) {
    lines.push("allowedTools:");
    for (const t of role.allowedTools) lines.push(`  - ${t}`);
  } else {
    lines.push("allowedTools: []");
  }

  if (role.disallowedTools && role.disallowedTools.length > 0) {
    lines.push("disallowedTools:");
    for (const t of role.disallowedTools) lines.push(`  - ${t}`);
  } else {
    lines.push("disallowedTools: []");
  }

  if (role.allowedBashPatterns && role.allowedBashPatterns.length > 0) {
    lines.push("allowedBashPatterns:");
    for (const p of role.allowedBashPatterns) lines.push(`  - ${JSON.stringify(p)}`);
  } else {
    lines.push("allowedBashPatterns: []");
  }

  if (role.instructions) {
    lines.push(`instructions: |`);
    for (const line of role.instructions.split("\n")) {
      lines.push(`  ${line}`);
    }
  }

  if (role.doneCriteria) {
    lines.push(`doneCriteria: ${JSON.stringify(role.doneCriteria)}`);
  }

  lines.push(`runTests: ${role.runTests ?? true}`);

  if (role.runOracle === null || role.runOracle === undefined) {
    lines.push("runOracle: null");
  } else {
    lines.push(`runOracle: ${role.runOracle}`);
  }

  return lines.join("\n") + "\n";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
