import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  ProjectCommand,
  AgentConstraint,
  FieldMapping,
  ProjectProfileConfig,
  DetectionEvidence,
} from "@opcom/types";
import { parseFrontmatter } from "./tickets.js";

export interface ProfileDetectionResult {
  profile: Partial<ProjectProfileConfig>;
  evidence: DetectionEvidence[];
}

// ===================================================================
// Build System Parsing — detect project commands from build files
// ===================================================================

interface BuildSystemTargets {
  system: string;
  prefix: string;
  targets: string[];
  sourceFile: string;
}

/**
 * Detect profile commands by parsing build system files.
 * Priority: Makefile > justfile > taskfile.yml > package.json
 */
export async function detectProfileCommands(
  projectPath: string,
): Promise<{ commands: ProjectCommand[]; evidence: DetectionEvidence[] }> {
  const evidence: DetectionEvidence[] = [];
  const systems: BuildSystemTargets[] = [];

  // Makefile
  const makefilePath = join(projectPath, "Makefile");
  if (existsSync(makefilePath)) {
    try {
      const content = await readFile(makefilePath, "utf-8");
      const targets = parseMakefileTargets(content);
      if (targets.length > 0) {
        systems.push({ system: "make", prefix: "make", targets, sourceFile: "Makefile" });
        evidence.push({ file: "Makefile", detectedAs: "profile:commands", details: `${targets.length} targets` });
      }
    } catch { /* skip */ }
  }

  // justfile
  const justfilePath = join(projectPath, "justfile");
  if (existsSync(justfilePath)) {
    try {
      const content = await readFile(justfilePath, "utf-8");
      const targets = parseJustfileRecipes(content);
      if (targets.length > 0) {
        systems.push({ system: "just", prefix: "just", targets, sourceFile: "justfile" });
        evidence.push({ file: "justfile", detectedAs: "profile:commands", details: `${targets.length} recipes` });
      }
    } catch { /* skip */ }
  }

  // taskfile.yml
  for (const taskFile of ["taskfile.yml", "Taskfile.yml", "taskfile.yaml", "Taskfile.yaml"]) {
    const taskfilePath = join(projectPath, taskFile);
    if (existsSync(taskfilePath)) {
      try {
        const content = await readFile(taskfilePath, "utf-8");
        const data = parseYaml(content) as Record<string, unknown>;
        const targets = parseTaskfileTargets(data);
        if (targets.length > 0) {
          systems.push({ system: "task", prefix: "task", targets, sourceFile: taskFile });
          evidence.push({ file: taskFile, detectedAs: "profile:commands", details: `${targets.length} tasks` });
        }
      } catch { /* skip */ }
      break;
    }
  }

  // package.json scripts
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const content = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(content) as Record<string, unknown>;
      const scripts = pkg.scripts;
      if (scripts && typeof scripts === "object") {
        const targets = Object.keys(scripts as Record<string, unknown>);
        if (targets.length > 0) {
          systems.push({ system: "npm", prefix: "npm run", targets, sourceFile: "package.json" });
          evidence.push({ file: "package.json", detectedAs: "profile:commands", details: `${targets.length} scripts` });
        }
      }
    } catch { /* skip */ }
  }

  if (systems.length === 0) return { commands: [], evidence };

  // Prefer top-level build system (Makefile > justfile > taskfile > package.json)
  const primary = systems[0];
  const commands = mapTargetsToCommands(primary.targets, primary.prefix);

  return { commands, evidence };
}

/** Parse Makefile targets: lines matching `^target-name:` */
export function parseMakefileTargets(content: string): string[] {
  const targets: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^([a-zA-Z][\w-]*)\s*:/);
    if (match) targets.push(match[1]);
  }
  return targets;
}

/** Parse justfile recipes: lines matching `^recipe-name:` */
export function parseJustfileRecipes(content: string): string[] {
  const recipes: string[] = [];
  for (const line of content.split("\n")) {
    // justfile recipes: `recipe-name:` or `recipe-name arg:` at start of line
    const match = line.match(/^([a-zA-Z][\w-]*)\s*[\w\s]*:/);
    if (match) recipes.push(match[1]);
  }
  return recipes;
}

