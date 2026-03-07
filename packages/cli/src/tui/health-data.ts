// Health data computation for TUI health bar and health view.
// Extracts audit + coverage logic from traceability commands into pure data functions.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { scanTickets, parseFrontmatter } from "@opcom/core";

// --- Types ---

export interface SpecCoverageItem {
  name: string;
  sections: number;
  ticketCount: number;
  status: "covered" | "partial" | "uncovered";
}

export interface SpecSectionCoverage {
  anchor: string;
  title: string;
  tickets: Array<{ id: string; status: string }>;
}

export interface BrokenLink {
  ticket: string;
  link: string;
  reason: string;
}

export interface UseCaseSummary {
  id: string;
  title: string;
  done: number;
  total: number;
}

export interface HealthData {
  specCount: number;
  specsCovered: number;
  specsPartial: number;
  specsUncovered: number;
  specs: SpecCoverageItem[];
  ticketCount: number;
  ticketsWithSpec: number;
  ticketsWithoutSpec: number;
  brokenLinks: BrokenLink[];
  useCases: UseCaseSummary[];
}

// --- Shared helpers (mirrored from traceability.ts) ---

const SECTION_PATTERN = /^##\s+(.+?)\s*\{#([a-z0-9][\w-]*)\}\s*$/gm;
const SKIP_ANCHORS = new Set([
  "overview", "summary", "architecture", "non-goals",
  "references", "dependencies", "related-docs",
]);

interface SpecSection {
  title: string;
  anchor: string;
  specFile: string;
  specName: string;
}

export function extractSections(specPath: string): SpecSection[] {
  const content = readFileSync(specPath, "utf-8");
  const specName = basename(specPath, ".md");
  const sections: SpecSection[] = [];
  for (const match of content.matchAll(SECTION_PATTERN)) {
    if (!SKIP_ANCHORS.has(match[2])) {
      sections.push({
        title: match[1].replace(/\s*\{#[^}]+\}/, "").trim(),
        anchor: match[2],
        specFile: specPath,
        specName,
      });
    }
  }
  return sections;
}

function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== "/") {
    if (existsSync(join(dir, ".tickets")) || existsSync(join(dir, "AGENTS.md")) || existsSync(join(dir, "CLAUDE.md"))) return dir;
    dir = join(dir, "..");
  }
  return process.cwd();
}

function getTicketsDir(root: string): string {
  const impl = join(root, ".tickets", "impl");
  return existsSync(impl) ? impl : join(root, ".tickets");
}

function getSpecDir(root: string): string {
  return join(root, "docs", "spec");
}

// --- Main computation ---

