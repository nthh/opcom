"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
function makeProject(overrides) {
    return {
        id: "test-project",
        name: "test-project",
        path: "/tmp/test-project",
        stack: {
            languages: [{ name: "typescript", version: "5.7", sourceFile: "package.json" }],
            frameworks: [{ name: "express", sourceFile: "package.json" }],
            packageManagers: [{ name: "npm", sourceFile: "package-lock.json" }],
            infrastructure: [{ name: "docker", sourceFile: "Dockerfile" }],
            versionManagers: [],
        },
        git: { branch: "main", clean: true, remote: "origin" },
        workSystem: { type: "tickets-dir", ticketDir: ".tickets" },
        docs: {},
        services: [
            { name: "api", command: "npm start", port: 3000 },
            { name: "postgres", command: "docker compose up postgres", port: 5432 },
        ],
        environments: [],
        testing: { framework: "vitest", command: "npm test" },
        linting: [{ name: "eslint", sourceFile: "eslint.config.js" }],
        subProjects: [],
        cloudServices: [],
        lastScannedAt: "2026-02-27T00:00:00Z",
        ...overrides,
    };
}
function makeWorkItem(overrides) {
    return {
        id: "test-ticket",
        title: "Test Ticket",
        status: "open",
        priority: 1,
        type: "feature",
        filePath: "/tmp/test-project/.tickets/test-ticket/README.md",
        deps: [],
        links: [],
        tags: {},
        ...overrides,
    };
}
(0, vitest_1.describe)("buildContextPacket", () => {
    (0, vitest_1.it)("builds packet from project without work item", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        (0, vitest_1.expect)(packet.project.name).toBe("test-project");
        (0, vitest_1.expect)(packet.project.path).toBe("/tmp/test-project");
        (0, vitest_1.expect)(packet.project.stack.languages).toHaveLength(1);
        (0, vitest_1.expect)(packet.project.stack.languages[0].name).toBe("typescript");
        (0, vitest_1.expect)(packet.project.testing?.framework).toBe("vitest");
        (0, vitest_1.expect)(packet.project.linting).toHaveLength(1);
        (0, vitest_1.expect)(packet.project.services).toHaveLength(2);
        (0, vitest_1.expect)(packet.git.branch).toBe("main");
        (0, vitest_1.expect)(packet.git.clean).toBe(true);
        (0, vitest_1.expect)(packet.workItem).toBeUndefined();
    });
    (0, vitest_1.it)("builds packet with work item", async () => {
        const project = makeProject();
        const workItem = makeWorkItem();
        const packet = await (0, core_1.buildContextPacket)(project, workItem);
        (0, vitest_1.expect)(packet.workItem).toBeDefined();
        (0, vitest_1.expect)(packet.workItem.ticket.id).toBe("test-ticket");
        (0, vitest_1.expect)(packet.workItem.ticket.title).toBe("Test Ticket");
    });
    (0, vitest_1.it)("handles missing git gracefully", async () => {
        const project = makeProject({ git: null });
        const packet = await (0, core_1.buildContextPacket)(project);
        (0, vitest_1.expect)(packet.git.branch).toBe("main");
        (0, vitest_1.expect)(packet.git.clean).toBe(true);
    });
    (0, vitest_1.it)("loads summary into packet when summary file exists", async () => {
        const { mkdtemp, rm } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const { tmpdir } = await import("node:os");
        const { writeProjectSummary, ensureOpcomDirs } = await import("@opcom/core");
        const tempDir = await mkdtemp(join(tmpdir(), "opcom-ctx-summary-"));
        const originalHome = process.env.HOME;
        process.env.HOME = tempDir;
        try {
            await ensureOpcomDirs();
            const summaryContent = "# test-project — Project Summary\n\n## Current State\n- Last activity: 2026-03-09\n";
            await writeProjectSummary("test-project", summaryContent);
            const project = makeProject();
            const packet = await (0, core_1.buildContextPacket)(project);
            (0, vitest_1.expect)(packet.summary).toBe(summaryContent);
        }
        finally {
            process.env.HOME = originalHome;
            await rm(tempDir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("handles empty stack gracefully", async () => {
        const project = makeProject({
            stack: {
                languages: [],
                frameworks: [],
                packageManagers: [],
                infrastructure: [],
                versionManagers: [],
            },
        });
        const packet = await (0, core_1.buildContextPacket)(project);
        (0, vitest_1.expect)(packet.project.stack.languages).toHaveLength(0);
    });
});
(0, vitest_1.describe)("contextPacketToMarkdown", () => {
    (0, vitest_1.it)("generates markdown from packet", async () => {
        const project = makeProject();
        const workItem = makeWorkItem({ title: "Add caching layer" });
        const packet = await (0, core_1.buildContextPacket)(project, workItem);
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).toContain("# Project: test-project");
        (0, vitest_1.expect)(md).toContain("typescript 5.7");
        (0, vitest_1.expect)(md).toContain("express");
        (0, vitest_1.expect)(md).toContain("vitest");
        (0, vitest_1.expect)(md).toContain("`npm test`");
        (0, vitest_1.expect)(md).toContain("eslint");
        (0, vitest_1.expect)(md).toContain("api:3000");
        (0, vitest_1.expect)(md).toContain("## Task: Add caching layer");
        (0, vitest_1.expect)(md).toContain("test-ticket");
    });
    (0, vitest_1.it)("generates markdown without work item", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).toContain("# Project: test-project");
        (0, vitest_1.expect)(md).not.toContain("## Task");
    });
    (0, vitest_1.it)("injects role instructions when roleConfig provided", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const roleConfig = {
            roleId: "reviewer",
            name: "Reviewer",
            permissionMode: "default",
            allowedTools: [],
            disallowedTools: ["Edit", "Write"],
            allowedBashPatterns: [],
            instructions: "- Review code for correctness.\n- Do NOT modify any files.",
            doneCriteria: "Review report written to stdout.",
            runTests: false,
            runOracle: false,
        };
        const md = (0, core_1.contextPacketToMarkdown)(packet, roleConfig);
        (0, vitest_1.expect)(md).toContain("## Role: Reviewer");
        (0, vitest_1.expect)(md).toContain("Review code for correctness");
        (0, vitest_1.expect)(md).toContain("Do NOT modify any files");
        (0, vitest_1.expect)(md).toContain("## Done Criteria");
        (0, vitest_1.expect)(md).toContain("Review report written to stdout");
        // Should NOT contain the default engineer instructions
        (0, vitest_1.expect)(md).not.toContain("All changes MUST include tests");
    });
    (0, vitest_1.it)("uses default requirements when no roleConfig provided", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).toContain("All changes MUST include tests");
        (0, vitest_1.expect)(md).not.toContain("## Role:");
        (0, vitest_1.expect)(md).not.toContain("## Done Criteria");
    });
    (0, vitest_1.it)("includes summary in markdown when present", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        packet.summary = "# MyApp Summary\n\n## Current State\n- Phase: Building\n";
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).toContain("## Project Summary");
        (0, vitest_1.expect)(md).toContain("Phase: Building");
    });
    (0, vitest_1.it)("omits summary section when not present", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const md = (0, core_1.contextPacketToMarkdown)(packet);
        (0, vitest_1.expect)(md).not.toContain("## Project Summary");
    });
    (0, vitest_1.it)("always includes git stash warning even with role instructions", async () => {
        const project = makeProject();
        const packet = await (0, core_1.buildContextPacket)(project);
        const roleConfig = {
            roleId: "qa",
            name: "QA Tester",
            permissionMode: "acceptEdits",
            allowedTools: [],
            disallowedTools: [],
            allowedBashPatterns: [],
            instructions: "- Write tests only.",
            doneCriteria: "Tests passing.",
            runTests: true,
            runOracle: false,
        };
        const md = (0, core_1.contextPacketToMarkdown)(packet, roleConfig);
        (0, vitest_1.expect)(md).toContain("git stash");
        (0, vitest_1.expect)(md).toContain("Write tests only");
    });
});
(0, vitest_1.describe)("buildTicketCreationPrompt", () => {
    (0, vitest_1.it)("generates prompt with user description and ticket dir", () => {
        const project = makeProject();
        const prompt = (0, core_1.buildTicketCreationPrompt)(project, "add rate limiting to API", []);
        (0, vitest_1.expect)(prompt).toContain("add rate limiting to API");
        (0, vitest_1.expect)(prompt).toContain("test-project");
        (0, vitest_1.expect)(prompt).toContain(".tickets/<id>/README.md");
        (0, vitest_1.expect)(prompt).toContain("kebab-case");
        (0, vitest_1.expect)(prompt).toContain("frontmatter");
        (0, vitest_1.expect)(prompt).toContain("## Goal");
        (0, vitest_1.expect)(prompt).toContain("## Tasks");
        (0, vitest_1.expect)(prompt).toContain("## Acceptance Criteria");
    });
    (0, vitest_1.it)("includes existing tickets for dependency awareness", () => {
        const project = makeProject();
        const existing = [
            makeWorkItem({ id: "auth-system", title: "Build auth system", status: "in-progress", priority: 1 }),
            makeWorkItem({ id: "db-schema", title: "Design DB schema", status: "closed", priority: 2 }),
        ];
        const prompt = (0, core_1.buildTicketCreationPrompt)(project, "add user profiles", existing);
        (0, vitest_1.expect)(prompt).toContain("Existing tickets");
        (0, vitest_1.expect)(prompt).toContain("auth-system: Build auth system (in-progress, P1");
        (0, vitest_1.expect)(prompt).toContain("db-schema: Design DB schema (closed, P2");
        (0, vitest_1.expect)(prompt).toContain("deps");
    });
    (0, vitest_1.it)("omits existing tickets section when none exist", () => {
        const project = makeProject();
        const prompt = (0, core_1.buildTicketCreationPrompt)(project, "new feature", []);
        (0, vitest_1.expect)(prompt).not.toContain("Existing tickets");
    });
    (0, vitest_1.it)("uses custom ticketDir from project config", () => {
        const project = makeProject({ workSystem: { type: "trk", ticketDir: ".tickets/impl" } });
        const prompt = (0, core_1.buildTicketCreationPrompt)(project, "fix bug", []);
        (0, vitest_1.expect)(prompt).toContain(".tickets/impl/<id>/README.md");
    });
    (0, vitest_1.it)("falls back to .tickets when no workSystem configured", () => {
        const project = makeProject({ workSystem: null });
        const prompt = (0, core_1.buildTicketCreationPrompt)(project, "fix bug", []);
        (0, vitest_1.expect)(prompt).toContain(".tickets/<id>/README.md");
    });
});
(0, vitest_1.describe)("buildTicketChatPrompt", () => {
    (0, vitest_1.it)("includes ticket details and user message", () => {
        const project = makeProject();
        const ticket = makeWorkItem({ id: "auth-flow", title: "Fix auth flow", priority: 1, type: "bug" });
        const prompt = (0, core_1.buildTicketChatPrompt)(project, ticket, "implement this ticket");
        (0, vitest_1.expect)(prompt).toContain("test-project");
        (0, vitest_1.expect)(prompt).toContain("Fix auth flow");
        (0, vitest_1.expect)(prompt).toContain("auth-flow");
        (0, vitest_1.expect)(prompt).toContain("P1");
        (0, vitest_1.expect)(prompt).toContain("bug");
        (0, vitest_1.expect)(prompt).toContain("implement this ticket");
    });
    (0, vitest_1.it)("includes ticket dependencies", () => {
        const project = makeProject();
        const ticket = makeWorkItem({ deps: ["db-schema", "api-design"] });
        const prompt = (0, core_1.buildTicketChatPrompt)(project, ticket, "break into subtasks");
        (0, vitest_1.expect)(prompt).toContain("db-schema, api-design");
    });
    (0, vitest_1.it)("includes ticket file path", () => {
        const project = makeProject();
        const ticket = makeWorkItem({ filePath: "/tmp/test-project/.tickets/my-ticket/README.md" });
        const prompt = (0, core_1.buildTicketChatPrompt)(project, ticket, "update priority");
        (0, vitest_1.expect)(prompt).toContain("/tmp/test-project/.tickets/my-ticket/README.md");
    });
});
//# sourceMappingURL=context-builder.test.js.map