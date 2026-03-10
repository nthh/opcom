"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
// --- Mock Jira API fixtures ---
function makeJiraIssue(overrides) {
    return {
        key: "PROJ-123",
        fields: {
            summary: "Fix login button not responding",
            status: { name: "In Progress" },
            priority: { name: "High" },
            issuetype: { name: "Bug" },
            labels: ["frontend", "urgent"],
            issuelinks: [],
            parent: { key: "PROJ-100" },
            ...(overrides ?? {}),
        },
    };
}
function makeJiraSearchResponse(issues, total) {
    return {
        startAt: 0,
        maxResults: 50,
        total: total ?? issues.length,
        issues,
    };
}
const defaultConfig = {
    baseUrl: "https://team.atlassian.net",
    projectKey: "PROJ",
    email: "user@example.com",
    apiToken: "test-api-token",
};
// --- Status mapping tests ---
(0, vitest_1.describe)("mapJiraStatus", () => {
    (0, vitest_1.it)("maps 'To Do' to open", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("To Do")).toBe("open");
    });
    (0, vitest_1.it)("maps 'Backlog' to open", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("Backlog")).toBe("open");
    });
    (0, vitest_1.it)("maps 'Open' to open", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("Open")).toBe("open");
    });
    (0, vitest_1.it)("maps 'In Progress' to in-progress", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("In Progress")).toBe("in-progress");
    });
    (0, vitest_1.it)("maps 'In Review' to in-progress", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("In Review")).toBe("in-progress");
    });
    (0, vitest_1.it)("maps 'Done' to closed", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("Done")).toBe("closed");
    });
    (0, vitest_1.it)("maps 'Closed' to closed", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("Closed")).toBe("closed");
    });
    (0, vitest_1.it)("maps 'Resolved' to closed", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("Resolved")).toBe("closed");
    });
    (0, vitest_1.it)("maps 'Deferred' to deferred", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("Deferred")).toBe("deferred");
    });
    (0, vitest_1.it)("maps \"Won't Do\" to deferred", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("Won't Do")).toBe("deferred");
    });
    (0, vitest_1.it)("defaults unknown status to open", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("Custom Status")).toBe("open");
    });
    (0, vitest_1.it)("is case-insensitive", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("IN PROGRESS")).toBe("in-progress");
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("done")).toBe("closed");
        (0, vitest_1.expect)((0, core_1.mapJiraStatus)("TO DO")).toBe("open");
    });
});
// --- Priority mapping tests ---
(0, vitest_1.describe)("mapJiraPriority", () => {
    (0, vitest_1.it)("maps 'Highest' to 0", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraPriority)("Highest")).toBe(0);
    });
    (0, vitest_1.it)("maps 'Critical' to 0", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraPriority)("Critical")).toBe(0);
    });
    (0, vitest_1.it)("maps 'Blocker' to 0", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraPriority)("Blocker")).toBe(0);
    });
    (0, vitest_1.it)("maps 'High' to 1", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraPriority)("High")).toBe(1);
    });
    (0, vitest_1.it)("maps 'Medium' to 2", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraPriority)("Medium")).toBe(2);
    });
    (0, vitest_1.it)("maps 'Low' to 3", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraPriority)("Low")).toBe(3);
    });
    (0, vitest_1.it)("maps 'Lowest' to 4", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraPriority)("Lowest")).toBe(4);
    });
    (0, vitest_1.it)("maps 'Trivial' to 4", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraPriority)("Trivial")).toBe(4);
    });
    (0, vitest_1.it)("defaults null priority to 2 (medium)", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraPriority)(null)).toBe(2);
    });
    (0, vitest_1.it)("defaults unknown priority to 2 (medium)", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraPriority)("Custom Priority")).toBe(2);
    });
    (0, vitest_1.it)("is case-insensitive", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraPriority)("HIGH")).toBe(1);
        (0, vitest_1.expect)((0, core_1.mapJiraPriority)("low")).toBe(3);
    });
});
// --- Type mapping tests ---
(0, vitest_1.describe)("mapJiraType", () => {
    (0, vitest_1.it)("maps 'Story' to feature", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraType)("Story")).toBe("feature");
    });
    (0, vitest_1.it)("maps 'User Story' to feature", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraType)("User Story")).toBe("feature");
    });
    (0, vitest_1.it)("maps 'Bug' to bug", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraType)("Bug")).toBe("bug");
    });
    (0, vitest_1.it)("maps 'Defect' to bug", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraType)("Defect")).toBe("bug");
    });
    (0, vitest_1.it)("maps 'Task' to task", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraType)("Task")).toBe("task");
    });
    (0, vitest_1.it)("maps 'Sub-task' to task", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraType)("Sub-task")).toBe("task");
    });
    (0, vitest_1.it)("maps 'Epic' to epic", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraType)("Epic")).toBe("epic");
    });
    (0, vitest_1.it)("defaults unknown type to task", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraType)("Custom Type")).toBe("task");
    });
    (0, vitest_1.it)("is case-insensitive", () => {
        (0, vitest_1.expect)((0, core_1.mapJiraType)("BUG")).toBe("bug");
        (0, vitest_1.expect)((0, core_1.mapJiraType)("story")).toBe("feature");
    });
});
// --- Dependency extraction tests ---
(0, vitest_1.describe)("extractDeps", () => {
    (0, vitest_1.it)("extracts inward 'Blocks' links as deps", () => {
        const links = [
            {
                type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
                inwardIssue: { key: "PROJ-50" },
            },
        ];
        (0, vitest_1.expect)((0, core_1.extractDeps)(links)).toEqual(["PROJ-50"]);
    });
    (0, vitest_1.it)("does not treat outward 'Blocks' links as deps", () => {
        const links = [
            {
                type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
                outwardIssue: { key: "PROJ-60" },
            },
        ];
        (0, vitest_1.expect)((0, core_1.extractDeps)(links)).toEqual([]);
    });
    (0, vitest_1.it)("extracts dependency link type", () => {
        const links = [
            {
                type: { name: "Dependency", inward: "depends on", outward: "is depended on by" },
                inwardIssue: { key: "PROJ-70" },
            },
        ];
        (0, vitest_1.expect)((0, core_1.extractDeps)(links)).toEqual(["PROJ-70"]);
    });
    (0, vitest_1.it)("returns empty array for no relevant links", () => {
        const links = [
            {
                type: { name: "Relates", inward: "relates to", outward: "relates to" },
                inwardIssue: { key: "PROJ-80" },
            },
        ];
        (0, vitest_1.expect)((0, core_1.extractDeps)(links)).toEqual([]);
    });
    (0, vitest_1.it)("handles empty links array", () => {
        (0, vitest_1.expect)((0, core_1.extractDeps)([])).toEqual([]);
    });
    (0, vitest_1.it)("extracts multiple deps", () => {
        const links = [
            {
                type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
                inwardIssue: { key: "PROJ-50" },
            },
            {
                type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
                inwardIssue: { key: "PROJ-51" },
            },
        ];
        (0, vitest_1.expect)((0, core_1.extractDeps)(links)).toEqual(["PROJ-50", "PROJ-51"]);
    });
});
// --- WorkItem construction test ---
(0, vitest_1.describe)("jiraIssueToWorkItem", () => {
    (0, vitest_1.it)("converts a full Jira issue to a WorkItem", () => {
        const issue = makeJiraIssue();
        const item = (0, core_1.jiraIssueToWorkItem)(issue);
        (0, vitest_1.expect)(item.id).toBe("PROJ-123");
        (0, vitest_1.expect)(item.title).toBe("Fix login button not responding");
        (0, vitest_1.expect)(item.status).toBe("in-progress");
        (0, vitest_1.expect)(item.priority).toBe(1);
        (0, vitest_1.expect)(item.type).toBe("bug");
        (0, vitest_1.expect)(item.filePath).toBe("");
        (0, vitest_1.expect)(item.parent).toBe("PROJ-100");
        (0, vitest_1.expect)(item.deps).toEqual([]);
        (0, vitest_1.expect)(item.tags).toEqual({ labels: ["frontend", "urgent"] });
        (0, vitest_1.expect)(item.links).toEqual([]);
    });
    (0, vitest_1.it)("handles issue without labels", () => {
        const issue = makeJiraIssue({ labels: [] });
        const item = (0, core_1.jiraIssueToWorkItem)(issue);
        (0, vitest_1.expect)(item.tags).toEqual({});
    });
    (0, vitest_1.it)("handles issue without parent", () => {
        const issue = makeJiraIssue({ parent: undefined });
        const item = (0, core_1.jiraIssueToWorkItem)(issue);
        (0, vitest_1.expect)(item.parent).toBeUndefined();
    });
    (0, vitest_1.it)("handles issue without priority", () => {
        const issue = makeJiraIssue({ priority: null });
        const item = (0, core_1.jiraIssueToWorkItem)(issue);
        (0, vitest_1.expect)(item.priority).toBe(2); // default medium
    });
    (0, vitest_1.it)("handles issue with blocking deps", () => {
        const issue = makeJiraIssue({
            issuelinks: [
                {
                    type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
                    inwardIssue: { key: "PROJ-99" },
                },
            ],
        });
        const item = (0, core_1.jiraIssueToWorkItem)(issue);
        (0, vitest_1.expect)(item.deps).toEqual(["PROJ-99"]);
    });
});
// --- Auth header test ---
(0, vitest_1.describe)("buildAuthHeader", () => {
    (0, vitest_1.it)("builds correct Basic auth header", () => {
        const header = (0, core_1.buildAuthHeader)({
            baseUrl: "https://team.atlassian.net",
            email: "user@example.com",
            apiToken: "my-token",
        });
        const expected = `Basic ${Buffer.from("user@example.com:my-token").toString("base64")}`;
        (0, vitest_1.expect)(header).toBe(expected);
        (0, vitest_1.expect)(header).toBe("Basic dXNlckBleGFtcGxlLmNvbTpteS10b2tlbg==");
    });
});
// --- JiraAdapter tests with mocked fetch ---
(0, vitest_1.describe)("JiraAdapter", () => {
    let adapter;
    (0, vitest_1.beforeEach)(() => {
        adapter = new core_1.JiraAdapter(defaultConfig);
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.describe)("listItems", () => {
        (0, vitest_1.it)("fetches and converts Jira issues to WorkItems", async () => {
            const mockIssues = [
                makeJiraIssue(),
                makeJiraIssue({
                    summary: "Add dark mode",
                    status: { name: "To Do" },
                    priority: { name: "Medium" },
                    issuetype: { name: "Story" },
                    labels: [],
                    issuelinks: [],
                    parent: undefined,
                }),
            ];
            // Override the key on second issue
            mockIssues[1].key = "PROJ-124";
            const mockResponse = makeJiraSearchResponse(mockIssues);
            vitest_1.vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }));
            const items = await adapter.listItems();
            (0, vitest_1.expect)(items).toHaveLength(2);
            (0, vitest_1.expect)(items[0].id).toBe("PROJ-123");
            (0, vitest_1.expect)(items[0].status).toBe("in-progress");
            (0, vitest_1.expect)(items[0].type).toBe("bug");
            (0, vitest_1.expect)(items[1].id).toBe("PROJ-124");
            (0, vitest_1.expect)(items[1].status).toBe("open");
            (0, vitest_1.expect)(items[1].type).toBe("feature");
        });
        (0, vitest_1.it)("handles pagination", async () => {
            const page1Issues = Array.from({ length: 2 }, (_, i) => {
                const issue = makeJiraIssue({ summary: `Issue ${i + 1}` });
                issue.key = `PROJ-${i + 1}`;
                return issue;
            });
            const page2Issues = [makeJiraIssue({ summary: "Issue 3" })];
            page2Issues[0].key = "PROJ-3";
            vitest_1.vi.spyOn(globalThis, "fetch")
                .mockResolvedValueOnce(new Response(JSON.stringify({
                startAt: 0,
                maxResults: 2,
                total: 3,
                issues: page1Issues,
            }), { status: 200, headers: { "Content-Type": "application/json" } }))
                .mockResolvedValueOnce(new Response(JSON.stringify({
                startAt: 2,
                maxResults: 2,
                total: 3,
                issues: page2Issues,
            }), { status: 200, headers: { "Content-Type": "application/json" } }));
            const items = await adapter.listItems({ maxResults: 2 });
            (0, vitest_1.expect)(items).toHaveLength(3);
            (0, vitest_1.expect)(items[0].id).toBe("PROJ-1");
            (0, vitest_1.expect)(items[2].id).toBe("PROJ-3");
            (0, vitest_1.expect)(fetch).toHaveBeenCalledTimes(2);
        });
        (0, vitest_1.it)("sends correct authorization header", async () => {
            const mockResponse = makeJiraSearchResponse([]);
            const fetchSpy = vitest_1.vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }));
            await adapter.listItems();
            const expectedAuth = `Basic ${Buffer.from("user@example.com:test-api-token").toString("base64")}`;
            (0, vitest_1.expect)(fetchSpy).toHaveBeenCalledWith(vitest_1.expect.stringContaining("https://team.atlassian.net/rest/api/3/search"), vitest_1.expect.objectContaining({
                headers: vitest_1.expect.objectContaining({
                    Authorization: expectedAuth,
                }),
            }));
        });
    });
    (0, vitest_1.describe)("getItem", () => {
        (0, vitest_1.it)("fetches a single issue by key", async () => {
            const issue = makeJiraIssue();
            vitest_1.vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(issue), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }));
            const item = await adapter.getItem("PROJ-123");
            (0, vitest_1.expect)(item).not.toBeNull();
            (0, vitest_1.expect)(item.id).toBe("PROJ-123");
            (0, vitest_1.expect)(item.title).toBe("Fix login button not responding");
            (0, vitest_1.expect)(fetch).toHaveBeenCalledWith("https://team.atlassian.net/rest/api/3/issue/PROJ-123", vitest_1.expect.any(Object));
        });
        (0, vitest_1.it)("returns null for 404", async () => {
            vitest_1.vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Not found", { status: 404 }));
            const item = await adapter.getItem("PROJ-999");
            (0, vitest_1.expect)(item).toBeNull();
        });
        (0, vitest_1.it)("throws on API error", async () => {
            vitest_1.vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Server Error", { status: 500, statusText: "Internal Server Error" }));
            await (0, vitest_1.expect)(adapter.getItem("PROJ-123")).rejects.toThrow("Jira API error: 500");
        });
    });
    (0, vitest_1.describe)("summarize", () => {
        (0, vitest_1.it)("returns correct summary counts", async () => {
            const issues = [
                makeJiraIssue({ status: { name: "To Do" } }),
                makeJiraIssue({ status: { name: "Open" } }),
                makeJiraIssue({ status: { name: "In Progress" } }),
                makeJiraIssue({ status: { name: "Done" } }),
                makeJiraIssue({ status: { name: "Deferred" } }),
            ];
            issues.forEach((issue, i) => {
                issue.key = `PROJ-${i + 1}`;
            });
            vitest_1.vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(makeJiraSearchResponse(issues)), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }));
            const summary = await adapter.summarize();
            (0, vitest_1.expect)(summary.total).toBe(5);
            (0, vitest_1.expect)(summary.open).toBe(2);
            (0, vitest_1.expect)(summary.inProgress).toBe(1);
            (0, vitest_1.expect)(summary.closed).toBe(1);
            (0, vitest_1.expect)(summary.deferred).toBe(1);
        });
    });
    (0, vitest_1.describe)("cache behavior", () => {
        (0, vitest_1.it)("uses cached results on second call within TTL", async () => {
            const mockResponse = makeJiraSearchResponse([makeJiraIssue()]);
            const fetchSpy = vitest_1.vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }));
            // First call fetches from API
            const items1 = await adapter.listItems();
            (0, vitest_1.expect)(fetchSpy).toHaveBeenCalledTimes(1);
            // Second call uses cache
            const items2 = await adapter.listItems();
            (0, vitest_1.expect)(fetchSpy).toHaveBeenCalledTimes(1);
            (0, vitest_1.expect)(items1).toEqual(items2);
        });
        (0, vitest_1.it)("re-fetches after cache is cleared", async () => {
            const mockResponse = makeJiraSearchResponse([makeJiraIssue()]);
            const fetchSpy = vitest_1.vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }));
            await adapter.listItems();
            (0, vitest_1.expect)(fetchSpy).toHaveBeenCalledTimes(1);
            adapter.clearCache();
            await adapter.listItems();
            (0, vitest_1.expect)(fetchSpy).toHaveBeenCalledTimes(2);
        });
        (0, vitest_1.it)("re-fetches after cache expires", async () => {
            const mockResponse = makeJiraSearchResponse([makeJiraIssue()]);
            const fetchSpy = vitest_1.vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(mockResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }));
            await adapter.listItems();
            (0, vitest_1.expect)(fetchSpy).toHaveBeenCalledTimes(1);
            // Manually expire the cache by tampering with the internal timestamp
            const cache = adapter._getCacheEntry();
            if (cache) {
                cache.fetchedAt = Date.now() - 6 * 60 * 1000; // 6 minutes ago
            }
            await adapter.listItems();
            (0, vitest_1.expect)(fetchSpy).toHaveBeenCalledTimes(2);
        });
    });
    (0, vitest_1.describe)("detect", () => {
        (0, vitest_1.it)("returns true when JIRA_BASE_URL env var is set", async () => {
            const original = process.env.JIRA_BASE_URL;
            try {
                process.env.JIRA_BASE_URL = "https://team.atlassian.net";
                const result = await adapter.detect("/tmp/some-project");
                (0, vitest_1.expect)(result).toBe(true);
            }
            finally {
                if (original === undefined) {
                    delete process.env.JIRA_BASE_URL;
                }
                else {
                    process.env.JIRA_BASE_URL = original;
                }
            }
        });
        (0, vitest_1.it)("returns false when no env var and no config file", async () => {
            const original = process.env.JIRA_BASE_URL;
            try {
                delete process.env.JIRA_BASE_URL;
                const result = await adapter.detect("/tmp/nonexistent-project");
                (0, vitest_1.expect)(result).toBe(false);
            }
            finally {
                if (original !== undefined) {
                    process.env.JIRA_BASE_URL = original;
                }
            }
        });
    });
});
//# sourceMappingURL=jira.test.js.map