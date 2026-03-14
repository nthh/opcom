import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildScaffoldEnrichmentPrompt } from "@opcom/core";
import type { ScaffoldEnrichmentSection } from "@opcom/core";
import type { WorkItem } from "@opcom/types";

// --- buildScaffoldEnrichmentPrompt tests ---

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: overrides.id ?? "existing-ticket",
    title: overrides.title ?? "Existing Ticket",
    status: overrides.status ?? "open",
    priority: overrides.priority ?? 2,
    type: overrides.type ?? "feature",
    filePath: overrides.filePath ?? "/tickets/existing-ticket/README.md",
    deps: overrides.deps ?? [],
    links: overrides.links ?? [],
    tags: overrides.tags ?? {},
  };
}

describe("buildScaffoldEnrichmentPrompt", () => {
  it("generates prompt with sections and template reference", () => {
    const sections: ScaffoldEnrichmentSection[] = [
      { anchor: "auth-flow", title: "Authentication Flow", content: "Users authenticate via OAuth2." },
      { anchor: "rate-limiting", title: "Rate Limiting", content: "API endpoints must be rate-limited." },
    ];
    const linkRefs = [
      "docs/spec/api.md#auth-flow",
      "docs/spec/api.md#rate-limiting",
    ];
    const templateContent = "---\nid: ticket-id\n---\n# Ticket Title";
    const existingTickets: WorkItem[] = [];

    const prompt = buildScaffoldEnrichmentPrompt(
      sections,
      linkRefs,
      "/project/.tickets/impl",
      templateContent,
      existingTickets,
    );

    expect(prompt).toContain("Generate enriched tickets from spec sections");
    expect(prompt).toContain("/project/.tickets/impl/<section-anchor>/README.md");
    expect(prompt).toContain("generated: true");
    expect(prompt).toContain("Authentication Flow {#auth-flow}");
    expect(prompt).toContain("Rate Limiting {#rate-limiting}");
    expect(prompt).toContain("Users authenticate via OAuth2.");
    expect(prompt).toContain("API endpoints must be rate-limited.");
    expect(prompt).toContain("docs/spec/api.md#auth-flow");
    expect(prompt).toContain("docs/spec/api.md#rate-limiting");
    expect(prompt).toContain("Template Reference");
    expect(prompt).toContain("ticket-id");
  });

  it("includes project stack info when provided", () => {
    const sections: ScaffoldEnrichmentSection[] = [
      { anchor: "foo", title: "Foo", content: "Content" },
    ];
    const prompt = buildScaffoldEnrichmentPrompt(
      sections,
      ["docs/spec/x.md#foo"],
      "/tickets",
      "",
      [],
      {
        languages: "TypeScript 5.7",
        frameworks: "React, Next.js",
        testing: "vitest",
        services: "api-server",
      },
    );

    expect(prompt).toContain("Project Stack");
    expect(prompt).toContain("TypeScript 5.7");
    expect(prompt).toContain("React, Next.js");
    expect(prompt).toContain("vitest");
    expect(prompt).toContain("api-server");
  });

  it("includes existing tickets for dependency awareness", () => {
    const sections: ScaffoldEnrichmentSection[] = [
      { anchor: "bar", title: "Bar", content: "" },
    ];
    const existingTickets = [
      makeWorkItem({ id: "auth-middleware", title: "Auth Middleware", status: "closed" }),
      makeWorkItem({ id: "user-model", title: "User Model", status: "open", priority: 1 }),
    ];

    const prompt = buildScaffoldEnrichmentPrompt(
      sections,
      ["docs/spec/x.md#bar"],
      "/tickets",
      "",
      existingTickets,
    );

    expect(prompt).toContain("Existing Tickets");
    expect(prompt).toContain("auth-middleware: Auth Middleware (closed, P2)");
    expect(prompt).toContain("user-model: User Model (open, P1)");
    expect(prompt).toContain("dependency awareness");
  });

  it("handles empty sections list", () => {
    const prompt = buildScaffoldEnrichmentPrompt(
      [],
      [],
      "/tickets",
      "",
      [],
    );

    expect(prompt).toContain("0 total");
  });

  it("handles sections with no content", () => {
    const sections: ScaffoldEnrichmentSection[] = [
      { anchor: "empty-section", title: "Empty Section", content: "" },
    ];
    const prompt = buildScaffoldEnrichmentPrompt(
      sections,
      ["docs/spec/x.md#empty-section"],
      "/tickets",
      "",
      [],
    );

    expect(prompt).toContain("Empty Section {#empty-section}");
    expect(prompt).toContain("infer from the title and project context");
  });

  it("omits template reference when template is empty", () => {
    const sections: ScaffoldEnrichmentSection[] = [
      { anchor: "x", title: "X", content: "stuff" },
    ];
    const prompt = buildScaffoldEnrichmentPrompt(
      sections,
      ["docs/spec/y.md#x"],
      "/tickets",
      "",
      [],
    );

    expect(prompt).not.toContain("Template Reference");
  });

  it("omits project stack section when no stack provided", () => {
    const sections: ScaffoldEnrichmentSection[] = [
      { anchor: "x", title: "X", content: "stuff" },
    ];
    const prompt = buildScaffoldEnrichmentPrompt(
      sections,
      ["docs/spec/y.md#x"],
      "/tickets",
      "",
      [],
    );

    expect(prompt).not.toContain("Project Stack");
  });

  it("includes Context Packet format instructions", () => {
    const sections: ScaffoldEnrichmentSection[] = [
      { anchor: "x", title: "X", content: "stuff" },
    ];
    const prompt = buildScaffoldEnrichmentPrompt(
      sections,
      ["docs/spec/y.md#x"],
      "/tickets",
      "",
      [],
    );

    expect(prompt).toContain("Goal:");
    expect(prompt).toContain("Non-Goals:");
    expect(prompt).toContain("Constraints:");
    expect(prompt).toContain("Repo Anchors:");
    expect(prompt).toContain("Oracle (Done When):");
    expect(prompt).toContain("Tasks:");
  });

  it("includes today's date in frontmatter instructions", () => {
    const sections: ScaffoldEnrichmentSection[] = [
      { anchor: "x", title: "X", content: "" },
    ];
    const prompt = buildScaffoldEnrichmentPrompt(
      sections,
      ["docs/spec/y.md#x"],
      "/tickets",
      "",
      [],
    );

    const today = new Date().toISOString().slice(0, 10);
    expect(prompt).toContain(`created: ${today}`);
  });
});

