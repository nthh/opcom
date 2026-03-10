import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { teamsDir, teamPath } from "./paths.js";
import type { TeamDefinition, TeamStep, WorkItem, VerificationMode } from "@opcom/types";
import { parseFrontmatter } from "../detection/tickets.js";

// --- Built-in team definitions ---

export const BUILTIN_TEAMS: Record<string, TeamDefinition> = {
  "solo-engineer": {
    id: "solo-engineer",
    name: "Solo Engineer",
    description: "Single engineer with test-gate verification (default behavior)",
    steps: [
      { role: "engineer", verification: "test-gate" },
    ],
  },
  "feature-dev": {
    id: "feature-dev",
    name: "Feature Development",
    description: "Standard feature implementation with QA and review",
    steps: [
      { role: "engineer", verification: "test-gate" },
      { role: "qa", verification: "test-gate", depends_on: "engineer" },
      { role: "reviewer", verification: "none", depends_on: "qa" },
    ],
    triggers: {
      types: ["feature"],
    },
  },
  research: {
    id: "research",
    name: "Research Task",
    description: "Single researcher with output-exists verification",
    steps: [
      { role: "researcher", verification: "output-exists" },
    ],
    triggers: {
      types: ["research"],
    },
  },
  "ops-task": {
    id: "ops-task",
    name: "Operational Task",
    description: "Single engineer with manual confirmation",
    steps: [
      { role: "engineer", verification: "confirmation" },
    ],
    triggers: {
      types: ["task", "booking", "coordination"],
    },
  },
};

/**
 * Load a team definition by ID.
 * Checks ~/.opcom/teams/<id>.yaml first (user override), then falls back to built-in.
 */
export async function loadTeam(teamId: string): Promise<TeamDefinition | null> {
  // Try user-defined team file
  const userPath = teamPath(teamId);
  if (existsSync(userPath)) {
    try {
      const content = await readFile(userPath, "utf-8");
      const parsed = parseTeamYaml(content);
      if (parsed) return parsed;
    } catch {
      // Fall through to built-in
    }
  }

  // Fall back to built-in
  return BUILTIN_TEAMS[teamId] ?? null;
}

/**
 * List all available teams (built-in + user-defined).
 */
export async function listTeams(): Promise<TeamDefinition[]> {
  const teams = new Map<string, TeamDefinition>();

  // Start with built-ins
  for (const [id, team] of Object.entries(BUILTIN_TEAMS)) {
    teams.set(id, team);
  }

  // Override with user-defined
  const dir = teamsDir();
  if (existsSync(dir)) {
    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
        const id = file.replace(/\.ya?ml$/, "");
        try {
          const content = await readFile(teamPath(id), "utf-8");
          const parsed = parseTeamYaml(content);
          if (parsed) teams.set(parsed.id, parsed);
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Directory read failed
    }
  }

  return Array.from(teams.values());
}

/**
 * Resolve which team applies to a work item.
 * Priority: explicit team field → type-based trigger match → null (single-agent default).
 */
export async function resolveTeam(workItem: WorkItem): Promise<TeamDefinition | null> {
  // 1. Explicit team field
  if (workItem.team) {
    return loadTeam(workItem.team);
  }

  // 2. Type-based trigger matching
  const allTeams = await listTeams();
  for (const team of allTeams) {
    if (matchesTriggers(team, workItem)) {
      return team;
    }
  }

  // 3. No match — caller uses single-agent default
  return null;
}

/**
 * Check if a team's triggers match a work item.
 */
export function matchesTriggers(team: TeamDefinition, workItem: WorkItem): boolean {
  if (!team.triggers) return false;

  const { types, priority_min, tags } = team.triggers;

  // Type match
  if (types && types.length > 0) {
    if (!types.includes(workItem.type)) return false;
  }

  // Priority minimum
  if (priority_min != null) {
    if (workItem.priority < priority_min) return false;
  }

  // Tag match (all specified tags must be present)
  if (tags) {
    for (const [tagKey, tagValues] of Object.entries(tags)) {
      const itemTags = workItem.tags[tagKey];
      if (!itemTags) return false;
      if (!tagValues.some((v) => itemTags.includes(v))) return false;
    }
  }

  return true;
}

/**
 * Write built-in team files to ~/.opcom/teams/ if they don't exist.
 */
export async function writeBuiltinTeams(): Promise<void> {
  const dir = teamsDir();
  await mkdir(dir, { recursive: true });

  for (const [id, team] of Object.entries(BUILTIN_TEAMS)) {
    const path = teamPath(id);
    if (!existsSync(path)) {
      const yaml = teamToYaml(team);
      await writeFile(path, yaml, "utf-8");
    }
  }
}

// --- YAML helpers ---

const VALID_VERIFICATION_MODES: Set<string> = new Set([
  "test-gate", "oracle", "confirmation", "output-exists", "none",
]);

/**
 * Parse a team YAML file.
 */