/** Parse taskfile.yml targets from `tasks:` top-level key */
export function parseTaskfileTargets(data: Record<string, unknown>): string[] {
  const tasks = data.tasks;
  if (!tasks || typeof tasks !== "object") return [];
  return Object.keys(tasks as Record<string, unknown>);
}

/** Well-known target names for mapping to profile commands */
const SMOKE_TEST_NAMES = new Set(["test-smoke", "test:smoke", "test-fast", "test:fast"]);
const FULL_TEST_NAMES = new Set(["test-all", "test:all", "test-full", "test:full"]);
const TEST_NAMES = new Set(["test"]);
const BUILD_NAMES = new Set(["build"]);
const DEPLOY_NAMES = new Set(["deploy"]);
const LINT_NAMES = new Set(["lint", "check"]);

/**
 * Map build system targets to profile commands using priority rules:
 * - smoke test variant → commands.test (fast gate)
 * - test (when smoke exists) → commands.testFull
 * - test (when no smoke) → commands.test
 * - build → commands.build
 * - deploy → commands.deploy
 * - lint/check → commands.lint
 */
export function mapTargetsToCommands(targets: string[], prefix: string): ProjectCommand[] {
  const commands: ProjectCommand[] = [];
  const targetSet = new Set(targets);

  const hasSmokeTest = targets.some((t) => SMOKE_TEST_NAMES.has(t));
  const smokeTarget = targets.find((t) => SMOKE_TEST_NAMES.has(t));
  const testTarget = targets.find((t) => TEST_NAMES.has(t));
  const fullTestTarget = targets.find((t) => FULL_TEST_NAMES.has(t));

  // Test gate
  if (hasSmokeTest && smokeTarget) {
    commands.push({ name: "test", command: `${prefix} ${smokeTarget}`, description: "fast test gate" });
    // Full suite
    if (fullTestTarget) {
      commands.push({ name: "testFull", command: `${prefix} ${fullTestTarget}`, description: "full test suite" });
    } else if (testTarget) {
      commands.push({ name: "testFull", command: `${prefix} ${testTarget}`, description: "full test suite" });
    }
  } else if (testTarget) {
    commands.push({ name: "test", command: `${prefix} ${testTarget}` });
  }

  // Build
  const buildTarget = targets.find((t) => BUILD_NAMES.has(t));
  if (buildTarget) {
    commands.push({ name: "build", command: `${prefix} ${buildTarget}` });
  }

  // Deploy
  const deployTarget = targets.find((t) => DEPLOY_NAMES.has(t));
  if (deployTarget) {
    commands.push({ name: "deploy", command: `${prefix} ${deployTarget}` });
  }

  // Lint
  const lintTarget = targets.find((t) => LINT_NAMES.has(t));
  if (lintTarget) {
    commands.push({ name: "lint", command: `${prefix} ${lintTarget}` });
  }

  return commands;
}

// ===================================================================
// Agent Config Parsing — extract constraints from agent config files
// ===================================================================

/**
 * Detect agent constraints by parsing agent config files (AGENTS.md, CLAUDE.md, etc.)
 */
