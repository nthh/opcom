"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
function makeWorkItem(overrides) {
    return {
        id: "ticket-1",
        title: "Test Ticket",
        status: "open",
        priority: 2,
        type: "feature",
        filePath: "/tmp/test/.tickets/ticket-1/README.md",
        deps: [],
        links: [],
        tags: {},
        ...overrides,
    };
}
function makeTriageInput(overrides) {
    return {
        projects: [
            {
                name: "my-app",
                tickets: [
                    makeWorkItem({ id: "ticket-1", title: "Add caching", priority: 1 }),
                    makeWorkItem({ id: "ticket-2", title: "Fix tests", priority: 2 }),
                    makeWorkItem({
                        id: "ticket-3",
                        title: "Blocked task",
                        priority: 1,
                        deps: ["ticket-1"],
                    }),
                ],
                agentCount: 1,
                lastCommitAge: 4,
            },
        ],
        ...overrides,
    };
}
(0, vitest_1.describe)("filterBlockedTickets", () => {
    (0, vitest_1.it)("returns tickets with no deps", () => {
        const tickets = [
            makeWorkItem({ id: "a", deps: [] }),
            makeWorkItem({ id: "b", deps: [] }),
        ];
        const result = (0, core_1.filterBlockedTickets)(tickets, tickets);
        (0, vitest_1.expect)(result).toHaveLength(2);
    });
    (0, vitest_1.it)("filters out tickets with unresolved deps", () => {
        const allTickets = [
            makeWorkItem({ id: "a", deps: [], status: "open" }),
            makeWorkItem({ id: "b", deps: ["a"] }),
        ];
        const openTickets = allTickets.filter((t) => t.status === "open");
        const result = (0, core_1.filterBlockedTickets)(openTickets, allTickets);
        // "a" has no deps so it passes; "b" depends on "a" which is still open
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].id).toBe("a");
    });
    (0, vitest_1.it)("allows tickets whose deps are all closed", () => {
        const allTickets = [
            makeWorkItem({ id: "a", deps: [], status: "closed" }),
            makeWorkItem({ id: "b", deps: ["a"], status: "open" }),
        ];
        const openTickets = allTickets.filter((t) => t.status === "open");
        const result = (0, core_1.filterBlockedTickets)(openTickets, allTickets);
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].id).toBe("b");
    });
    (0, vitest_1.it)("filters ticket with multiple unresolved deps", () => {
        const allTickets = [
            makeWorkItem({ id: "a", deps: [], status: "closed" }),
            makeWorkItem({ id: "b", deps: [], status: "open" }),
            makeWorkItem({ id: "c", deps: ["a", "b"], status: "open" }),
        ];
        const openTickets = allTickets.filter((t) => t.status === "open");
        const result = (0, core_1.filterBlockedTickets)(openTickets, allTickets);
        // "b" is unblocked (no deps); "c" is blocked because "b" is still open
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].id).toBe("b");
    });
});
(0, vitest_1.describe)("formatTriagePrompt", () => {
    (0, vitest_1.it)("includes project information", () => {
        const input = makeTriageInput();
        const prompt = (0, core_1.formatTriagePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("## Project: my-app");
        (0, vitest_1.expect)(prompt).toContain("Active agents: 1");
        (0, vitest_1.expect)(prompt).toContain("Hours since last commit: 4");
    });
    (0, vitest_1.it)("separates available and blocked tickets", () => {
        const input = makeTriageInput();
        const prompt = (0, core_1.formatTriagePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("### Available Tickets");
        (0, vitest_1.expect)(prompt).toContain("### Blocked Tickets");
        (0, vitest_1.expect)(prompt).toContain("ticket-3");
        (0, vitest_1.expect)(prompt).toContain("blocked by: ticket-1");
    });
    (0, vitest_1.it)("shows ticket priorities", () => {
        const input = makeTriageInput();
        const prompt = (0, core_1.formatTriagePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("[P1] ticket-1");
        (0, vitest_1.expect)(prompt).toContain("[P2] ticket-2");
    });
    (0, vitest_1.it)("includes response format instructions", () => {
        const input = makeTriageInput();
        const prompt = (0, core_1.formatTriagePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("**Action**");
        (0, vitest_1.expect)(prompt).toContain("**Project**");
        (0, vitest_1.expect)(prompt).toContain("**Reasoning**");
    });
    (0, vitest_1.it)("handles project with no tickets", () => {
        const input = makeTriageInput({
            projects: [
                {
                    name: "empty-project",
                    tickets: [],
                    agentCount: 0,
                    lastCommitAge: 100,
                },
            ],
        });
        const prompt = (0, core_1.formatTriagePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("empty-project");
        (0, vitest_1.expect)(prompt).not.toContain("### Available Tickets");
    });
});
(0, vitest_1.describe)("parseTriageResponse", () => {
    (0, vitest_1.it)("parses well-formed numbered recommendations", () => {
        const response = `1. **Action**: Implement caching layer
   - **Project**: my-app
   - **Ticket**: ticket-1
   - **Priority**: 1
   - **Reasoning**: High priority unblocked ticket with clear requirements

2. **Action**: Fix failing test suite
   - **Project**: my-app
   - **Ticket**: ticket-2
   - **Priority**: 2
   - **Reasoning**: Tests should pass before adding new features

3. **Action**: Review stale project
   - **Project**: other-app
   - **Ticket**: N/A
   - **Priority**: 3
   - **Reasoning**: No commits in 100 hours suggests abandoned work
`;
        const recommendations = (0, core_1.parseTriageResponse)(response);
        (0, vitest_1.expect)(recommendations).toHaveLength(3);
        (0, vitest_1.expect)(recommendations[0].action).toBe("Implement caching layer");
        (0, vitest_1.expect)(recommendations[0].project).toBe("my-app");
        (0, vitest_1.expect)(recommendations[0].ticketId).toBe("ticket-1");
        (0, vitest_1.expect)(recommendations[0].priority).toBe(1);
        (0, vitest_1.expect)(recommendations[0].reasoning).toContain("High priority");
        (0, vitest_1.expect)(recommendations[1].action).toBe("Fix failing test suite");
        (0, vitest_1.expect)(recommendations[1].ticketId).toBe("ticket-2");
        (0, vitest_1.expect)(recommendations[2].ticketId).toBeUndefined();
    });
    (0, vitest_1.it)("returns empty array for unparseable response", () => {
        const response = "I cannot analyze the workspace state.";
        const recommendations = (0, core_1.parseTriageResponse)(response);
        (0, vitest_1.expect)(recommendations).toHaveLength(0);
    });
});
(0, vitest_1.describe)("generateTriage", () => {
    (0, vitest_1.it)("orchestrates prompt formatting and response parsing", async () => {
        const input = makeTriageInput();
        const mockLlmCall = async (prompt) => {
            (0, vitest_1.expect)(prompt).toContain("my-app");
            return `1. **Action**: Add caching
   - **Project**: my-app
   - **Ticket**: ticket-1
   - **Priority**: 1
   - **Reasoning**: Top priority item
`;
        };
        const recommendations = await (0, core_1.generateTriage)(input, mockLlmCall);
        (0, vitest_1.expect)(recommendations).toHaveLength(1);
        (0, vitest_1.expect)(recommendations[0].action).toBe("Add caching");
        (0, vitest_1.expect)(recommendations[0].project).toBe("my-app");
        (0, vitest_1.expect)(recommendations[0].ticketId).toBe("ticket-1");
    });
});
//# sourceMappingURL=triage.test.js.map