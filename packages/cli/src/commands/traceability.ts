import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, relative, resolve } from "node:path";
import { scanTickets, parseFrontmatter, EventStore, detectProject, emptyStack, SessionManager, buildScaffoldEnrichmentPrompt } from "@opcom/core";
import type { ContextPacket } from "@opcom/types";

// --- Shared helpers ---

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

function extractSections(specPath: string): SpecSection[] {
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

interface ScaffoldableSection {
  anchor: string;
  title: string;
  content: string;
  linkRef: string;
}

function extractSectionContent(fileContent: string, anchor: string): string {
  const pattern = new RegExp(`^##\\s+.+?\\s*\\{#${anchor}\\}\\s*$`, "m");
  const match = fileContent.match(pattern);
  if (!match || match.index === undefined) return "";

  const sectionStart = match.index + match[0].length;
  const nextHeading = fileContent.slice(sectionStart).search(/^##\s+/m);
  const sectionEnd = nextHeading === -1 ? fileContent.length : sectionStart + nextHeading;

  return fileContent.slice(sectionStart, sectionEnd).trim();
}

function findScaffoldableSections(specPath: string, root: string): ScaffoldableSection[] {
  const fileContent = readFileSync(specPath, "utf-8");
  const sections = extractSections(specPath);
  const specName = basename(specPath, ".md");
  const relPath = relative(root, specPath);
  const existingLinks = existingTicketLinks(root);
  const ticketsDir = getTicketsDir(root);

  const result: ScaffoldableSection[] = [];
  for (const section of sections) {
    const alreadyLinked = [...existingLinks].some(l =>
      l.includes(section.anchor) && l.includes(specName)
    );
    if (alreadyLinked) continue;

    const ticketDir = join(ticketsDir, section.anchor);
    if (existsSync(ticketDir)) continue;

    const content = extractSectionContent(fileContent, section.anchor);
    result.push({
      anchor: section.anchor,
      title: section.title,
      content,
      linkRef: `${relPath}#${section.anchor}`,
    });
  }

  return result;
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

function existingTicketLinks(root: string): Set<string> {
  const links = new Set<string>();
  const ticketsDir = getTicketsDir(root);
  if (!existsSync(ticketsDir)) return links;

  for (const entry of readdirSync(ticketsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const readme = join(ticketsDir, entry.name, "README.md");
    if (!existsSync(readme)) continue;
    const content = readFileSync(readme, "utf-8");
    const fm = parseFrontmatter(content);
    if (fm && Array.isArray(fm.links)) {
      for (const link of fm.links) {
        links.add(String(link));
      }
    }
  }
  return links;
}

// --- scaffold ---

export async function runScaffold(specPath?: string, opts: { dryRun?: boolean; all?: boolean; full?: boolean } = {}): Promise<void> {
  const root = findProjectRoot();

  if (opts.full) {
    return scaffoldFull(specPath, root, opts);
  }

  if (opts.all) {
    const specDir = getSpecDir(root);
    if (!existsSync(specDir)) {
      console.log("\n  No docs/spec/ directory found.\n");
      return;
    }
    const specFiles = readdirSync(specDir).filter(f => f.endsWith(".md")).map(f => join(specDir, f));
    if (specFiles.length === 0) {
      console.log("\n  No spec files found.\n");
      return;
    }
    console.log(`\n  Scaffolding ${specFiles.length} spec file(s)...\n`);
    let totalCreated = 0;
    for (const sf of specFiles) {
      totalCreated += scaffoldSpec(sf, root, opts.dryRun ?? false);
    }
    console.log(`\n  ${opts.dryRun ? "Would create" : "Created"} ${totalCreated} ticket(s) total.\n`);
    return;
  }

  if (!specPath) {
    console.error("  Usage: opcom scaffold <spec-file> [--dry-run] [--full]");
    console.error("         opcom scaffold --all [--dry-run] [--full]");
    process.exit(1);
    return;
  }

  const resolved = resolve(specPath);
  if (!existsSync(resolved)) {
    console.error(`  Spec file not found: ${specPath}`);
    process.exit(1);
    return;
  }

  console.log("");
  const created = scaffoldSpec(resolved, root, opts.dryRun ?? false);
  console.log(`\n  ${opts.dryRun ? "Would create" : "Created"} ${created} ticket(s).\n`);
}

async function scaffoldFull(
  specPath: string | undefined,
  root: string,
  opts: { dryRun?: boolean; all?: boolean },
): Promise<void> {
  // Collect spec files
  let specFiles: string[];
  if (opts.all) {
    const specDir = getSpecDir(root);
    if (!existsSync(specDir)) {
      console.log("\n  No docs/spec/ directory found.\n");
      return;
    }
    specFiles = readdirSync(specDir).filter(f => f.endsWith(".md")).map(f => join(specDir, f));
    if (specFiles.length === 0) {
      console.log("\n  No spec files found.\n");
      return;
    }
  } else if (specPath) {
    const resolved = resolve(specPath);
    if (!existsSync(resolved)) {
      console.error(`  Spec file not found: ${specPath}`);
      process.exit(1);
      return;
    }
    specFiles = [resolved];
  } else {
    console.error("  Usage: opcom scaffold <spec-file> --full [--dry-run]");
    console.error("         opcom scaffold --all --full [--dry-run]");
    process.exit(1);
    return;
  }

  // Collect scaffoldable sections across all spec files
  const allSections: ScaffoldableSection[] = [];
  for (const sf of specFiles) {
    const sections = findScaffoldableSections(sf, root);
    const specName = basename(sf, ".md");
    if (sections.length === 0) {
      console.log(`  ${specName}: all sections already have tickets`);
    }
    allSections.push(...sections);
  }

  if (allSections.length === 0) {
    console.log("\n  No new sections to scaffold.\n");
    return;
  }

  // Dry-run: show what would be created with enrichment
  if (opts.dryRun) {
    console.log(`\n  --full --dry-run: ${allSections.length} ticket(s) would be created with rich Context Packets:\n`);
    for (const section of allSections) {
      console.log(`  would create ${section.anchor} — "${section.title}" (agent-enriched)`);
    }
    console.log(`\n  Would create ${allSections.length} enriched ticket(s) total.\n`);
    return;
  }

  // Detect project info for context
  let detection;
  try {
    detection = await detectProject(root);
  } catch {
    // Detection failure is non-fatal — proceed with empty stack
  }

  const stack = detection?.stack ?? emptyStack();
  const ticketsDir = getTicketsDir(root);
  const existingTickets = await scanTickets(root);

  // Read TEMPLATE.md for format reference
  let templateContent = "";
  const templatePath = join(root, ".tickets", "TEMPLATE.md");
  if (existsSync(templatePath)) {
    templateContent = readFileSync(templatePath, "utf-8");
  }

  // Build prompt sections with spec-relative paths
  const promptSections = allSections.map(s => ({
    anchor: s.anchor,
    title: s.title,
    content: s.content,
  }));

  // Determine the spec relative path (use first file for single-spec, generic for --all)
  const specRelPath = specFiles.length === 1
    ? relative(root, specFiles[0])
    : "docs/spec/<spec-file>.md";

  const systemPrompt = buildScaffoldEnrichmentPrompt(
    promptSections,
    allSections.map(s => s.linkRef),
    ticketsDir,
    templateContent,
    existingTickets,
    {
      languages: stack.languages.map(l => l.name + (l.version ? ` ${l.version}` : "")).join(", ") || undefined,
      frameworks: stack.frameworks.map(f => f.name).join(", ") || undefined,
      testing: detection?.testing.map(t => t.framework).join(", ") || undefined,
      services: detection?.services.map(s => s.name).join(", ") || undefined,
    },
  );

  // Build minimal context packet for agent session
  const contextPacket: ContextPacket = {
    project: {
      name: detection?.name ?? basename(root),
      path: root,
      stack,
      testing: detection?.testing ?? [],
      linting: detection?.linting ?? [],
      services: detection?.services ?? [],
    },
    git: {
      branch: detection?.git?.branch ?? "main",
      remote: detection?.git?.remote ?? null,
      clean: detection?.git?.clean ?? true,
    },
  };

  console.log(`\n  Scaffolding ${allSections.length} ticket(s) with agent enrichment...\n`);

  // Start agent session
  const sessionManager = new SessionManager();
  await sessionManager.init();

  const session = await sessionManager.startSession(
    detection?.name ?? basename(root),
    "claude-code",
    {
      projectPath: root,
      contextPacket,
      systemPrompt,
      allowedTools: ["Bash", "Write", "Read"],
    },
  );

  console.log(`  Session: ${session.id}`);
  console.log(`  Agent generating enriched tickets...\n`);

  // Stream output
  const sub = sessionManager.subscribeToSession(session.id);
  if (sub) {
    for await (const event of sub) {
      switch (event.type) {
        case "message_delta":
          if (event.data?.text) {
            process.stdout.write(event.data.text);
          }
          break;
        case "tool_start":
          console.log(`\n  > ${event.data?.toolName}${event.data?.toolInput ? ` ${event.data.toolInput.slice(0, 80)}` : ""}`);
          break;
        case "tool_end":
          if (event.data?.toolOutput) {
            const output = event.data.toolOutput.slice(0, 200);
            console.log(`    ${output}`);
          }
          break;
        case "agent_end":
          console.log(`\n  Agent finished: ${event.data?.reason ?? "completed"}`);
          break;
        case "error":
          console.error(`\n  Error: ${event.data?.reason}`);
          break;
      }
    }
  }

  // Count actually created tickets
  let created = 0;
  for (const section of allSections) {
    const ticketDir = join(ticketsDir, section.anchor);
    if (existsSync(join(ticketDir, "README.md"))) {
      created++;
    }
  }

  console.log(`\n  Created ${created} enriched ticket(s).\n`);
}

function scaffoldSpec(specPath: string, root: string, dryRun: boolean): number {
  const sections = extractSections(specPath);
  const relPath = relative(root, specPath);
  const specName = basename(specPath, ".md");

  if (sections.length === 0) {
    console.log(`  ${specName}: no anchored sections found (use ## Title {#anchor} format)`);
    return 0;
  }

  const existingLinks = existingTicketLinks(root);
  const ticketsDir = getTicketsDir(root);
  let created = 0;

  for (const section of sections) {
    const linkRef = `${relPath}#${section.anchor}`;
    // Check if any existing ticket already links to this spec#anchor
    const alreadyLinked = [...existingLinks].some(l =>
      l.includes(section.anchor) && l.includes(specName)
    );

    if (alreadyLinked) continue;

    const ticketId = section.anchor;
    const ticketDir = join(ticketsDir, ticketId);

    if (existsSync(ticketDir)) continue;

    if (dryRun) {
      console.log(`  ${specName}: would create ${ticketId} — "${section.title}"`);
    } else {
      mkdirSync(ticketDir, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      const readme = `---
id: ${ticketId}
title: "${specName}: ${section.title}"
status: open
type: feature
priority: 2
created: ${today}
links:
  - ${relPath}#${section.anchor}
---

# ${section.title}

Implement the ${section.title} section of the ${specName} spec.

See [spec](${relPath}#${section.anchor}) for requirements.
`;
      writeFileSync(join(ticketDir, "README.md"), readme);
      console.log(`  ${specName}: created ${ticketId} — "${section.title}"`);
    }
    created++;
  }

  if (created === 0) {
    console.log(`  ${specName}: all ${sections.length} sections already have tickets`);
  }

  return created;
}

// --- audit ---

export async function runAudit(opts: { verbose?: boolean; project?: string } = {}): Promise<void> {
  const root = findProjectRoot();
  const specDir = getSpecDir(root);
  const ticketsDir = getTicketsDir(root);

  // Collect spec files
  const specFiles = existsSync(specDir)
    ? readdirSync(specDir).filter(f => f.endsWith(".md"))
    : [];

  // Collect tickets with their links
  const tickets = existsSync(ticketsDir) ? await scanTickets(join(root)) : [];
  const ticketsWithSpec = tickets.filter(t => t.links.some(l => l.includes("spec/") || l.includes("spec\\")));
  const ticketsWithoutSpec = tickets.filter(t => !t.links.some(l => l.includes("spec/") || l.includes("spec\\")));

  // Which specs have tickets linking to them?
  const specsWithTickets = new Set<string>();
  for (const t of tickets) {
    for (const link of t.links) {
      const specMatch = link.match(/(?:docs\/)?spec\/([^#.]+)/);
      if (specMatch) specsWithTickets.add(specMatch[1]);
    }
  }

  // Link validation
  const brokenLinks: Array<{ ticket: string; link: string; reason: string }> = [];
  for (const t of tickets) {
    for (const link of t.links) {
      if (link.startsWith("[[")) continue; // skip typed links
      const parts = link.split("#");
      const filePath = join(root, parts[0]);
      if (!existsSync(filePath)) {
        brokenLinks.push({ ticket: t.id, link, reason: "file not found" });
      } else if (parts[1]) {
        // Check anchor exists in file
        const content = readFileSync(filePath, "utf-8");
        const anchorPattern = new RegExp(`\\{#${parts[1]}\\}|^#+.*$`, "m");
        // Simple check: does the anchor ID appear as {#id} in the file?
        if (!content.includes(`{#${parts[1]}}`)) {
          // Also check for ## Heading with matching slug
          const headingSlug = parts[1];
          const headings = [...content.matchAll(/^##\s+(.+?)(?:\s*\{#[^}]+\})?\s*$/gm)];
          const slugMatches = headings.some(h => {
            const slug = h[1].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            return slug === headingSlug;
          });
          if (!slugMatches) {
            brokenLinks.push({ ticket: t.id, link, reason: "anchor not found" });
          }
        }
      }
    }
  }

  // Report
  console.log(`\n  TRACEABILITY AUDIT — ${basename(root)}`);
  console.log("  " + "=".repeat(56));

  console.log(`\n  SPEC COVERAGE:`);
  console.log(`    Specs:            ${specFiles.length}`);
  console.log(`    With tickets:     ${specsWithTickets.size} (${pct(specsWithTickets.size, specFiles.length)})`);
  const specsWithout = specFiles.filter(f => !specsWithTickets.has(f.replace(".md", "")));
  if (specsWithout.length > 0 && opts.verbose) {
    for (const s of specsWithout) {
      console.log(`      missing: ${s}`);
    }
  }

  console.log(`\n  TICKET HEALTH:`);
  console.log(`    Total tickets:      ${tickets.length}`);
  console.log(`    With spec links:    ${ticketsWithSpec.length} (${pct(ticketsWithSpec.length, tickets.length)})`);
  console.log(`    Without spec links: ${ticketsWithoutSpec.length} (${pct(ticketsWithoutSpec.length, tickets.length)})`);
  if (ticketsWithoutSpec.length > 0) {
    const closed = tickets.filter(t => t.status === "closed").length;
    console.log(`    Closed:             ${closed} (${pct(closed, tickets.length)})`);
  }
  if (opts.verbose && ticketsWithoutSpec.length > 0) {
    console.log(`\n    Tickets missing spec links:`);
    for (const t of ticketsWithoutSpec) {
      console.log(`      ${t.id} [${t.status}]`);
    }
  }

  console.log(`\n  LINK VALIDATION:`);
  console.log(`    Total links checked: ${tickets.reduce((n, t) => n + t.links.filter(l => !l.startsWith("[[")).length, 0)}`);
  if (brokenLinks.length === 0) {
    console.log(`    All links valid`);
  } else {
    console.log(`    Broken:             ${brokenLinks.length}`);
    for (const b of brokenLinks) {
      console.log(`      ${b.ticket} → ${b.link} (${b.reason})`);
    }
  }

  console.log("");
}

// --- trace ---

export async function runTrace(targetPath: string): Promise<void> {
  const root = findProjectRoot();
  const resolvedTarget = resolve(targetPath);
  const relTarget = relative(root, resolvedTarget);

  const tickets = await scanTickets(root);

  // Find tickets whose links or code fields reference this path
  const coveringTickets: Array<{ ticket: typeof tickets[0]; linkType: string }> = [];

  for (const t of tickets) {
    for (const link of t.links) {
      if (link.includes(relTarget) || link.includes(basename(relTarget, ".ts")) || link.includes(basename(relTarget, ".md"))) {
        coveringTickets.push({ ticket: t, linkType: "link" });
        break;
      }
    }
  }

  // Find specs that might cover this path (by scanning spec content for path references)
  const specDir = getSpecDir(root);
  const coveringSpecs: Array<{ specFile: string; section?: string }> = [];

  if (existsSync(specDir)) {
    for (const f of readdirSync(specDir).filter(f => f.endsWith(".md"))) {
      // Check if any ticket links to this spec AND covers the target path
      const specName = f.replace(".md", "");
      const linkedTickets = coveringTickets.filter(ct =>
        ct.ticket.links.some(l => l.includes(specName))
      );
      if (linkedTickets.length > 0) {
        coveringSpecs.push({ specFile: f });
      }
    }
  }

  // Find test files that might cover the target
  const coveringTests: string[] = [];
  const targetBase = basename(relTarget, ".ts");
  const testPatterns = [`${targetBase}.test.ts`, `${targetBase}.test.tsx`, `test_${targetBase}.py`];
  for (const pattern of testPatterns) {
    // Search in common test locations
    const candidates = [
      join(root, "tests", pattern),
      join(root, "tests", relative(join(root, "packages"), resolvedTarget).split("/").slice(0, 2).join("/"), pattern),
    ];
    for (const c of candidates) {
      if (existsSync(c)) coveringTests.push(relative(root, c));
    }
  }

  // Also search colocated tests
  const colocated = resolvedTarget.replace(/\.ts$/, ".test.ts");
  if (existsSync(colocated)) coveringTests.push(relative(root, colocated));

  console.log(`\n  Coverage for: ${relTarget}`);
  console.log("  " + "=".repeat(56));

  if (coveringSpecs.length > 0) {
    console.log(`\n  Specs:`);
    for (const s of coveringSpecs) {
      console.log(`    ${s.specFile}${s.section ? ` § ${s.section}` : ""}`);
    }
  }

  if (coveringTickets.length > 0) {
    console.log(`\n  Tickets:`);
    for (const ct of coveringTickets) {
      console.log(`    ${ct.ticket.id.padEnd(30)} [${ct.ticket.status}]`);
    }
  }

  if (coveringTests.length > 0) {
    console.log(`\n  Tests:`);
    for (const t of coveringTests) {
      console.log(`    ${t}`);
    }
  }

  // Query changeset data for tickets that changed this file
  let changingTickets: Array<{ ticketId: string; changeStatus: string; latest: string }> = [];
  try {
    const eventStore = new EventStore();
    changingTickets = eventStore.queryFileTickets(relTarget);
    eventStore.close();
  } catch {
    // EventStore may not be available (no better-sqlite3) — skip silently
  }

  if (changingTickets.length > 0) {
    console.log(`\n  Tickets (changed this file):`);
    for (const ct of changingTickets) {
      console.log(`    ${ct.ticketId.padEnd(30)} ${ct.changeStatus.padEnd(10)} ${ct.latest.slice(0, 10)}`);
    }
  }

  const totalCoverage = coveringSpecs.length + coveringTickets.length + coveringTests.length + changingTickets.length;
  if (totalCoverage === 0) {
    console.log(`\n  No coverage found. This file is not linked from any spec or ticket.`);
  } else {
    console.log(`\n  Total: ${coveringSpecs.length} spec(s), ${coveringTickets.length} ticket(s) linked, ${changingTickets.length} ticket(s) changed, ${coveringTests.length} test file(s)`);
  }
  console.log("");
}

// --- coverage ---

export async function runCoverage(specPath?: string): Promise<void> {
  const root = findProjectRoot();
  const specDir = getSpecDir(root);

  if (!existsSync(specDir)) {
    console.log("\n  No docs/spec/ directory found.\n");
    return;
  }

  const tickets = await scanTickets(root);

  // Build map: spec name → ticket count
  const specTicketCounts = new Map<string, number>();
  const specTicketIds = new Map<string, string[]>();
  for (const t of tickets) {
    for (const link of t.links) {
      const specMatch = link.match(/(?:docs\/)?spec\/([^#.]+)/);
      if (specMatch) {
        const name = specMatch[1];
        specTicketCounts.set(name, (specTicketCounts.get(name) ?? 0) + 1);
        if (!specTicketIds.has(name)) specTicketIds.set(name, []);
        specTicketIds.get(name)!.push(t.id);
      }
    }
  }

  // If specific spec requested, show section detail
  if (specPath) {
    const resolved = resolve(specPath);
    if (!existsSync(resolved)) {
      console.error(`  Spec file not found: ${specPath}`);
      process.exit(1);
      return;
    }
    printSpecSectionCoverage(resolved, root, tickets);
    return;
  }

  // Summary view
  const specFiles = readdirSync(specDir).filter(f => f.endsWith(".md")).sort();

  console.log(`\n  SPEC COVERAGE`);
  console.log("  " + "=".repeat(56));
  console.log(`\n  ${"Spec".padEnd(24)} ${"Sections".padEnd(10)} ${"Tickets".padEnd(10)} Status`);
  console.log(`  ${"-".repeat(24)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)}`);

  let covered = 0;
  let partial = 0;
  let uncovered = 0;

  for (const f of specFiles) {
    const name = f.replace(".md", "");
    const fullPath = join(specDir, f);
    const sections = extractSections(fullPath);
    const ticketCount = specTicketCounts.get(name) ?? 0;
    const sectionStr = sections.length > 0 ? String(sections.length) : "-";

    let status: string;
    if (ticketCount === 0) {
      status = "○ no tickets";
      uncovered++;
    } else if (sections.length > 0 && ticketCount < sections.length) {
      status = "◐ partial";
      partial++;
    } else {
      status = "● covered";
      covered++;
    }

    console.log(`  ${name.padEnd(24)} ${sectionStr.padEnd(10)} ${String(ticketCount).padEnd(10)} ${status}`);
  }

  console.log(`\n  Summary: ${specFiles.length} specs — ${covered} covered, ${partial} partial, ${uncovered} uncovered\n`);
}

function printSpecSectionCoverage(specPath: string, root: string, tickets: Array<{ id: string; links: string[]; status: string }>): void {
  const sections = extractSections(specPath);
  const specName = basename(specPath, ".md");
  const relPath = relative(root, specPath);

  console.log(`\n  ${relPath} — ${sections.length} sections`);
  console.log("  " + "=".repeat(56));

  if (sections.length === 0) {
    console.log(`\n  No anchored sections found. Use ## Title {#anchor} format.\n`);
    return;
  }

  console.log(`\n  ${"Section".padEnd(28)} ${"Ticket".padEnd(28)} Status`);
  console.log(`  ${"-".repeat(28)} ${"-".repeat(28)} ${"-".repeat(10)}`);

  for (const section of sections) {
    // Find tickets linking to this section
    const matching = tickets.filter(t =>
      t.links.some(l => l.includes(specName) && l.includes(section.anchor))
    );

    if (matching.length === 0) {
      // Check for ticket linking to spec without anchor
      const looseMatch = tickets.filter(t =>
        t.links.some(l => l.includes(specName) && !l.includes("#"))
      );
      if (looseMatch.length > 0) {
        console.log(`  § ${section.anchor.padEnd(26)} ${looseMatch[0].id.padEnd(28).slice(0, 28)} [${looseMatch[0].status}]`);
      } else {
        console.log(`  § ${section.anchor.padEnd(26)} ${"—".padEnd(28)} missing`);
      }
    } else {
      for (const t of matching) {
        console.log(`  § ${section.anchor.padEnd(26)} ${t.id.padEnd(28).slice(0, 28)} [${t.status}]`);
      }
    }
  }
  console.log("");
}

// --- uc (use case) ---

interface UseCaseFrontmatter {
  id: string;
  title: string;
  status: string;
  priority: string;
  persona?: string;
  requires?: Record<string, string[]>;
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
    // Nested list item (4 spaces or 2+ spaces under a sub-key)
    const nestedListMatch = line.match(/^\s{4,}-\s+(.+)/);
    if (nestedListMatch && nestedObj && currentSubKey) {
      if (!nestedObj[currentSubKey]) nestedObj[currentSubKey] = [];
      nestedObj[currentSubKey].push(nestedListMatch[1].trim());
      continue;
    }

    // Sub-key under a nested object (2 spaces + key:)
    const subKeyMatch = line.match(/^\s{2}(\w[\w-]*)\s*:\s*(.*)/);
    if (subKeyMatch && nestedObj) {
      currentSubKey = subKeyMatch[1];
      currentList = null;
      const val = subKeyMatch[2].trim();
      if (val && val !== "[]") {
        nestedObj[currentSubKey] = [val];
      } else {
        nestedObj[currentSubKey] = [];
      }
      continue;
    }

    // Top-level list item
    if (line.match(/^\s+-\s+/) && currentKey && !nestedObj) {
      const value = line.replace(/^\s+-\s+/, "").trim();
      if (!currentList) currentList = [];
      currentList.push(value);
      result[currentKey] = currentList;
      continue;
    }

    // Top-level key-value
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      // Save previous nested obj
      if (nestedObj && currentKey) {
        result[currentKey] = nestedObj;
      }
      currentList = null;
      nestedObj = null;
      currentSubKey = "";
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === "" || value === "[]") {
        // Could be start of a list or nested object — peek ahead
        // For now, check if next line is indented sub-key
        result[currentKey] = value === "[]" ? [] : undefined;
        // Start potential nested object
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

  // Save final nested obj
  if (nestedObj && currentKey) {
    // Only save as nested if it has actual sub-keys with values
    const hasContent = Object.values(nestedObj).some(v => v.length > 0);
    if (hasContent) {
      result[currentKey] = nestedObj;
    }
  }

  return result;
}

function parseUseCases(root: string): Array<{ file: string; fm: UseCaseFrontmatter }> {
  const ucDir = join(root, "docs", "use-cases");
  if (!existsSync(ucDir)) return [];

  const results: Array<{ file: string; fm: UseCaseFrontmatter }> = [];
  for (const f of readdirSync(ucDir).filter(f => f.endsWith(".md"))) {
    const content = readFileSync(join(ucDir, f), "utf-8");
    const fm = parseUseCaseYaml(content);
    if (fm && fm.id) {
      results.push({
        file: f,
        fm: {
          id: String(fm.id),
          title: String(fm.title ?? f.replace(".md", "")),
          status: String(fm.status ?? "unknown"),
          priority: String(fm.priority ?? "-"),
          persona: fm.persona ? String(fm.persona) : undefined,
          requires: fm.requires && typeof fm.requires === "object" && !Array.isArray(fm.requires)
            ? fm.requires as Record<string, string[]>
            : undefined,
        },
      });
    }
  }
  return results;
}

type CheckResult = Array<{ item: string; ok: boolean }>;

function checkRequirements(requires: Record<string, string[]>, root: string, tickets: Array<{ id: string; status: string }>): Record<string, CheckResult> {
  const results: Record<string, CheckResult> = {};

  for (const [category, items] of Object.entries(requires)) {
    if (!Array.isArray(items)) continue;
    results[category] = items.map(item => {
      let ok = false;
      switch (category) {
        case "specs":
          ok = existsSync(join(root, "docs", "spec", `${item}.md`));
          break;
        case "tickets":
          ok = tickets.some(t => t.id === item && t.status === "closed");
          break;
        case "features":
          // Check if feature exists by looking for related tickets or code
          ok = tickets.some(t => t.id === item && t.status === "closed");
          break;
        default:
          ok = false;
      }
      return { item, ok };
    });
  }
  return results;
}

export async function runUcLs(): Promise<void> {
  const root = findProjectRoot();
  const ucs = parseUseCases(root);

  if (ucs.length === 0) {
    console.log("\n  No use cases found in docs/use-cases/.\n");
    return;
  }

  const tickets = await scanTickets(root);

  console.log(`\n  ${"ID".padEnd(10)} ${"Title".padEnd(35)} ${"Pri".padEnd(5)} ${"Status".padEnd(10)} Done`);
  console.log(`  ${"-".repeat(10)} ${"-".repeat(35)} ${"-".repeat(5)} ${"-".repeat(10)} ${"-".repeat(8)}`);

  for (const uc of ucs) {
    const requires = uc.fm.requires;
    let doneStr = "-";
    if (requires) {
      const results = checkRequirements(requires, root, tickets);
      const total = Object.values(results).reduce((n, items) => n + items.length, 0);
      const done = Object.values(results).reduce((n, items) => n + items.filter(i => i.ok).length, 0);
      doneStr = `${done}/${total}`;
    }

    const displayTitle = uc.fm.title.length > 33 ? uc.fm.title.slice(0, 33) + ".." : uc.fm.title;
    console.log(`  ${uc.fm.id.padEnd(10)} ${displayTitle.padEnd(35)} ${uc.fm.priority.padEnd(5)} ${uc.fm.status.padEnd(10)} ${doneStr}`);
  }
  console.log("");
}

export async function runUcShow(ucId: string): Promise<void> {
  const root = findProjectRoot();
  const ucs = parseUseCases(root);
  const uc = ucs.find(u => u.fm.id === ucId || u.file.replace(".md", "") === ucId);

  if (!uc) {
    console.error(`  Use case not found: ${ucId}`);
    console.error(`  Available: ${ucs.map(u => u.fm.id).join(", ")}`);
    process.exit(1);
    return;
  }

  const tickets = await scanTickets(root);

  console.log(`\n  ${uc.fm.id}: ${uc.fm.title}`);
  console.log(`  Status: ${uc.fm.status}  Priority: ${uc.fm.priority}`);
  if (uc.fm.persona) console.log(`  Persona: ${uc.fm.persona}`);

  const requires = uc.fm.requires;
  if (!requires) {
    console.log("\n  No requirements defined.\n");
    return;
  }

  const results = checkRequirements(requires, root, tickets);
  const total = Object.values(results).reduce((n, items) => n + items.length, 0);
  const done = Object.values(results).reduce((n, items) => n + items.filter(i => i.ok).length, 0);

  console.log(`\n  Requirements: ${done}/${total} satisfied (${pct(done, total)})\n`);

  for (const [category, items] of Object.entries(results)) {
    const catDone = items.filter(i => i.ok).length;
    console.log(`    ${category}: (${catDone}/${items.length})`);
    for (const { item, ok } of items) {
      console.log(`      ${ok ? "[x]" : "[ ]"} ${item}`);
    }
    console.log("");
  }
}

export async function runUcGaps(ucId: string): Promise<void> {
  const root = findProjectRoot();
  const ucs = parseUseCases(root);
  const uc = ucs.find(u => u.fm.id === ucId || u.file.replace(".md", "") === ucId);

  if (!uc) {
    console.error(`  Use case not found: ${ucId}`);
    process.exit(1);
    return;
  }

  const tickets = await scanTickets(root);
  const requires = uc.fm.requires;
  if (!requires) {
    console.log("\n  No requirements defined.\n");
    return;
  }

  const results = checkRequirements(requires, root, tickets);
  const gaps = Object.entries(results).flatMap(([cat, items]) =>
    items.filter(i => !i.ok).map(i => ({ category: cat, item: i.item }))
  );

  if (gaps.length === 0) {
    console.log(`\n  ${uc.fm.id}: all requirements satisfied!\n`);
    return;
  }

  console.log(`\n  ${uc.fm.id}: ${gaps.length} unmet requirement(s)\n`);
  for (const gap of gaps) {
    console.log(`    [ ] ${gap.category}/${gap.item}`);
  }
  console.log("");
}

// --- helpers ---

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}