export async function detectAgentConstraints(
  projectPath: string,
  agentConfigFile?: string,
): Promise<{ constraints: AgentConstraint[]; evidence: DetectionEvidence[] }> {
  if (!agentConfigFile) return { constraints: [], evidence: [] };

  const filePath = join(projectPath, agentConfigFile);
  if (!existsSync(filePath)) return { constraints: [], evidence: [] };

  try {
    const content = await readFile(filePath, "utf-8");
    const constraints: AgentConstraint[] = [];

    // Extract forbidden commands
    const forbidden = extractForbiddenCommands(content);
    if (forbidden.length > 0) {
      constraints.push({
        name: "forbidden-commands",
        rule: `Never run: ${forbidden.join(", ")}`,
      });
    }

    // Extract commit rules
    const commitRules = extractSectionRules(content, /^##.*(?:git|commit|version control)/im);
    if (commitRules) {
      constraints.push({ name: "commit-rules", rule: commitRules });
    }

    // Extract workflow rules
    const workflowRules = extractSectionRules(content, /^##.*(?:process|workflow|development|conventions)/im);
    if (workflowRules) {
      constraints.push({ name: "workflow-rules", rule: workflowRules });
    }

    const evidence: DetectionEvidence[] = [];
    if (constraints.length > 0) {
      evidence.push({
        file: agentConfigFile,
        detectedAs: "profile:agent-constraints",
        details: `${constraints.length} constraint(s)`,
      });
    }

    return { constraints, evidence };
  } catch {
    return { constraints: [], evidence: [] };
  }
}

/**
 * Extract forbidden commands from text using patterns like:
 * - "NEVER run `git reset`"
 * - "do NOT use `rm -rf`"
 * - "forbidden: `git push --force`"
 */
export function extractForbiddenCommands(content: string): string[] {
  const commands = new Set<string>();

  // Match patterns like "NEVER run `cmd`", "do NOT use `cmd`", "NEVER `cmd`"
  const patterns = [
    /(?:NEVER|never|do NOT|do not|forbidden|prohibited)\s+(?:run|use|execute)?\s*`([^`]+)`/g,
    /(?:NEVER|never|do NOT|do not)\s+.*?`([^`]+)`/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      commands.add(match[1].trim());
    }
  }

  return [...commands];
}

/**
 * Extract a summary rule from a markdown section matching a heading pattern.
 * Looks for NEVER/MUST/ALWAYS statements in the section body.
 */
function extractSectionRules(content: string, headingPattern: RegExp): string | null {
  const headingMatch = content.match(headingPattern);
  if (!headingMatch) return null;

  // Extract section body (up to next ## heading or end)
  const startIdx = headingMatch.index! + headingMatch[0].length;
  const nextHeading = content.slice(startIdx).match(/\n## /);
  const sectionBody = nextHeading
    ? content.slice(startIdx, startIdx + nextHeading.index!)
    : content.slice(startIdx);

  // Extract key rules (lines with NEVER/MUST/ALWAYS)
  const rules: string[] = [];
  for (const line of sectionBody.split("\n")) {
    const trimmed = line.replace(/^[-*]\s+/, "").trim();
    if (/\b(?:NEVER|MUST|ALWAYS|REQUIRED|IMPORTANT)\b/.test(trimmed) && trimmed.length > 10) {
      rules.push(trimmed);
    }
  }

  if (rules.length === 0) return null;
  // Take first 3 rules max to keep concise
  return rules.slice(0, 3).join("; ");
}

// ===================================================================
// Ticket Field Inference — detect field mappings from ticket samples
// ===================================================================

/** Standard frontmatter keys that are never field mappings */
const STANDARD_KEYS = new Set([
  "id", "title", "status", "type", "priority", "deps", "links",
  "created", "role", "team", "verification", "due", "scheduled",
  "milestone", "dir", "assignee", "outputs",
]);

/**
 * Detect field mappings by sampling ticket frontmatter.
 * Reads up to 20 tickets, finds non-standard fields appearing in >25% of them,
 * and infers their types.
 */
export async function detectFieldMappings(
  projectPath: string,
  ticketDir?: string,
): Promise<{ mappings: FieldMapping[]; evidence: DetectionEvidence[] }> {
  if (!ticketDir) return { mappings: [], evidence: [] };

  const absTicketDir = join(projectPath, ticketDir);
  if (!existsSync(absTicketDir)) return { mappings: [], evidence: [] };

  try {
    const entries = await readdir(absTicketDir, { withFileTypes: true });
    const ticketDirs = entries.filter((e) => e.isDirectory());

    // Sample up to 20 tickets
    const sample = ticketDirs.slice(0, 20);
    if (sample.length === 0) return { mappings: [], evidence: [] };

    // Collect frontmatter from sampled tickets
    const fieldValues = new Map<string, unknown[]>();
    let sampledCount = 0;

    for (const dir of sample) {
      const readmePath = join(absTicketDir, dir.name, "README.md");
      if (!existsSync(readmePath)) continue;

      try {
        const content = await readFile(readmePath, "utf-8");
        const fm = parseFrontmatter(content);
        if (!fm) continue;

        sampledCount++;

        for (const [key, value] of Object.entries(fm)) {
          if (STANDARD_KEYS.has(key)) continue;
          if (value === undefined || value === null) continue;

          if (!fieldValues.has(key)) fieldValues.set(key, []);
          fieldValues.get(key)!.push(value);
        }
      } catch { /* skip */ }
    }

    if (sampledCount === 0) return { mappings: [], evidence: [] };

    // Infer types for fields appearing in >25% of sampled tickets
    const threshold = sampledCount * 0.25;
    const mappings: FieldMapping[] = [];

    for (const [field, values] of fieldValues) {
      if (values.length < threshold) continue;

      const type = inferFieldType(values);
      if (type) {
        const mapping: FieldMapping = { field, type };
        if (type === "use-case") {
          mapping.targetPath = "docs/use-cases/";
        }
        mappings.push(mapping);
      }
    }

    const evidence: DetectionEvidence[] = [];
    if (mappings.length > 0) {
      evidence.push({
        file: ticketDir,
        detectedAs: "profile:field-mappings",
        details: mappings.map((m) => `${m.field} → ${m.type}`).join(", "),
      });
    }

    return { mappings, evidence };
  } catch {
    return { mappings: [], evidence: [] };
  }
}

/**
 * Infer the field type from a sample of values.
 * - UC-* or USE-CASE-* → use-case
 * - Arrays → tag
 * - Otherwise → skip
 */
function inferFieldType(values: unknown[]): FieldMapping["type"] | null {
  // Flatten: each value may be a string or an array of strings
  const allStrings: string[] = [];
  let allArrays = true;

  for (const v of values) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string") allStrings.push(item);
      }
    } else if (typeof v === "string") {
      allStrings.push(v);
      allArrays = false;
    } else {
      allArrays = false;
    }
  }

  // Check for UC-* or USE-CASE-* pattern
  if (allStrings.length > 0 && allStrings.every((s) => /^(?:UC|USE-CASE)-/i.test(s))) {
    return "use-case";
  }

  // If all values are arrays, it's a tag field
  if (allArrays && values.length > 0) {
    return "tag";
  }

  return null;
}

