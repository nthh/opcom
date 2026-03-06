import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { WorkSystemInfo, WorkItem, WorkSummary, DetectionEvidence } from "@opcom/types";

export interface TicketDetectionResult {
  workSystem: WorkSystemInfo;
  evidence: DetectionEvidence[];
}

export async function detectTicketSystem(projectPath: string): Promise<TicketDetectionResult | null> {
  const ticketDir = join(projectPath, ".tickets");
  if (!existsSync(ticketDir)) return null;

  // Check if it's trk (has scripts/trk.py)
  const isTrk = existsSync(join(projectPath, "scripts", "trk.py"));
  const type = isTrk ? "trk" as const : "tickets-dir" as const;

  return {
    workSystem: {
      type,
      ticketDir: existsSync(join(projectPath, ".tickets", "impl")) ? ".tickets/impl" : ".tickets",
    },
    evidence: [
      { file: ".tickets/", detectedAs: `work-system:${type}` },
    ],
  };
}

export async function scanTickets(projectPath: string): Promise<WorkItem[]> {
  // Try .tickets/impl/ first (trk convention), fall back to .tickets/ directly
  let implDir = join(projectPath, ".tickets", "impl");
  if (!existsSync(implDir)) {
    implDir = join(projectPath, ".tickets");
    if (!existsSync(implDir)) return [];
  }

  const entries = await readdir(implDir, { withFileTypes: true });
  const items: WorkItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const readmePath = join(implDir, entry.name, "README.md");
    if (!existsSync(readmePath)) continue;

    try {
      const content = await readFile(readmePath, "utf-8");
      const item = parseTicketFile(content, readmePath, entry.name);
      if (item) items.push(item);
    } catch {
      // Skip unreadable tickets
    }
  }

  return items;
}

export function parseTicketFile(content: string, filePath: string, dirName: string): WorkItem | null {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    return {
      id: dirName,
      title: dirName,
      status: "open",
      priority: 2,
      type: "feature",
      filePath,
      deps: [],
      links: [],
      tags: {},
    };
  }

  return {
    id: String(frontmatter.id ?? dirName),
    title: String(frontmatter.title ?? dirName),
    status: normalizeStatus(typeof frontmatter.status === "string" ? frontmatter.status : undefined),
    priority: typeof frontmatter.priority === "number" ? frontmatter.priority : 2,
    type: String(frontmatter.type ?? "feature"),
    filePath,
    parent: typeof frontmatter.milestone === "string" ? frontmatter.milestone : undefined,
    created: typeof frontmatter.created === "string" ? frontmatter.created : undefined,
    deps: Array.isArray(frontmatter.deps) ? frontmatter.deps.map(String) : [],
    links: Array.isArray(frontmatter.links) ? frontmatter.links.map(String) : [],
    tags: {
      ...(Array.isArray(frontmatter.services) ? { services: frontmatter.services.map(String) } : {}),
      ...(Array.isArray(frontmatter.domains) ? { domains: frontmatter.domains.map(String) } : {}),
    },
    role: typeof frontmatter.role === "string" ? frontmatter.role : undefined,
  };
}

function normalizeStatus(raw?: string): WorkItem["status"] {
  if (!raw) return "open";
  const s = raw.toLowerCase().trim();
  if (s === "closed" || s === "done" || s === "completed") return "closed";
  if (s === "in-progress" || s === "in_progress" || s === "active") return "in-progress";
  if (s === "deferred" || s === "backlog") return "deferred";
  return "open";
}

export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const lines = match[1].split("\n");
  const result: Record<string, unknown> = {};
  let currentKey = "";
  let currentList: string[] | null = null;

  for (const line of lines) {
    // List item
    if (line.match(/^\s+-\s+/) && currentKey) {
      const value = line.replace(/^\s+-\s+/, "").trim();
      if (!currentList) currentList = [];
      currentList.push(value);
      result[currentKey] = currentList;
      continue;
    }

    // Key-value
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      // Save previous list
      currentList = null;
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === "" || value === "[]") {
        result[currentKey] = value === "[]" ? [] : undefined;
      } else if (value === "true") {
        result[currentKey] = true;
      } else if (value === "false") {
        result[currentKey] = false;
      } else if (/^\d+$/.test(value)) {
        result[currentKey] = parseInt(value, 10);
      } else {
        // Strip quotes
        result[currentKey] = value.replace(/^["']|["']$/g, "");
      }
    }
  }

  return result;
}

export function summarizeWorkItems(items: WorkItem[]): WorkSummary {
  return {
    total: items.length,
    open: items.filter((i) => i.status === "open").length,
    inProgress: items.filter((i) => i.status === "in-progress").length,
    closed: items.filter((i) => i.status === "closed").length,
    deferred: items.filter((i) => i.status === "deferred").length,
  };
}
