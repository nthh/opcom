import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import {
  loadGlobalConfig,
  loadWorkspace,
  loadProject,
  importICalFile,
  writeWorkItemsToTickets,
  parsePastedText,
} from "@opcom/core";

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

export async function runImportCalendar(filePath: string, projectId?: string): Promise<void> {
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    console.error(`  File not found: ${absPath}`);
    process.exit(1);
  }

  // Resolve project
  let projectPath: string;
  if (projectId) {
    const global = await loadGlobalConfig();
    const workspace = await loadWorkspace(global.defaultWorkspace);
    if (!workspace) {
      console.error("  No workspace found. Run 'opcom init' first.");
      process.exit(1);
    }
    const project = await loadProject(projectId);
    if (!project) {
      console.error(`  Project '${projectId}' not found.`);
      process.exit(1);
    }
    projectPath = project.path;
  } else {
    // Default to current directory
    projectPath = process.cwd();
  }

  // Parse .ics file
  const items = await importICalFile(absPath);
  if (items.length === 0) {
    console.log("  No events found in the file.");
    return;
  }

  console.log(`  Parsed ${BOLD}${items.length}${RESET} events from ${DIM}${filePath}${RESET}`);

  // Build descriptions map from event data
  const descriptions = new Map<string, string>();
  // The parser stores description in the WorkItem — we could enhance later

  // Write to .tickets/
  const result = await writeWorkItemsToTickets(projectPath, items, descriptions);

  if (result.written > 0) {
    console.log(`  ${GREEN}Created ${result.written} work items${RESET} in .tickets/impl/`);
  }
  if (result.skipped > 0) {
    console.log(`  ${YELLOW}Skipped ${result.skipped} existing items${RESET}`);
  }

  // Show created items
  for (const item of items) {
    if (item.filePath && result.paths.includes(item.filePath)) {
      const sched = item.scheduled ? ` ${DIM}${item.scheduled}${RESET}` : "";
      console.log(`    ${item.id}: ${item.title}${sched}`);
    }
  }
}

async function resolveProjectPath(projectId?: string): Promise<string> {
  if (projectId) {
    const global = await loadGlobalConfig();
    const workspace = await loadWorkspace(global.defaultWorkspace);
    if (!workspace) {
      console.error("  No workspace found. Run 'opcom init' first.");
      process.exit(1);
    }
    const project = await loadProject(projectId);
    if (!project) {
      console.error(`  Project '${projectId}' not found.`);
      process.exit(1);
    }
    return project.path;
  }
  return process.cwd();
}

/**
 * Read lines from stdin until an empty line is entered.
 */
function readPastedLines(input: NodeJS.ReadableStream = process.stdin): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output: process.stdout, terminal: input === process.stdin });
    const lines: string[] = [];

    rl.on("line", (line: string) => {
      if (line.trim() === "") {
        rl.close();
      } else {
        lines.push(line);
      }
    });

    rl.on("close", () => {
      resolve(lines.join("\n"));
    });
  });
}

export async function runImportPaste(projectId?: string, inputText?: string): Promise<void> {
  const projectPath = await resolveProjectPath(projectId);

  let text: string;
  if (inputText !== undefined) {
    text = inputText;
  } else {
    console.log("  Paste your itinerary (empty line to finish):");
    text = await readPastedLines();
  }

  if (!text.trim()) {
    console.log("  No text provided.");
    return;
  }

  const items = parsePastedText(text);
  if (items.length === 0) {
    console.log("  No events found in pasted text.");
    return;
  }

  // Write to .tickets/
  const result = await writeWorkItemsToTickets(projectPath, items);

  if (result.written > 0) {
    console.log(`  ${GREEN}Created ${result.written} work items${RESET} from pasted text`);
  }
  if (result.skipped > 0) {
    console.log(`  ${YELLOW}Skipped ${result.skipped} existing items${RESET}`);
  }

  // Show created items
  for (const item of items) {
    if (item.filePath && result.paths.includes(item.filePath)) {
      const sched = item.scheduled ? ` ${DIM}${item.scheduled}${RESET}` : "";
      console.log(`    ${item.id}: ${item.title}${sched}`);
    }
  }
}
