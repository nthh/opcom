"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
(0, vitest_1.describe)("project summary", () => {
    let tempDir;
    let originalHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-summary-test-"));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = originalHome;
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("readProjectSummary returns null when no summary exists", async () => {
        const { readProjectSummary, ensureOpcomDirs } = await import("@opcom/core");
        await ensureOpcomDirs();
        const result = await readProjectSummary("nonexistent");
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("writeProjectSummary creates summary file", async () => {
        const { writeProjectSummary, readProjectSummary, ensureOpcomDirs } = await import("@opcom/core");
        await ensureOpcomDirs();
        await writeProjectSummary("test-proj", "# Test Summary\nHello world\n");
        const result = await readProjectSummary("test-proj");
        (0, vitest_1.expect)(result).toBe("# Test Summary\nHello world\n");
    });
    (0, vitest_1.it)("writeProjectSummary uses atomic write (tmp file does not remain)", async () => {
        const { writeProjectSummary, summaryPath, ensureOpcomDirs } = await import("@opcom/core");
        await ensureOpcomDirs();
        await writeProjectSummary("atomic-test", "content");
        const path = summaryPath("atomic-test");
        (0, vitest_1.expect)((0, node_fs_1.existsSync)(path)).toBe(true);
        (0, vitest_1.expect)((0, node_fs_1.existsSync)(path + ".tmp")).toBe(false);
    });
    (0, vitest_1.it)("updateProjectSummary creates initial summary when none exists", async () => {
        const { updateProjectSummary, readProjectSummary, ensureOpcomDirs } = await import("@opcom/core");
        await ensureOpcomDirs();
        await updateProjectSummary("new-proj", "New Project", {
            completedTicketId: "fix-login",
            completedTicketTitle: "Fix login redirect",
        });
        const summary = await readProjectSummary("new-proj");
        (0, vitest_1.expect)(summary).not.toBeNull();
        (0, vitest_1.expect)(summary).toContain("# New Project — Project Summary");
        (0, vitest_1.expect)(summary).toContain("## Recent Completions");
        (0, vitest_1.expect)(summary).toContain("fix-login: Fix login redirect");
        (0, vitest_1.expect)(summary).toContain("## Current State");
    });
    (0, vitest_1.it)("updateProjectSummary appends to existing summary", async () => {
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
        (0, vitest_1.expect)(result).not.toBeNull();
        // New completion should be at the top
        (0, vitest_1.expect)(result.indexOf("new-feature")).toBeLessThan(result.indexOf("old-ticket"));
        // Should include detail
        (0, vitest_1.expect)(result).toContain("implemented OAuth flow");
        // Last activity should be updated (the old date may still appear in the old completion entry text)
        const lastActivityMatch = result.match(/- Last activity: (.+)/);
        (0, vitest_1.expect)(lastActivityMatch).not.toBeNull();
        (0, vitest_1.expect)(lastActivityMatch[1]).not.toBe("2026-03-01T00:00:00Z");
    });
    (0, vitest_1.it)("updateProjectSummary replaces (none yet) placeholder", async () => {
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
        (0, vitest_1.expect)(result).toContain("first-task: First task");
        // The "(none yet)" under Recent Completions should be gone
        const recentIdx = result.indexOf("## Recent Completions");
        const keyDecIdx = result.indexOf("## Key Decisions");
        const recentSection = result.slice(recentIdx, keyDecIdx);
        (0, vitest_1.expect)(recentSection).not.toContain("(none yet)");
        // But Key Decisions should still have (none yet)
        (0, vitest_1.expect)(result.slice(keyDecIdx)).toContain("(none yet)");
    });
    (0, vitest_1.it)("createInitialSummaryFromDescription includes description", async () => {
        const { createInitialSummaryFromDescription } = await import("@opcom/core");
        const summary = createInitialSummaryFromDescription("Folia", "Multi-service app with FastAPI");
        (0, vitest_1.expect)(summary).toContain("# Folia — Project Summary");
        (0, vitest_1.expect)(summary).toContain("## About");
        (0, vitest_1.expect)(summary).toContain("Multi-service app with FastAPI");
        (0, vitest_1.expect)(summary).toContain("## Recent Completions");
        (0, vitest_1.expect)(summary).toContain("## Key Decisions");
        (0, vitest_1.expect)(summary).toContain("## Open Questions");
    });
    (0, vitest_1.it)("createInitialSummaryFromDescription works without description", async () => {
        const { createInitialSummaryFromDescription } = await import("@opcom/core");
        const summary = createInitialSummaryFromDescription("Folia");
        (0, vitest_1.expect)(summary).toContain("# Folia — Project Summary");
        (0, vitest_1.expect)(summary).not.toContain("## About");
    });
    (0, vitest_1.it)("full lifecycle: init creates summary, update appends, result is human-readable markdown", async () => {
        const { writeProjectSummary, updateProjectSummary, readProjectSummary, createInitialSummaryFromDescription, ensureOpcomDirs } = await import("@opcom/core");
        await ensureOpcomDirs();
        // 1. opcom init creates initial summary from description
        const initial = createInitialSummaryFromDescription("MyApp", "A REST API for managing tasks");
        await writeProjectSummary("lifecycle", initial);
        const afterInit = await readProjectSummary("lifecycle");
        (0, vitest_1.expect)(afterInit).not.toBeNull();
        (0, vitest_1.expect)(afterInit).toContain("# MyApp — Project Summary");
        (0, vitest_1.expect)(afterInit).toContain("## About");
        (0, vitest_1.expect)(afterInit).toContain("A REST API for managing tasks");
        (0, vitest_1.expect)(afterInit).toContain("## Recent Completions");
        (0, vitest_1.expect)(afterInit).toContain("(none yet)");
        // 2. Step completion updates the summary
        await updateProjectSummary("lifecycle", "MyApp", {
            completedTicketId: "add-auth",
            completedTicketTitle: "Add authentication",
            detail: "JWT-based auth with refresh tokens",
        });
        const afterUpdate = await readProjectSummary("lifecycle");
        (0, vitest_1.expect)(afterUpdate).toContain("add-auth: Add authentication");
        (0, vitest_1.expect)(afterUpdate).toContain("JWT-based auth with refresh tokens");
        // "(none yet)" should be replaced
        const recentIdx = afterUpdate.indexOf("## Recent Completions");
        const keyDecIdx = afterUpdate.indexOf("## Key Decisions");
        const recentSection = afterUpdate.slice(recentIdx, keyDecIdx);
        (0, vitest_1.expect)(recentSection).not.toContain("(none yet)");
        // 3. Human-readable: valid markdown with expected sections
        (0, vitest_1.expect)(afterUpdate).toContain("## Current State");
        (0, vitest_1.expect)(afterUpdate).toContain("## Recent Completions");
        (0, vitest_1.expect)(afterUpdate).toContain("## Key Decisions");
        (0, vitest_1.expect)(afterUpdate).toContain("## Open Questions");
        // Sections use standard markdown headers
        const headers = afterUpdate.match(/^## .+$/gm);
        (0, vitest_1.expect)(headers.length).toBeGreaterThanOrEqual(4);
    });
    (0, vitest_1.it)("updateProjectSummary trims to 20 completions", async () => {
        const { writeProjectSummary, updateProjectSummary, readProjectSummary, ensureOpcomDirs } = await import("@opcom/core");
        await ensureOpcomDirs();
        // Write initial summary with 20 completions
        const completions = Array.from({ length: 20 }, (_, i) => `- ticket-${i}: Task ${i} (2026-03-01T00:00:00Z)`).join("\n");
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
        (0, vitest_1.expect)(result).toContain("ticket-new");
        // Should have at most 20 completion lines
        const recentIdx = result.indexOf("## Recent Completions");
        const keyDecIdx = result.indexOf("## Key Decisions");
        const recentSection = result.slice(recentIdx, keyDecIdx);
        const completionLines = recentSection.split("\n").filter((l) => l.startsWith("- "));
        (0, vitest_1.expect)(completionLines.length).toBeLessThanOrEqual(20);
        // Oldest (ticket-19, last in the list) should be trimmed
        // Use exact line match to avoid substring issues (ticket-19 contains ticket-1)
        (0, vitest_1.expect)(completionLines[0]).toContain("ticket-new");
        (0, vitest_1.expect)(completionLines[completionLines.length - 1]).toContain("ticket-18");
        (0, vitest_1.expect)(recentSection).not.toContain("Task 19");
    });
});
//# sourceMappingURL=summary.test.js.map