// ===================================================================
// Combined profile detection — runs all three detectors
// ===================================================================

/**
 * Run all profile detection steps and combine results.
 */
export async function detectProfile(
  projectPath: string,
  agentConfig?: string,
  ticketDir?: string,
): Promise<ProfileDetectionResult> {
  const [commandsResult, constraintsResult, mappingsResult] = await Promise.all([
    detectProfileCommands(projectPath),
    detectAgentConstraints(projectPath, agentConfig),
    detectFieldMappings(projectPath, ticketDir),
  ]);

  const profile: Partial<ProjectProfileConfig> = {};
  const evidence: DetectionEvidence[] = [];

  if (commandsResult.commands.length > 0) {
    profile.commands = commandsResult.commands;
  }
  evidence.push(...commandsResult.evidence);

  if (constraintsResult.constraints.length > 0) {
    profile.agentConstraints = constraintsResult.constraints;
  }
  evidence.push(...constraintsResult.evidence);

  if (mappingsResult.mappings.length > 0) {
    profile.fieldMappings = mappingsResult.mappings;
  }
  evidence.push(...mappingsResult.evidence);

  return { profile, evidence };
}

/**
 * Merge detected profile into existing profile, filling absent fields only.
 * User-edited values are never overwritten.
 */
export function mergeProfiles(
  existing: ProjectProfileConfig | undefined,
  detected: Partial<ProjectProfileConfig>,
): ProjectProfileConfig | undefined {
  if (!existing && Object.keys(detected).length === 0) return undefined;
  if (!existing) return detected as ProjectProfileConfig;

  const merged: ProjectProfileConfig = { ...existing };

  if (!merged.commands && detected.commands) {
    merged.commands = detected.commands;
  }
  if (!merged.agentConstraints && detected.agentConstraints) {
    merged.agentConstraints = detected.agentConstraints;
  }
  if (!merged.fieldMappings && detected.fieldMappings) {
    merged.fieldMappings = detected.fieldMappings;
  }

  return merged;
}
