import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("project summary", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-summary-test-"));
    originalHome = process.env.HOME!;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("readProjectSummary returns null when no summary exists", async () => {
    const { readProjectSummary, ensureOpcomDirs } = await import("@opcom/core");
    await ensureOpcomDirs();
    const result = await readProjectSummary("nonexistent");
    expect(result).toBeNull();
  });

  it("writeProjectSummary creates summary file", async () => {
    const { writeProjectSummary, readProjectSummary, ensureOpcomDirs } = await import("@opcom/core");
    await ensureOpcomDirs();

    await writeProjectSummary("test-proj", "# Test Summary\nHello world\n");
    const result = await readProjectSummary("test-proj");
    expect(result).toBe("# Test Summary\nHello world\n");
  });

  it("writeProjectSummary uses atomic write (tmp file does not remain)", async () => {
    const { writeProjectSummary, summaryPath, ensureOpcomDirs } = await import("@opcom/core");
    await ensureOpcomDirs();

    await writeProjectSummary("atomic-test", "content");
    const path = summaryPath("atomic-test");
    expect(existsSync(path)).toBe(true);
    expect(existsSync(path + ".tmp")).toBe(false);
  });

  it("updateProjectSummary creates initial summary when none exists", async () => {
    const { updateProjectSummary, readProjectSummary, ensureOpcomDirs } = await import("@opcom/core");
    await ensureOpcomDirs();

    await updateProjectSummary("new-proj", "New Project", {
      completedTicketId: "fix-login",
      completedTicketTitle: "Fix login redirect",
    });

    const summary = await readProjectSummary("new-proj");
    expect(summary).not.toBeNull();
    expect(summary).toContain("# New Project — Project Summary");
    expect(summary).toContain("## Recent Completions");
    expect(summary).toContain("fix-login: Fix login redirect");
    expect(summary).toContain("## Current State");
  });

  it("updateProjectSummary appends to existing summary", async () => {
    const { writeProjectSummary, updateProjectSummary, readProjectSummary, ensureOpcomDirs } = await import("@opcom/core");
    await ensureOpcomDirs();

    // Write initial summary
    const initial = [
      "# MyApp — Project Summary",
      "",
      "## Current State",
      "- Last activity: 2026-03-01T00:00:00Z",
      "",
      "## Recent Completions",
      "- old-ticket: Old work (2026-03-01T00:00:00Z)",
      "",
      "## Key Decisions",
      "(none yet)",
      "",
    ].join("\n");
    await writeProjectSummary("myapp", initial);

    await updateProjectSummary("myapp", "MyApp", {
      completedTicketId: "new-feature",
      completedTicketTitle: "Add new feature",
      detail: "implemented OAuth flow",
    });

    const result = await readProjectSummary("myapp");
    expect(result).not.toBeNull();
    // New completion should be at the top
    expect(result!.indexOf("new-feature")).toBeLessThan(result!.indexOf("old-ticket"));
    // Should include detail
    expect(result).toContain("implemented OAuth flow");
    // Last activity should be updated (the old date may still appear in the old completion entry text)
    const lastActivityMatch = result!.match(/- Last activity: (.+)/);
    expect(lastActivityMatch).not.toBeNull();
    expect(lastActivityMatch![1]).not.toBe("2026-03-01T00:00:00Z");
  });

  it("updateProjectSummary replaces (none yet) placeholder", async () => {
    const { writeProjectSummary, updateProjectSummary, readProjectSummary, ensureOpcomDirs } = await import("@opcom/core");
    await ensureOpcomDirs();

    const initial = [
      "# MyApp — Project Summary",
      "",
      "## Current State",
      "- Last activity: 2026-03-01T00:00:00Z",
      "",
      "## Recent Completions",
      "(none yet)",
      "",
      "## Key Decisions",
      "(none yet)",
      "",
    ].join("\n");
    await writeProjectSummary("myapp2", initial);

    await updateProjectSummary("myapp2", "MyApp", {
      completedTicketId: "first-task",
      completedTicketTitle: "First task",
    });

    const result = await readProjectSummary("myapp2");
    expect(result).toContain("first-task: First task");
    // The "(none yet)" under Recent Completions should be gone
    const recentIdx = result!.indexOf("## Recent Completions");
    const keyDecIdx = result!.indexOf("## Key Decisions");
    const recentSection = result!.slice(recentIdx, keyDecIdx);
    expect(recentSection).not.toContain("(none yet)");
    // But Key Decisions should still have (none yet)
    expect(result!.slice(keyDecIdx)).toContain("(none yet)");
  });

  it("createInitialSummaryFromDescription includes description", async () => {
    const { createInitialSummaryFromDescription } = await import("@opcom/core");
    const summary = createInitialSummaryFromDescription("Folia", "Multi-service app with FastAPI");
    expect(summary).toContain("# Folia — Project Summary");
    expect(summary).toContain("## About");
    expect(summary).toContain("Multi-service app with FastAPI");
    expect(summary).toContain("## Recent Completions");
    expect(summary).toContain("## Key Decisions");
    expect(summary).toContain("## Open Questions");
  });

  it("createInitialSummaryFromDescription works without description", async () => {
    const { createInitialSummaryFromDescription } = await import("@opcom/core");
    const summary = createInitialSummaryFromDescription("Folia");
    expect(summary).toContain("# Folia — Project Summary");
    expect(summary).not.toContain("## About");
  });

  it("updateProjectSummary trims to 20 completions", async () => {
    const { writeProjectSummary, updateProjectSummary, readProjectSummary, ensureOpcomDirs } = await import("@opcom/core");
    await ensureOpcomDirs();

    // Write initial summary with 20 completions
    const completions = Array.from({ length: 20 }, (_, i) =>
      `- ticket-${i}: Task ${i} (2026-03-01T00:00:00Z)`,
    ).join("\n");

    const initial = [
      "# MyApp — Project Summary",
      "",
      "## Current State",
      "- Last activity: 2026-03-01T00:00:00Z",
      "",
      "## Recent Completions",
      completions,
      "",
      "## Key Decisions",
      "(none yet)",
      "",
    ].join("\n");
    await writeProjectSummary("trim-test", initial);

    // Add one more — should push oldest out
    await updateProjectSummary("trim-test", "MyApp", {
      completedTicketId: "ticket-new",
      completedTicketTitle: "New task",
    });

    const result = await readProjectSummary("trim-test");
    expect(result).toContain("ticket-new");
    // Should have at most 20 completion lines
    const recentIdx = result!.indexOf("## Recent Completions");
    const keyDecIdx = result!.indexOf("## Key Decisions");
    const recentSection = result!.slice(recentIdx, keyDecIdx);
    const completionLines = recentSection.split("\n").filter((l) => l.startsWith("- "));
    expect(completionLines.length).toBeLessThanOrEqual(20);
    // Oldest (ticket-19, last in the list) should be trimmed
    // Use exact line match to avoid substring issues (ticket-19 contains ticket-1)
    expect(completionLines[0]).toContain("ticket-new");
    expect(completionLines[completionLines.length - 1]).toContain("ticket-18");
    expect(recentSection).not.toContain("Task 19");
  });
});