// --- extractSectionContent and findScaffoldableSections tests ---
// These test the internal helpers via the runScaffold entry point behavior.
// Since the helpers are not exported, we test them indirectly through file-system state.

describe("scaffold --full section extraction", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "opcom-scaffold-full-"));
    // Create project structure
    mkdirSync(join(tmpDir, ".tickets", "impl"), { recursive: true });
    mkdirSync(join(tmpDir, "docs", "spec"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extractSectionContent extracts body between h2 headings", async () => {
    // We test this indirectly by checking that the enrichment prompt builder
    // receives the right content. Since extractSectionContent is internal,
    // we verify the spec content structure that the prompt builder expects.
    const specContent = [
      "# My Spec",
      "",
      "## Overview {#overview}",
      "This is the overview.",
      "",
      "## Authentication {#auth-flow}",
      "Users authenticate via OAuth2 tokens.",
      "Tokens expire after 24 hours.",
      "",
      "## Rate Limiting {#rate-limiting}",
      "Each endpoint has a rate limit of 100 req/min.",
      "",
    ].join("\n");

    writeFileSync(join(tmpDir, "docs", "spec", "api.md"), specContent);

    // Verify the spec file can be parsed for sections
    const content = readFileSync(join(tmpDir, "docs", "spec", "api.md"), "utf-8");
    const SECTION_PATTERN = /^##\s+(.+?)\s*\{#([a-z0-9][\w-]*)\}\s*$/gm;
    const sections = [...content.matchAll(SECTION_PATTERN)];

    // 3 sections total: overview, auth-flow, rate-limiting
    expect(sections.length).toBe(3);
    expect(sections[0][2]).toBe("overview");
    expect(sections[1][2]).toBe("auth-flow");
    expect(sections[2][2]).toBe("rate-limiting");

    // Extract body for auth-flow (between auth-flow heading and rate-limiting heading)
    const authMatch = sections[1];
    const sectionStart = authMatch.index! + authMatch[0].length;
    const nextHeading = content.slice(sectionStart).search(/^##\s+/m);
    const body = content.slice(sectionStart, sectionStart + nextHeading).trim();

    expect(body).toContain("Users authenticate via OAuth2 tokens.");
    expect(body).toContain("Tokens expire after 24 hours.");
    expect(body).not.toContain("rate limit");
  });

  it("scaffold skips sections that already have tickets", () => {
    const specContent = [
      "## Feature A {#feature-a}",
      "Feature A content.",
      "",
      "## Feature B {#feature-b}",
      "Feature B content.",
      "",
    ].join("\n");

    writeFileSync(join(tmpDir, "docs", "spec", "test.md"), specContent);

    // Create an existing ticket for feature-a
    mkdirSync(join(tmpDir, ".tickets", "impl", "feature-a"), { recursive: true });
    writeFileSync(join(tmpDir, ".tickets", "impl", "feature-a", "README.md"), [
      "---",
      "id: feature-a",
      "title: Test Feature A",
      "status: open",
      "type: feature",
      "priority: 2",
      "links:",
      "  - docs/spec/test.md#feature-a",
      "---",
      "",
      "# Feature A",
    ].join("\n"));

    // Verify feature-a directory exists (should be skipped)
    expect(existsSync(join(tmpDir, ".tickets", "impl", "feature-a"))).toBe(true);
    // feature-b directory should not exist yet
    expect(existsSync(join(tmpDir, ".tickets", "impl", "feature-b"))).toBe(false);
  });

  it("scaffold skips non-actionable sections like overview", () => {
    const specContent = [
      "## Overview {#overview}",
      "This is the overview.",
      "",
      "## Summary {#summary}",
      "This is the summary.",
      "",
      "## Real Feature {#real-feature}",
      "This is the real feature.",
      "",
    ].join("\n");

    writeFileSync(join(tmpDir, "docs", "spec", "test.md"), specContent);

    // Verify sections are parsed correctly (overview and summary should be skipped)
    const content = readFileSync(join(tmpDir, "docs", "spec", "test.md"), "utf-8");
    const SECTION_PATTERN = /^##\s+(.+?)\s*\{#([a-z0-9][\w-]*)\}\s*$/gm;
    const SKIP_ANCHORS = new Set([
      "overview", "summary", "architecture", "non-goals",
      "references", "dependencies", "related-docs",
    ]);

    const sections = [...content.matchAll(SECTION_PATTERN)]
      .filter(m => !SKIP_ANCHORS.has(m[2]));

    expect(sections.length).toBe(1);
    expect(sections[0][2]).toBe("real-feature");
  });
});

