import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkItem } from "@opcom/types";

/**
 * Serialize a WorkItem into YAML frontmatter + markdown body.
 */
export function workItemToMarkdown(item: WorkItem, body?: string): string {
  const lines: string[] = ["---"];

  lines.push(`id: ${item.id}`);
  lines.push(`title: "${item.title.replace(/"/g, '\\"')}"`);
  lines.push(`status: ${item.status}`);
  lines.push(`type: ${item.type}`);
  lines.push(`priority: ${item.priority}`);

  if (item.created) {
    lines.push(`created: "${item.created}"`);
  }
  if (item.due) {
    lines.push(`due: "${item.due}"`);
  }
  if (item.scheduled) {
    lines.push(`scheduled: "${item.scheduled}"`);
  }
  if (item.parent) {
    lines.push(`milestone: ${item.parent}`);
  }

  // Deps
  if (item.deps.length > 0) {
    lines.push("deps:");
    for (const dep of item.deps) {
      lines.push(`  - ${dep}`);
    }
  }

  // Links
  if (item.links.length > 0) {
    lines.push("links:");
    for (const link of item.links) {
      lines.push(`  - ${link}`);
    }
  }

  // Tags as individual frontmatter lists
  for (const [key, values] of Object.entries(item.tags)) {
    if (values.length > 0) {
      lines.push(`${key}:`);
      for (const v of values) {
        lines.push(`  - ${v}`);
      }
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(`# ${item.title}`);

  if (body) {
    lines.push("");
    lines.push(body);
  }

  lines.push("");

  return lines.join("\n");
}

export interface WriteResult {
  written: number;
  skipped: number;
  paths: string[];
}

/**
 * Write work items to .tickets/ directory as markdown files with frontmatter.
 * Each item gets its own directory with a README.md inside.
 * Skips items that already exist on disk.
 */
export async function writeWorkItemsToTickets(
  projectPath: string,
  items: WorkItem[],
  descriptions?: Map<string, string>,
): Promise<WriteResult> {
  const ticketDir = join(projectPath, ".tickets", "impl");
  await mkdir(ticketDir, { recursive: true });

  let written = 0;
  let skipped = 0;
  const paths: string[] = [];

  for (const item of items) {
    const itemDir = join(ticketDir, item.id);

    if (existsSync(itemDir)) {
      skipped++;
      continue;
    }

    await mkdir(itemDir, { recursive: true });

    const body = descriptions?.get(item.id);
    const content = workItemToMarkdown(item, body);
    const filePath = join(itemDir, "README.md");
    await writeFile(filePath, content, "utf-8");

    // Update filePath on the item so callers have the written path
    item.filePath = filePath;
    paths.push(filePath);
    written++;
  }

  return { written, skipped, paths };
}