export async function computeHealthData(root?: string): Promise<HealthData> {
  const projectRoot = root ?? findProjectRoot();
  const specDir = getSpecDir(projectRoot);

  const specFiles = existsSync(specDir)
    ? readdirSync(specDir).filter(f => f.endsWith(".md")).sort()
    : [];

  const tickets = existsSync(join(projectRoot, ".tickets"))
    ? await scanTickets(projectRoot)
    : [];

  // Build spec → ticket count map
  const specTicketCounts = new Map<string, number>();
  for (const t of tickets) {
    for (const link of t.links) {
      const specMatch = link.match(/(?:docs\/)?spec\/([^#.]+)/);
      if (specMatch) {
        const name = specMatch[1];
        specTicketCounts.set(name, (specTicketCounts.get(name) ?? 0) + 1);
      }
    }
  }

  // Build spec coverage list
  let covered = 0;
  let partial = 0;
  let uncovered = 0;
  const specs: SpecCoverageItem[] = [];

  for (const f of specFiles) {
    const name = f.replace(".md", "");
    const fullPath = join(specDir, f);
    const sections = extractSections(fullPath);
    const ticketCount = specTicketCounts.get(name) ?? 0;

    let status: "covered" | "partial" | "uncovered";
    if (ticketCount === 0) {
      status = "uncovered";
      uncovered++;
    } else if (sections.length > 0 && ticketCount < sections.length) {
      status = "partial";
      partial++;
    } else {
      status = "covered";
      covered++;
    }

    specs.push({ name, sections: sections.length, ticketCount, status });
  }

  // Ticket health
  const ticketsWithSpec = tickets.filter(t =>
    t.links.some(l => l.includes("spec/") || l.includes("spec\\"))
  );
  const ticketsWithoutSpec = tickets.filter(t =>
    !t.links.some(l => l.includes("spec/") || l.includes("spec\\"))
  );

  // Link validation
  const brokenLinks: BrokenLink[] = [];
  for (const t of tickets) {
    for (const link of t.links) {
      if (link.startsWith("[[")) continue;
      const parts = link.split("#");
      const filePath = join(projectRoot, parts[0]);
      if (!existsSync(filePath)) {
        brokenLinks.push({ ticket: t.id, link, reason: "file not found" });
      } else if (parts[1]) {
        const content = readFileSync(filePath, "utf-8");
        if (!content.includes(`{#${parts[1]}}`)) {
          const headings = [...content.matchAll(/^##\s+(.+?)(?:\s*\{#[^}]+\})?\s*$/gm)];
          const slugMatches = headings.some(h => {
            const slug = h[1].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            return slug === parts[1];
          });
          if (!slugMatches) {
            brokenLinks.push({ ticket: t.id, link, reason: "anchor not found" });
          }
        }
      }
    }
  }

  // Use cases
  const useCases = computeUseCases(projectRoot, tickets);

  return {
    specCount: specFiles.length,
    specsCovered: covered,
    specsPartial: partial,
    specsUncovered: uncovered,
    specs,
    ticketCount: tickets.length,
    ticketsWithSpec: ticketsWithSpec.length,
    ticketsWithoutSpec: ticketsWithoutSpec.length,
    brokenLinks,
    useCases,
  };
}

// --- Section-level coverage for drill-down ---

export async function computeSpecSectionCoverage(specName: string, root?: string): Promise<SpecSectionCoverage[]> {
  const projectRoot = root ?? findProjectRoot();
  const specDir = getSpecDir(projectRoot);
  const specPath = join(specDir, `${specName}.md`);

  if (!existsSync(specPath)) return [];

  const sections = extractSections(specPath);
  const tickets = await scanTickets(projectRoot);

  return sections.map(section => {
    const matching = tickets.filter(t =>
      t.links.some(l => l.includes(specName) && l.includes(section.anchor))
    );

    if (matching.length === 0) {
      // Check for loose match (spec link without anchor)
      const looseMatch = tickets.filter(t =>
        t.links.some(l => l.includes(specName) && !l.includes("#"))
      );
      if (looseMatch.length > 0) {
        return {
          anchor: section.anchor,
          title: section.title,
          tickets: looseMatch.map(t => ({ id: t.id, status: t.status })),
        };
      }
    }

    return {
      anchor: section.anchor,
      title: section.title,
      tickets: matching.map(t => ({ id: t.id, status: t.status })),
    };
  });
}

// --- Use case helpers ---

function computeUseCases(root: string, tickets: Array<{ id: string; status: string }>): UseCaseSummary[] {
  const ucDir = join(root, "docs", "use-cases");
  if (!existsSync(ucDir)) return [];

  const results: UseCaseSummary[] = [];
  for (const f of readdirSync(ucDir).filter(f => f.endsWith(".md"))) {
    const content = readFileSync(join(ucDir, f), "utf-8");
    const fm = parseUseCaseYaml(content);
    if (!fm || !fm.id) continue;

    const requires = fm.requires as Record<string, string[]> | undefined;
    let done = 0;
    let total = 0;

    if (requires && typeof requires === "object" && !Array.isArray(requires)) {
      for (const [category, items] of Object.entries(requires)) {
        if (!Array.isArray(items)) continue;
        total += items.length;
        for (const item of items) {
          let ok = false;
          switch (category) {
            case "specs":
              ok = existsSync(join(root, "docs", "spec", `${item}.md`));
              break;
            case "tickets":
            case "features":
              ok = tickets.some(t => t.id === item && t.status === "closed");
              break;
          }
          if (ok) done++;
        }
      }
    }

    results.push({
      id: String(fm.id),
      title: String(fm.title ?? f.replace(".md", "")),
      done,
      total,
    });
  }

  return results;
}

function parseUseCaseYaml(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const lines = match[1].split("\n");
  const result: Record<string, unknown> = {};
  let currentKey = "";
  let currentSubKey = "";
  let currentList: string[] | null = null;
  let nestedObj: Record<string, string[]> | null = null;

  for (const line of lines) {
    const nestedListMatch = line.match(/^\s{4,}-\s+(.+)/);
    if (nestedListMatch && nestedObj && currentSubKey) {
      if (!nestedObj[currentSubKey]) nestedObj[currentSubKey] = [];
      nestedObj[currentSubKey].push(nestedListMatch[1].trim());
      continue;
    }

    const subKeyMatch = line.match(/^\s{2}(\w[\w-]*)\s*:\s*(.*)/);
    if (subKeyMatch && nestedObj) {
      currentSubKey = subKeyMatch[1];
      currentList = null;
      const val = subKeyMatch[2].trim();
      nestedObj[currentSubKey] = val && val !== "[]" ? [val] : [];
      continue;
    }

    if (line.match(/^\s+-\s+/) && currentKey && !nestedObj) {
      const value = line.replace(/^\s+-\s+/, "").trim();
      if (!currentList) currentList = [];
      currentList.push(value);
      result[currentKey] = currentList;
      continue;
    }

    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      if (nestedObj && currentKey) {
        result[currentKey] = nestedObj;
      }
      currentList = null;
      nestedObj = null;
      currentSubKey = "";
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === "" || value === "[]") {
        result[currentKey] = value === "[]" ? [] : undefined;
        nestedObj = {};
      } else if (value === "true") {
        result[currentKey] = true;
      } else if (value === "false") {
        result[currentKey] = false;
      } else if (/^\d+$/.test(value)) {
        result[currentKey] = parseInt(value, 10);
      } else {
        result[currentKey] = value.replace(/^["']|["']$/g, "");
      }
    }
  }

  if (nestedObj && currentKey) {
    const hasContent = Object.values(nestedObj).some(v => v.length > 0);
    if (hasContent) {
      result[currentKey] = nestedObj;
    }
  }

  return result;
}

// --- Project-scoped spec computation (for L2 project detail) ---

export function computeProjectSpecs(
  tickets: Array<{ links: string[] }>,
  allSpecs: SpecCoverageItem[],
): SpecCoverageItem[] {
  // Count how many of this project's tickets reference each spec
  const specTicketCounts = new Map<string, number>();
  for (const t of tickets) {
    for (const link of t.links) {
      const specMatch = link.match(/(?:docs\/)?spec\/([^#.]+)/);
      if (specMatch) {
        const name = specMatch[1];
        specTicketCounts.set(name, (specTicketCounts.get(name) ?? 0) + 1);
      }
    }
  }

  // Only include specs that are referenced by at least one ticket
  const result: SpecCoverageItem[] = [];
  for (const spec of allSpecs) {
    const count = specTicketCounts.get(spec.name);
    if (count !== undefined && count > 0) {
      let status: "covered" | "partial" | "uncovered";
      if (spec.sections > 0 && count < spec.sections) {
        status = "partial";
      } else {
        status = "covered";
      }
      result.push({ name: spec.name, sections: spec.sections, ticketCount: count, status });
    }
  }

  // Sort by ticket count descending
  result.sort((a, b) => b.ticketCount - a.ticketCount);
  return result;
}

// --- Health bar formatting (pure function for testability) ---

export function formatHealthBar(data: HealthData): string {
  const specPct = data.specCount > 0
    ? Math.round(((data.specsCovered + data.specsPartial) / data.specCount) * 100)
    : 0;
  const ticketPct = data.ticketCount > 0
    ? Math.round((data.ticketsWithSpec / data.ticketCount) * 100)
    : 0;

  const parts: string[] = [];
  parts.push(`${data.specCount} specs (${specPct}% covered)`);
  parts.push(`${data.ticketCount} tickets (${ticketPct}% linked)`);

  if (data.useCases.length > 0) {
    const uc = data.useCases[0];
    const ucPct = uc.total > 0 ? Math.round((uc.done / uc.total) * 100) : 0;
    parts.push(`${uc.id}: ${ucPct}%`);
  }

  parts.push(`${data.brokenLinks.length} broken`);

  return parts.join("  ");
}

export function isHealthWarning(data: HealthData): boolean {
  if (data.brokenLinks.length > 0) return true;
  if (data.ticketCount > 0 && (data.ticketsWithoutSpec / data.ticketCount) > 0.25) return true;
  return false;
}
