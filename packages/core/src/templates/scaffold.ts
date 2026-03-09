import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProjectTemplate } from "@opcom/types";
import { substituteVariables } from "./substitution.js";

export interface ScaffoldOptions {
  /** Absolute path to the project directory */
  projectDir: string;
  /** Template to apply */
  template: ProjectTemplate;
  /** Variable values for substitution (includes name + description) */
  variables: Record<string, string>;
}

export interface ScaffoldResult {
  /** Number of ticket files created */
  ticketCount: number;
  /** Whether AGENTS.md was written (false if it already existed) */
  agentsMdWritten: boolean;
  /** Directories created */
  directoriesCreated: string[];
}

/**
 * Apply a template to a project directory.
 * Creates directories, ticket files, and AGENTS.md.
 */
export async function scaffoldFromTemplate(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  const { projectDir, template, variables } = opts;
  const result: ScaffoldResult = {
    ticketCount: 0,
    agentsMdWritten: false,
    directoriesCreated: [],
  };

  // 1. Create directories from template
  if (template.directories) {
    for (const dir of template.directories) {
      const dirPath = resolve(projectDir, dir);
      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
        result.directoriesCreated.push(dir);
      }
    }
  }

  // 2. Ensure .tickets/impl/ exists for ticket files
  const ticketsImplDir = join(projectDir, ".tickets/impl");
  if (!existsSync(ticketsImplDir)) {
    await mkdir(ticketsImplDir, { recursive: true });
  }

  // 3. Write ticket files with variable substitution
  for (const [filename, content] of Object.entries(template.tickets)) {
    const ticketPath = join(ticketsImplDir, filename);
    if (!existsSync(ticketPath)) {
      const processed = substituteVariables(content, variables);
      await writeFile(ticketPath, processed, "utf-8");
      result.ticketCount++;
    }
  }

  // 4. Write AGENTS.md if it doesn't exist
  const agentsMdPath = join(projectDir, "AGENTS.md");
  if (!existsSync(agentsMdPath)) {
    const processed = substituteVariables(template.agentsMd, variables);
    await writeFile(agentsMdPath, processed, "utf-8");
    result.agentsMdWritten = true;
  }

  return result;
}