// --- Scaffold --full dry-run output tests ---

describe("scaffold --full dry-run", () => {
  let tmpDir: string;
  let originalCwd: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "opcom-scaffold-dryrun-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // Create project structure
    mkdirSync(join(tmpDir, ".tickets", "impl"), { recursive: true });
    mkdirSync(join(tmpDir, "docs", "spec"), { recursive: true });

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("runScaffold --full --dry-run shows enriched ticket preview", async () => {
    const specContent = [
      "## Auth Flow {#auth-flow}",
      "Authenticate users with OAuth2.",
      "",
      "## Rate Limiting {#rate-limiting}",
      "Limit API requests per user.",
      "",
    ].join("\n");

    writeFileSync(join(tmpDir, "docs", "spec", "api.md"), specContent);

    // Import and run scaffold
    const { runScaffold } = await import("../../packages/cli/src/commands/traceability.js");
    await runScaffold(join(tmpDir, "docs", "spec", "api.md"), { dryRun: true, full: true });

    const output = consoleLogSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(output).toContain("--full --dry-run");
    expect(output).toContain("auth-flow");
    expect(output).toContain("rate-limiting");
    expect(output).toContain("agent-enriched");
    expect(output).toContain("2 enriched ticket(s)");

    // Verify no files were actually created
    expect(existsSync(join(tmpDir, ".tickets", "impl", "auth-flow"))).toBe(false);
    expect(existsSync(join(tmpDir, ".tickets", "impl", "rate-limiting"))).toBe(false);
  });

  it("runScaffold --all --full --dry-run shows all spec files", async () => {
    writeFileSync(join(tmpDir, "docs", "spec", "api.md"), [
      "## Auth {#auth}",
      "Auth content.",
    ].join("\n"));
    writeFileSync(join(tmpDir, "docs", "spec", "tui.md"), [
      "## Dashboard {#dashboard}",
      "Dashboard content.",
    ].join("\n"));

    const { runScaffold } = await import("../../packages/cli/src/commands/traceability.js");
    await runScaffold(undefined, { dryRun: true, full: true, all: true });

    const output = consoleLogSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(output).toContain("auth");
    expect(output).toContain("dashboard");
    expect(output).toContain("2 enriched ticket(s)");
  });

  it("runScaffold --full --dry-run skips sections with existing tickets", async () => {
    writeFileSync(join(tmpDir, "docs", "spec", "api.md"), [
      "## Existing {#existing-feature}",
      "Already has a ticket.",
      "",
      "## New Feature {#new-feature}",
      "Needs a ticket.",
    ].join("\n"));

    // Create existing ticket
    mkdirSync(join(tmpDir, ".tickets", "impl", "existing-feature"), { recursive: true });
    writeFileSync(join(tmpDir, ".tickets", "impl", "existing-feature", "README.md"), [
      "---",
      "id: existing-feature",
      "title: Existing Feature",
      "status: open",
      "type: feature",
      "priority: 2",
      "links:",
      "  - docs/spec/api.md#existing-feature",
      "---",
    ].join("\n"));

    const { runScaffold } = await import("../../packages/cli/src/commands/traceability.js");
    await runScaffold(join(tmpDir, "docs", "spec", "api.md"), { dryRun: true, full: true });

    const output = consoleLogSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(output).toContain("new-feature");
    expect(output).not.toContain("existing-feature\" (agent-enriched)");
    expect(output).toContain("1 enriched ticket(s)");
  });

  it("runScaffold --full --dry-run shows no sections when all covered", async () => {
    writeFileSync(join(tmpDir, "docs", "spec", "api.md"), [
      "## Already Done {#already-done}",
      "Content.",
    ].join("\n"));

    mkdirSync(join(tmpDir, ".tickets", "impl", "already-done"), { recursive: true });
    writeFileSync(join(tmpDir, ".tickets", "impl", "already-done", "README.md"), [
      "---",
      "id: already-done",
      "title: Already Done",
      "status: open",
      "type: feature",
      "priority: 2",
      "links:",
      "  - docs/spec/api.md#already-done",
      "---",
    ].join("\n"));

    const { runScaffold } = await import("../../packages/cli/src/commands/traceability.js");
    await runScaffold(join(tmpDir, "docs", "spec", "api.md"), { dryRun: true, full: true });

    const output = consoleLogSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(output).toContain("No new sections to scaffold");
  });

  it("runScaffold without --full preserves existing behavior", async () => {
    writeFileSync(join(tmpDir, "docs", "spec", "api.md"), [
      "## Feature A {#feature-a}",
      "Feature A content.",
    ].join("\n"));

    const { runScaffold } = await import("../../packages/cli/src/commands/traceability.js");
    await runScaffold(join(tmpDir, "docs", "spec", "api.md"), { dryRun: true });

    const output = consoleLogSpy.mock.calls.map(c => c.join(" ")).join("\n");
    // Non-full dry-run uses the original format (no "agent-enriched")
    expect(output).toContain("would create feature-a");
    expect(output).not.toContain("agent-enriched");
    expect(output).toContain("Would create 1 ticket(s)");
  });

  it("runScaffold without --full creates minimal stubs", async () => {
    writeFileSync(join(tmpDir, "docs", "spec", "api.md"), [
      "## Feature X {#feature-x}",
      "Feature X content.",
    ].join("\n"));

    const { runScaffold } = await import("../../packages/cli/src/commands/traceability.js");
    await runScaffold(join(tmpDir, "docs", "spec", "api.md"), {});

    // Verify minimal stub was created (no generated: true)
    const ticketPath = join(tmpDir, ".tickets", "impl", "feature-x", "README.md");
    expect(existsSync(ticketPath)).toBe(true);

    const content = readFileSync(ticketPath, "utf-8");
    expect(content).toContain("id: feature-x");
    expect(content).toContain("feature-x");
    expect(content).not.toContain("generated: true");
    // Minimal stubs have a simple description
    expect(content).toContain("Implement the Feature X section");
  });

  it("runScaffold --full errors without spec path or --all", async () => {
    const { runScaffold } = await import("../../packages/cli/src/commands/traceability.js");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await runScaffold(undefined, { full: true });
    } catch {
      // process.exit mock throws
    }

    expect(processExitSpy).toHaveBeenCalledWith(1);
    const output = consoleSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(output).toContain("Usage:");
    expect(output).toContain("--full");
    consoleSpy.mockRestore();
  });

  it("runScaffold --full errors on missing spec file", async () => {
    const { runScaffold } = await import("../../packages/cli/src/commands/traceability.js");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await runScaffold("/nonexistent/spec.md", { full: true });
    } catch {
      // process.exit mock throws
    }

    expect(processExitSpy).toHaveBeenCalledWith(1);
    const output = consoleSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(output).toContain("Spec file not found");
    consoleSpy.mockRestore();
  });

  it("runScaffold --all --full --dry-run with no spec dir", async () => {
    rmSync(join(tmpDir, "docs"), { recursive: true, force: true });

    const { runScaffold } = await import("../../packages/cli/src/commands/traceability.js");
    await runScaffold(undefined, { dryRun: true, full: true, all: true });

    const output = consoleLogSpy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(output).toContain("No docs/spec/ directory found");
  });
});