export function parseTeamYaml(content: string): TeamDefinition | null {
  // Teams use a structured format with nested steps.
  // The lightweight frontmatter parser doesn't handle nested objects,
  // so we parse the top-level fields and steps section separately.
  const hasFrontmatter = content.trimStart().startsWith("---");
  const toParse = hasFrontmatter ? content : `---\n${content}\n---`;

  const parsed = parseFrontmatter(toParse);
  if (!parsed || !parsed.id) return null;

  const team: TeamDefinition = {
    id: String(parsed.id),
    name: String(parsed.name ?? capitalize(String(parsed.id))),
    steps: [],
  };

  if (typeof parsed.description === "string") {
    team.description = parsed.description;
  }

  // Parse steps from the raw content (structured YAML that parseFrontmatter can't handle)
  team.steps = parseTeamSteps(content);
  if (team.steps.length === 0) return null;

  // Parse triggers
  team.triggers = parseTeamTriggers(content);

  return team;
}

/**
 * Parse team steps from YAML content.
 * Handles the nested structure that parseFrontmatter can't.
 */
function parseTeamSteps(content: string): TeamStep[] {
  const steps: TeamStep[] = [];
  const lines = content.split("\n");

  let inSteps = false;
  let currentStep: Partial<TeamStep> | null = null;

  for (const line of lines) {
    // Detect steps section
    if (line.match(/^steps\s*:/)) {
      inSteps = true;
      continue;
    }

    // End of steps section (another top-level key)
    if (inSteps && line.match(/^[a-zA-Z]/) && !line.match(/^\s/)) {
      if (currentStep?.role) steps.push(currentStep as TeamStep);
      inSteps = false;
      currentStep = null;
      continue;
    }

    if (!inSteps) continue;

    // New step item
    if (line.match(/^\s+-\s+role\s*:/)) {
      if (currentStep?.role) steps.push(currentStep as TeamStep);
      const roleMatch = line.match(/role\s*:\s*(\S+)/);
      currentStep = { role: roleMatch?.[1] ?? "" };
      continue;
    }

    // Step properties
    if (currentStep && line.match(/^\s+\w/)) {
      const kvMatch = line.match(/^\s+(\w[\w_]*)\s*:\s*(.*)/);
      if (kvMatch) {
        const [, key, val] = kvMatch;
        const trimmed = val.trim().replace(/^["']|["']$/g, "");
        switch (key) {
          case "verification":
            if (VALID_VERIFICATION_MODES.has(trimmed)) {
              currentStep.verification = trimmed as VerificationMode;
            }
            break;
          case "depends_on":
            currentStep.depends_on = trimmed;
            break;
          case "skills":
            // Handle inline array: [a, b, c]
            if (trimmed.startsWith("[")) {
              currentStep.skills = trimmed
                .slice(1, -1)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            }
            break;
        }
      }
    }
  }

  // Flush last step
  if (currentStep?.role) steps.push(currentStep as TeamStep);

  return steps;
}

/**
 * Parse team triggers from YAML content.
 */
function parseTeamTriggers(content: string): TeamDefinition["triggers"] | undefined {
  const lines = content.split("\n");

  let inTriggers = false;
  const types: string[] = [];
  let priorityMin: number | undefined;

  for (const line of lines) {
    if (line.match(/^triggers\s*:/)) {
      inTriggers = true;
      continue;
    }

    if (inTriggers && line.match(/^[a-zA-Z]/) && !line.match(/^\s/)) {
      inTriggers = false;
      continue;
    }

    if (!inTriggers) continue;

    // types: [feature, task]
    const typesMatch = line.match(/^\s+types\s*:\s*\[(.*)\]/);
    if (typesMatch) {
      types.push(
        ...typesMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      continue;
    }

    // types as list items
    if (types.length > 0 || line.match(/^\s+types\s*:/)) {
      const listItem = line.match(/^\s+-\s+(\S+)/);
      if (listItem && !line.match(/types\s*:/)) {
        types.push(listItem[1]);
      }
    }

    // priority_min: 1
    const priMatch = line.match(/^\s+priority_min\s*:\s*(\d+)/);
    if (priMatch) {
      priorityMin = parseInt(priMatch[1], 10);
    }
  }

  if (types.length === 0 && priorityMin == null) return undefined;

  return {
    ...(types.length > 0 ? { types } : {}),
    ...(priorityMin != null ? { priority_min: priorityMin } : {}),
  };
}

function teamToYaml(team: TeamDefinition): string {
  const lines: string[] = [];
  lines.push(`id: ${team.id}`);
  lines.push(`name: ${team.name}`);
  if (team.description) lines.push(`description: ${JSON.stringify(team.description)}`);

  lines.push("steps:");
  for (const step of team.steps) {
    lines.push(`  - role: ${step.role}`);
    if (step.verification) lines.push(`    verification: ${step.verification}`);
    if (step.depends_on) lines.push(`    depends_on: ${step.depends_on}`);
    if (step.skills?.length) lines.push(`    skills: [${step.skills.join(", ")}]`);
  }

  if (team.triggers) {
    lines.push("triggers:");
    if (team.triggers.types?.length) {
      lines.push(`  types: [${team.triggers.types.join(", ")}]`);
    }
    if (team.triggers.priority_min != null) {
      lines.push(`  priority_min: ${team.triggers.priority_min}`);
    }
  }

  return lines.join("\n") + "\n";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
