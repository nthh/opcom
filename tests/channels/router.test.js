"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
// --- parseCommand ---
(0, vitest_1.describe)("parseCommand", () => {
    (0, vitest_1.it)("parses 'status' as status command", () => {
        const cmd = (0, core_1.parseCommand)("status");
        (0, vitest_1.expect)(cmd.type).toBe("status");
        (0, vitest_1.expect)(cmd.raw).toBe("status");
    });
    (0, vitest_1.it)("parses 'what's going on' as status", () => {
        const cmd = (0, core_1.parseCommand)("what's going on");
        (0, vitest_1.expect)(cmd.type).toBe("status");
    });
    (0, vitest_1.it)("parses 'whats going on' (no apostrophe) as status", () => {
        const cmd = (0, core_1.parseCommand)("whats going on");
        (0, vitest_1.expect)(cmd.type).toBe("status");
    });
    (0, vitest_1.it)("parses 'how's it going' as status", () => {
        const cmd = (0, core_1.parseCommand)("how's it going");
        (0, vitest_1.expect)(cmd.type).toBe("status");
    });
    (0, vitest_1.it)("parses 'status folia' as status_project", () => {
        const cmd = (0, core_1.parseCommand)("status folia");
        (0, vitest_1.expect)(cmd.type).toBe("status_project");
        (0, vitest_1.expect)(cmd.projectId).toBe("folia");
    });
    (0, vitest_1.it)("parses 'status of folia' as status_project", () => {
        const cmd = (0, core_1.parseCommand)("status of folia");
        (0, vitest_1.expect)(cmd.type).toBe("status_project");
        (0, vitest_1.expect)(cmd.projectId).toBe("folia");
    });
    (0, vitest_1.it)("parses 'work on folia/tile-server-perf' as work with project and work item", () => {
        const cmd = (0, core_1.parseCommand)("work on folia/tile-server-perf");
        (0, vitest_1.expect)(cmd.type).toBe("work");
        (0, vitest_1.expect)(cmd.projectId).toBe("folia");
        (0, vitest_1.expect)(cmd.workItemId).toBe("tile-server-perf");
    });
    (0, vitest_1.it)("parses 'start folia/auth' as work", () => {
        const cmd = (0, core_1.parseCommand)("start folia/auth");
        (0, vitest_1.expect)(cmd.type).toBe("work");
        (0, vitest_1.expect)(cmd.projectId).toBe("folia");
        (0, vitest_1.expect)(cmd.workItemId).toBe("auth");
    });
    (0, vitest_1.it)("parses 'work on folia' as work with project only", () => {
        const cmd = (0, core_1.parseCommand)("work on folia");
        (0, vitest_1.expect)(cmd.type).toBe("work");
        (0, vitest_1.expect)(cmd.projectId).toBe("folia");
        (0, vitest_1.expect)(cmd.workItemId).toBeUndefined();
    });
    (0, vitest_1.it)("parses 'agents' as agents command", () => {
        const cmd = (0, core_1.parseCommand)("agents");
        (0, vitest_1.expect)(cmd.type).toBe("agents");
    });
    (0, vitest_1.it)("parses 'what's running' as agents", () => {
        const cmd = (0, core_1.parseCommand)("what's running");
        (0, vitest_1.expect)(cmd.type).toBe("agents");
    });
    (0, vitest_1.it)("parses 'whats running' (no apostrophe) as agents", () => {
        const cmd = (0, core_1.parseCommand)("whats running");
        (0, vitest_1.expect)(cmd.type).toBe("agents");
    });
    (0, vitest_1.it)("parses 'who's working' as agents", () => {
        const cmd = (0, core_1.parseCommand)("who's working");
        (0, vitest_1.expect)(cmd.type).toBe("agents");
    });
    (0, vitest_1.it)("parses 'stop folia' as stop", () => {
        const cmd = (0, core_1.parseCommand)("stop folia");
        (0, vitest_1.expect)(cmd.type).toBe("stop");
        (0, vitest_1.expect)(cmd.projectId).toBe("folia");
    });
    (0, vitest_1.it)("parses 'stop the folia agent' as stop", () => {
        const cmd = (0, core_1.parseCommand)("stop the folia agent");
        (0, vitest_1.expect)(cmd.type).toBe("stop");
        (0, vitest_1.expect)(cmd.projectId).toBe("folia");
    });
    (0, vitest_1.it)("parses 'approve merge' as approve_merge", () => {
        const cmd = (0, core_1.parseCommand)("approve merge");
        (0, vitest_1.expect)(cmd.type).toBe("approve_merge");
    });
    (0, vitest_1.it)("parses 'approve' as approve_merge", () => {
        const cmd = (0, core_1.parseCommand)("approve");
        (0, vitest_1.expect)(cmd.type).toBe("approve_merge");
    });
    (0, vitest_1.it)("parses 'random text' as unknown", () => {
        const cmd = (0, core_1.parseCommand)("random text");
        (0, vitest_1.expect)(cmd.type).toBe("unknown");
        (0, vitest_1.expect)(cmd.raw).toBe("random text");
    });
    (0, vitest_1.it)("parses empty string as unknown", () => {
        const cmd = (0, core_1.parseCommand)("");
        (0, vitest_1.expect)(cmd.type).toBe("unknown");
    });
    (0, vitest_1.it)("handles leading/trailing whitespace", () => {
        const cmd = (0, core_1.parseCommand)("  status  ");
        (0, vitest_1.expect)(cmd.type).toBe("status");
    });
    (0, vitest_1.it)("is case-insensitive", () => {
        const cmd = (0, core_1.parseCommand)("STATUS");
        (0, vitest_1.expect)(cmd.type).toBe("status");
        const cmd2 = (0, core_1.parseCommand)("Status Folia");
        (0, vitest_1.expect)(cmd2.type).toBe("status_project");
        (0, vitest_1.expect)(cmd2.projectId).toBe("folia");
    });
});
// --- Format helpers ---
function makeProject(overrides = {}) {
    return {
        id: "folia",
        name: "folia",
        path: "/home/user/projects/folia",
        git: { branch: "main", clean: true, remote: "origin" },
        workSummary: { total: 10, open: 5, inProgress: 2, closed: 3, deferred: 0 },
        ...overrides,
    };
}
function makeAgent(overrides = {}) {
    return {
        id: "agent-1",
        backend: "claude-code",
        projectId: "folia",
        state: "streaming",
        startedAt: new Date(Date.now() - 15 * 60_000).toISOString(), // 15 min ago
        workItemId: "tile-server-perf",
        ...overrides,
    };
}
function makeWorkItem(overrides = {}) {
    return {
        id: "tile-server-perf",
        title: "Improve tile server performance",
        status: "open",
        priority: 1,
        type: "feature",
        filePath: "/tickets/tile-server-perf.md",
        deps: [],
        links: [],
        tags: {},
        ...overrides,
    };
}
// --- formatStatusResponse ---
(0, vitest_1.describe)("formatStatusResponse", () => {
    (0, vitest_1.it)("shows project list and agent count", () => {
        const projects = [makeProject(), makeProject({ id: "mtnmap", name: "mtnmap" })];
        const agents = [makeAgent()];
        const response = (0, core_1.formatStatusResponse)(projects, agents);
        (0, vitest_1.expect)(response.text).toContain("folia");
        (0, vitest_1.expect)(response.text).toContain("mtnmap");
        (0, vitest_1.expect)(response.text).toContain("1 agent running");
    });
    (0, vitest_1.it)("shows 'No agents running' when empty", () => {
        const response = (0, core_1.formatStatusResponse)([makeProject()], []);
        (0, vitest_1.expect)(response.text).toContain("No agents running");
    });
    (0, vitest_1.it)("handles no projects", () => {
        const response = (0, core_1.formatStatusResponse)([], []);
        (0, vitest_1.expect)(response.text).toContain("No projects configured");
    });
    (0, vitest_1.it)("includes richText with markdown formatting", () => {
        const projects = [makeProject()];
        const response = (0, core_1.formatStatusResponse)(projects, []);
        (0, vitest_1.expect)(response.richText).toBeDefined();
        (0, vitest_1.expect)(response.richText).toContain("**folia**");
    });
    (0, vitest_1.it)("includes action buttons when agents are active", () => {
        const response = (0, core_1.formatStatusResponse)([makeProject()], [makeAgent()]);
        (0, vitest_1.expect)(response.actions).toBeDefined();
        (0, vitest_1.expect)(response.actions.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(response.actions[0].label).toBe("View Agents");
    });
    (0, vitest_1.it)("has no actions when no agents are active", () => {
        const response = (0, core_1.formatStatusResponse)([makeProject()], []);
        (0, vitest_1.expect)(response.actions).toBeUndefined();
    });
});
// --- formatProjectResponse ---
(0, vitest_1.describe)("formatProjectResponse", () => {
    (0, vitest_1.it)("shows project details with tickets", () => {
        const project = makeProject();
        const agents = [makeAgent()];
        const tickets = [
            makeWorkItem(),
            makeWorkItem({ id: "auth", title: "Fix auth", status: "in-progress" }),
        ];
        const response = (0, core_1.formatProjectResponse)(project, agents, tickets);
        (0, vitest_1.expect)(response.text).toContain("folia");
        (0, vitest_1.expect)(response.text).toContain("main");
        (0, vitest_1.expect)(response.text).toContain("In progress:");
        (0, vitest_1.expect)(response.text).toContain("Fix auth");
    });
    (0, vitest_1.it)("shows active agents on the project", () => {
        const response = (0, core_1.formatProjectResponse)(makeProject(), [makeAgent()], [makeWorkItem()]);
        (0, vitest_1.expect)(response.text).toContain("Active agents:");
        (0, vitest_1.expect)(response.text).toContain("claude-code");
    });
    (0, vitest_1.it)("provides start work action for open tickets", () => {
        const response = (0, core_1.formatProjectResponse)(makeProject(), [], [makeWorkItem()]);
        (0, vitest_1.expect)(response.actions).toBeDefined();
        (0, vitest_1.expect)(response.actions[0].label).toBe("Start Work");
    });
});
// --- formatAgentsResponse ---
(0, vitest_1.describe)("formatAgentsResponse", () => {
    (0, vitest_1.it)("shows active agents with details", () => {
        const agents = [
            makeAgent(),
            makeAgent({ id: "agent-2", projectId: "mtnmap", workItemId: "auth", state: "idle" }),
        ];
        const response = (0, core_1.formatAgentsResponse)(agents);
        (0, vitest_1.expect)(response.text).toContain("2 agents active");
        (0, vitest_1.expect)(response.text).toContain("folia");
        (0, vitest_1.expect)(response.text).toContain("mtnmap");
    });
    (0, vitest_1.it)("shows 'No agents running' when empty", () => {
        const response = (0, core_1.formatAgentsResponse)([]);
        (0, vitest_1.expect)(response.text).toBe("No agents running.");
    });
    (0, vitest_1.it)("excludes stopped agents", () => {
        const agents = [makeAgent({ state: "stopped" })];
        const response = (0, core_1.formatAgentsResponse)(agents);
        (0, vitest_1.expect)(response.text).toBe("No agents running.");
    });
    (0, vitest_1.it)("includes stop actions for each active agent", () => {
        const agents = [makeAgent()];
        const response = (0, core_1.formatAgentsResponse)(agents);
        (0, vitest_1.expect)(response.actions).toBeDefined();
        (0, vitest_1.expect)(response.actions[0].style).toBe("danger");
        (0, vitest_1.expect)(response.actions[0].label).toContain("Stop");
    });
});
// --- formatAgentCompletedResponse ---
(0, vitest_1.describe)("formatAgentCompletedResponse", () => {
    (0, vitest_1.it)("shows completion info with project and work item", () => {
        const agent = makeAgent({ state: "stopped", stoppedAt: new Date().toISOString() });
        const response = (0, core_1.formatAgentCompletedResponse)(agent);
        (0, vitest_1.expect)(response.text).toContain("Agent completed folia/tile-server-perf");
        (0, vitest_1.expect)(response.text).toContain("claude-code");
    });
    (0, vitest_1.it)("includes approve and view actions", () => {
        const agent = makeAgent();
        const response = (0, core_1.formatAgentCompletedResponse)(agent);
        (0, vitest_1.expect)(response.actions).toBeDefined();
        (0, vitest_1.expect)(response.actions.length).toBe(2);
        (0, vitest_1.expect)(response.actions[0].label).toBe("Approve Merge");
        (0, vitest_1.expect)(response.actions[1].label).toBe("View Diff");
    });
});
//# sourceMappingURL=router.test.js.map