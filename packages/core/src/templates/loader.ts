import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ProjectTemplate } from "@opcom/types";
import { templatesDir } from "../config/paths.js";
import { BUILTIN_TEMPLATES } from "./builtins.js";

/**
 * Load a single template from a directory on disk.
 * Expects: template.yaml, AGENTS.md, tickets/*.md
 */
export async function loadTemplateFromDir(dir: string): Promise<ProjectTemplate> {
  const yamlPath = join(dir, "template.yaml");
  if (!existsSync(yamlPath)) {
    throw new Error(`No template.yaml found in ${dir}`);
  }

  const raw = await readFile(yamlPath, "utf-8");
  const meta = parseYaml(raw) as {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    variables?: Array<{ name: string; prompt: string; default?: string }>;
    directories?: string[];
  };

  // Read AGENTS.md
  const agentsMdPath = join(dir, "AGENTS.md");
  const agentsMd = existsSync(agentsMdPath)
    ? await readFile(agentsMdPath, "utf-8")
    : `# {{name}}\n\n{{description}}\n`;

  // Read ticket files
  const ticketsDir = join(dir, "tickets");
  const tickets: Record<string, string> = {};
  if (existsSync(ticketsDir)) {
    const files = await readdir(ticketsDir);
    for (const file of files) {
      if (file.endsWith(".md")) {
        tickets[file] = await readFile(join(ticketsDir, file), "utf-8");
      }
    }
  }

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    tags: meta.tags,
    variables: meta.variables,
    directories: meta.directories,
    tickets,
    agentsMd,
  };
}

/**
 * Load all user templates from ~/.opcom/templates/
 */
export async function loadUserTemplates(): Promise<ProjectTemplate[]> {
  const dir = templatesDir();
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const templates: ProjectTemplate[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const templatePath = join(dir, entry.name);
    if (!existsSync(join(templatePath, "template.yaml"))) continue;
    try {
      templates.push(await loadTemplateFromDir(templatePath));
    } catch {
      // Skip invalid templates
    }
  }

  return templates;
}

/**
 * Load all available templates: built-ins + user templates.
 * User templates with the same id override built-ins.
 */
export async function loadAllTemplates(): Promise<ProjectTemplate[]> {
  const userTemplates = await loadUserTemplates();
  const userIds = new Set(userTemplates.map((t) => t.id));

  // Built-ins that aren't overridden by user templates
  const builtins = BUILTIN_TEMPLATES.filter((t) => !userIds.has(t.id));

  return [...builtins, ...userTemplates];
}

/**
 * Find a template by id from all available templates.
 */
export async function findTemplate(id: string): Promise<ProjectTemplate | null> {
  // Check user templates first (they override built-ins)
  const userTemplates = await loadUserTemplates();
  const userMatch = userTemplates.find((t) => t.id === id);
  if (userMatch) return userMatch;

  // Check built-ins
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === id);
  return builtin ?? null;
}
