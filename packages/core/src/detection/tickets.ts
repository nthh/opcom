import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type { WorkSystemInfo, WorkItem, WorkSummary, DetectionEvidence, VerificationMode, FieldMapping } from "@opcom/types";
import { extractSubtasks } from "../orchestrator/planner.js";

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
    const dirPath = join(implDir, entry.name);
    const readmePath = join(dirPath, "README.md");
    if (!existsSync(readmePath)) continue;

    try {
      const content = await readFile(readmePath, "utf-8");
      const item = parseTicketFile(content, readmePath, entry.name);
      if (item) items.push(item);
    } catch {
      // Skip unreadable tickets
    }

    // Scan sibling .md files as sub-tickets
    try {
      const dirEntries = await readdir(dirPath, { withFileTypes: true });
      for (const fileEntry of dirEntries) {
        if (!fileEntry.isFile()) continue;
        if (fileEntry.name === "README.md") continue;
        if (extname(fileEntry.name) !== ".md") continue;

        const filePath = join(dirPath, fileEntry.name);
        try {
          const content = await readFile(filePath, "utf-8");
          // Skip sibling .md files without frontmatter (not tickets)
          if (!parseFrontmatter(content)) continue;
          const fileBaseName = basename(fileEntry.name, ".md");
          const item = parseTicketFile(content, filePath, fileBaseName);
          if (item) {
            // Infer parent from directory name if not set by frontmatter
            if (!item.parent) {
              item.parent = entry.name;
            }
            items.push(item);
          }
        } catch {
          // Skip unreadable sub-ticket files
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return items;
}

export function parseTicketFile(content: string, filePath: string, dirName: string): WorkItem | null {
  const frontmatter = parseFrontmatter(content);
  const body = extractBody(content);

  // Only extract subtasks for top-level tickets (no parent).
  // Sub-ticket files (with parent) have task checkboxes as internal
  // agent guidance, not separate plan steps.
  const hasParent = frontmatter && (
    typeof frontmatter.dir === "string"
    || typeof frontmatter.milestone === "string"
    || typeof frontmatter.parent === "string"
  );
  const subtasks = (!hasParent && body) ? extractSubtasks(body) : [];

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
      ...(subtasks.length > 0 ? { subtasks } : {}),
    };
  }

  return {
    id: String(frontmatter.id ?? dirName),
    title: String(frontmatter.title ?? dirName),
    status: normalizeStatus(typeof frontmatter.status === "string" ? frontmatter.status : undefined),
    priority: typeof frontmatter.priority === "number" ? frontmatter.priority : 2,
    type: String(frontmatter.type ?? "feature"),
    filePath,
    parent: typeof frontmatter.dir === "string" ? frontmatter.dir
      : typeof frontmatter.milestone === "string" ? frontmatter.milestone
      : typeof frontmatter.parent === "string" ? frontmatter.parent
      : undefined,
    created: typeof frontmatter.created === "string" ? frontmatter.created : undefined,
    due: typeof frontmatter.due === "string" ? frontmatter.due : undefined,
    scheduled: typeof frontmatter.scheduled === "string" ? frontmatter.scheduled : undefined,
    deps: Array.isArray(frontmatter.deps) ? frontmatter.deps.map(String) : [],
    links: Array.isArray(frontmatter.links) ? frontmatter.links.map(String) : [],
    tags: buildTags(frontmatter),
    role: typeof frontmatter.role === "string" ? frontmatter.role : undefined,
    team: typeof frontmatter.team === "string" ? frontmatter.team : undefined,
    verification: parseVerificationMode(frontmatter.verification),
    outputs: Array.isArray(frontmatter.outputs) ? frontmatter.outputs.map(String) : undefined,
    ...(subtasks.length > 0 ? { subtasks } : {}),
  };
}

function extractBody(content: string): string {
  const fmEnd = content.match(/^---\n[\s\S]*?\n---\n?/);
  if (fmEnd) return content.slice(fmEnd[0].length);
  return content;
}

const VALID_VERIFICATION_MODES: Set<string> = new Set([
  "test-gate", "oracle", "confirmation", "output-exists", "none",
]);

function parseVerificationMode(value: unknown): VerificationMode | undefined {
  if (typeof value !== "string") return undefined;
  return VALID_VERIFICATION_MODES.has(value) ? value as VerificationMode : undefined;
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

/** Known frontmatter keys that are not tags. */
const KNOWN_KEYS = new Set([
  "id", "title", "status", "type", "priority", "created", "due", "scheduled",
  "milestone", "dir", "links", "deps", "assignee", "role", "team",
  "verification", "outputs",
]);

function buildTags(frontmatter: Record<string, unknown>): Record<string, string[]> {
  const tags: Record<string, string[]> = {};

  // Well-known tag fields
  for (const key of ["services", "domains", "source", "location", "category"]) {
    if (Array.isArray(frontmatter[key])) {
      tags[key] = (frontmatter[key] as unknown[]).map(String);
    }
  }

  // Capture any additional unknown fields as extra tags
  for (const [key, value] of Object.entries(frontmatter)) {
    if (KNOWN_KEYS.has(key)) continue;
    if (tags[key]) continue; // already handled above
    if (typeof value === "string") {
      tags[key] = [value];
    } else if (Array.isArray(value)) {
      tags[key] = value.map(String);
    }
  }

  return tags;
}

/**
 * Apply project field mappings to work items.
 * For "use-case" mappings, tag values become links (e.g. docs/use-cases/<value>.md).
 */
export function applyFieldMappings(items: WorkItem[], mappings: FieldMapping[]): WorkItem[] {
  if (!mappings || mappings.length === 0) return items;

  return items.map((item) => {
    let links = item.links;
    let tags = item.tags;
    let changed = false;

    for (const mapping of mappings) {
      if (mapping.type !== "use-case") continue;

      const tagValues = item.tags[mapping.field];
      if (!tagValues || tagValues.length === 0) continue;

      // Convert tag values to links
      const newLinks = [...links];
      for (const value of tagValues) {
        const prefix = mapping.targetPath ?? "docs/use-cases/";
        const linkPath = `${prefix}${value}.md`;
        if (!newLinks.includes(linkPath)) {
          newLinks.push(linkPath);
        }
      }
      links = newLinks;

      // Remove from tags since they're now links
      if (!changed) {
        tags = { ...tags };
        changed = true;
      }
      delete tags[mapping.field];
    }

    return changed ? { ...item, links, tags } : item;
  });
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
