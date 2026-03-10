"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
function makeBriefingInput(overrides) {
    return {
        projects: [
            {
                name: "my-app",
                gitLog: [
                    "abc1234 Fix login bug",
                    "def5678 Add user dashboard",
                    "ghi9012 Update dependencies",
                ],
                ticketChanges: [
                    {
                        id: "ticket-1",
                        title: "Login bug",
                        oldStatus: "open",
                        newStatus: "closed",
                    },
                    {
                        id: "ticket-2",
                        title: "Dashboard feature",
                        oldStatus: "open",
                        newStatus: "in-progress",
                    },
                ],
                agentSessions: [
                    {
                        workItemId: "ticket-1",
                        duration: "12m",
                        outcome: "completed",
                    },
                ],
            },
        ],
        since: "2026-02-26T00:00:00.000Z",
        ...overrides,
    };
}
(0, vitest_1.describe)("formatBriefingPrompt", () => {
    (0, vitest_1.it)("includes project name and git log", () => {
        const input = makeBriefingInput();
        const prompt = (0, core_1.formatBriefingPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("## Project: my-app");
        (0, vitest_1.expect)(prompt).toContain("Fix login bug");
        (0, vitest_1.expect)(prompt).toContain("Add user dashboard");
        (0, vitest_1.expect)(prompt).toContain("Update dependencies");
    });
    (0, vitest_1.it)("includes ticket changes", () => {
        const input = makeBriefingInput();
        const prompt = (0, core_1.formatBriefingPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("ticket-1");
        (0, vitest_1.expect)(prompt).toContain("Login bug");
        (0, vitest_1.expect)(prompt).toContain("changed from open to closed");
    });
    (0, vitest_1.it)("includes agent sessions", () => {
        const input = makeBriefingInput();
        const prompt = (0, core_1.formatBriefingPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("completed");
        (0, vitest_1.expect)(prompt).toContain("ticket-1");
        (0, vitest_1.expect)(prompt).toContain("12m");
    });
    (0, vitest_1.it)("includes since date", () => {
        const input = makeBriefingInput();
        const prompt = (0, core_1.formatBriefingPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("2026-02-26");
    });
    (0, vitest_1.it)("handles project with no commits", () => {
        const input = makeBriefingInput({
            projects: [
                {
                    name: "idle-project",
                    gitLog: [],
                    ticketChanges: [],
                    agentSessions: [],
                },
            ],
        });
        const prompt = (0, core_1.formatBriefingPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("idle-project");
        (0, vitest_1.expect)(prompt).toContain("No commits in this period");
    });
    (0, vitest_1.it)("includes formatting instructions", () => {
        const input = makeBriefingInput();
        const prompt = (0, core_1.formatBriefingPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("## Summary");
        (0, vitest_1.expect)(prompt).toContain("## Highlights");
        (0, vitest_1.expect)(prompt).toContain("## Concerns");
    });
    (0, vitest_1.it)("includes hygiene issues when provided", () => {
        const input = makeBriefingInput({
            hygieneIssues: [
                {
                    severity: "error",
                    category: "cycle",
                    ticketId: "task-a",
                    message: "Part of dependency cycle: task-a → task-b → task-a",
                    suggestion: "Break the cycle",
                },
                {
                    severity: "warning",
                    category: "stale",
                    ticketId: "old-task",
                    message: "Open for 30 days with no progress",
                    suggestion: "Work on this ticket or defer it",
                },
            ],
        });
        const prompt = (0, core_1.formatBriefingPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("# Ticket Hygiene");
        (0, vitest_1.expect)(prompt).toContain("[error] task-a");
        (0, vitest_1.expect)(prompt).toContain("[warning] old-task");
        (0, vitest_1.expect)(prompt).toContain("dependency cycle");
        (0, vitest_1.expect)(prompt).toContain("30 days");
    });
    (0, vitest_1.it)("omits hygiene section when no issues", () => {
        const input = makeBriefingInput({ hygieneIssues: [] });
        const prompt = (0, core_1.formatBriefingPrompt)(input);
        (0, vitest_1.expect)(prompt).not.toContain("# Ticket Hygiene");
    });
    (0, vitest_1.it)("handles multiple projects", () => {
        const input = makeBriefingInput({
            projects: [
                {
                    name: "project-a",
                    gitLog: ["aaa Fix bug"],
                    ticketChanges: [],
                    agentSessions: [],
                },
                {
                    name: "project-b",
                    gitLog: ["bbb Add feature"],
                    ticketChanges: [],
                    agentSessions: [],
                },
            ],
        });
        const prompt = (0, core_1.formatBriefingPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("## Project: project-a");
        (0, vitest_1.expect)(prompt).toContain("## Project: project-b");
    });
});
(0, vitest_1.describe)("parseBriefingResponse", () => {
    (0, vitest_1.it)("parses well-formed LLM response", () => {
        const response = `## Summary
The team made good progress on the login bug fix and dashboard feature.

## Highlights
- Fixed critical login bug (ticket-1)
- Dashboard feature is now in progress
- Dependencies updated to latest versions

## Concerns
- Dashboard feature has no tests yet
- Build time increased by 30%
`;
        const briefing = (0, core_1.parseBriefingResponse)(response);
        (0, vitest_1.expect)(briefing.summary).toContain("good progress");
        (0, vitest_1.expect)(briefing.highlights).toHaveLength(3);
        (0, vitest_1.expect)(briefing.highlights[0]).toContain("login bug");
        (0, vitest_1.expect)(briefing.concerns).toHaveLength(2);
        (0, vitest_1.expect)(briefing.concerns[0]).toContain("no tests");
        (0, vitest_1.expect)(briefing.generatedAt).toBeTruthy();
    });
    (0, vitest_1.it)("parses response with no concerns", () => {
        const response = `## Summary
Everything looks good.

## Highlights
- All tickets resolved

## Concerns
None.
`;
        const briefing = (0, core_1.parseBriefingResponse)(response);
        (0, vitest_1.expect)(briefing.summary).toBe("Everything looks good.");
        (0, vitest_1.expect)(briefing.highlights).toHaveLength(1);
        (0, vitest_1.expect)(briefing.concerns).toHaveLength(0);
    });
    (0, vitest_1.it)("handles response without section headers", () => {
        const response = "The workspace has been active with 3 commits and 2 ticket changes.";
        const briefing = (0, core_1.parseBriefingResponse)(response);
        (0, vitest_1.expect)(briefing.summary).toBe(response);
        (0, vitest_1.expect)(briefing.highlights).toHaveLength(0);
        (0, vitest_1.expect)(briefing.concerns).toHaveLength(0);
    });
});
(0, vitest_1.describe)("generateBriefing", () => {
    (0, vitest_1.it)("orchestrates prompt formatting and response parsing", async () => {
        const input = makeBriefingInput();
        const mockLlmCall = async (prompt) => {
            (0, vitest_1.expect)(prompt).toContain("my-app");
            return `## Summary
Activity summary for the workspace.

## Highlights
- Login bug fixed
- Dashboard started

## Concerns
- No test coverage for dashboard
`;
        };
        const briefing = await (0, core_1.generateBriefing)(input, mockLlmCall);
        (0, vitest_1.expect)(briefing.summary).toContain("Activity summary");
        (0, vitest_1.expect)(briefing.highlights).toHaveLength(2);
        (0, vitest_1.expect)(briefing.concerns).toHaveLength(1);
        (0, vitest_1.expect)(briefing.generatedAt).toBeTruthy();
    });
    (0, vitest_1.it)("handles empty project list", async () => {
        const input = makeBriefingInput({ projects: [] });
        const mockLlmCall = async () => {
            return `## Summary
No activity to report.

## Highlights

## Concerns
None.
`;
        };
        const briefing = await (0, core_1.generateBriefing)(input, mockLlmCall);
        (0, vitest_1.expect)(briefing.summary).toContain("No activity");
        (0, vitest_1.expect)(briefing.highlights).toHaveLength(0);
        (0, vitest_1.expect)(briefing.concerns).toHaveLength(0);
    });
});
//# sourceMappingURL=briefing.test.js.map