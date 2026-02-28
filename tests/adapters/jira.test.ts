import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  JiraAdapter,
  mapJiraStatus,
  mapJiraPriority,
  mapJiraType,
  jiraIssueToWorkItem,
  extractDeps,
  buildAuthHeader,
} from "@opcom/core";
import type { JiraConfig } from "@opcom/core";

// --- Mock Jira API fixtures ---

function makeJiraIssue(overrides?: Record<string, unknown>) {
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

function makeJiraSearchResponse(issues: ReturnType<typeof makeJiraIssue>[], total?: number) {
  return {
    startAt: 0,
    maxResults: 50,
    total: total ?? issues.length,
    issues,
  };
}

const defaultConfig: JiraConfig = {
  baseUrl: "https://team.atlassian.net",
  projectKey: "PROJ",
  email: "user@example.com",
  apiToken: "test-api-token",
};

// --- Status mapping tests ---

describe("mapJiraStatus", () => {
  it("maps 'To Do' to open", () => {
    expect(mapJiraStatus("To Do")).toBe("open");
  });

  it("maps 'Backlog' to open", () => {
    expect(mapJiraStatus("Backlog")).toBe("open");
  });

  it("maps 'Open' to open", () => {
    expect(mapJiraStatus("Open")).toBe("open");
  });

  it("maps 'In Progress' to in-progress", () => {
    expect(mapJiraStatus("In Progress")).toBe("in-progress");
  });

  it("maps 'In Review' to in-progress", () => {
    expect(mapJiraStatus("In Review")).toBe("in-progress");
  });

  it("maps 'Done' to closed", () => {
    expect(mapJiraStatus("Done")).toBe("closed");
  });

  it("maps 'Closed' to closed", () => {
    expect(mapJiraStatus("Closed")).toBe("closed");
  });

  it("maps 'Resolved' to closed", () => {
    expect(mapJiraStatus("Resolved")).toBe("closed");
  });

  it("maps 'Deferred' to deferred", () => {
    expect(mapJiraStatus("Deferred")).toBe("deferred");
  });

  it("maps \"Won't Do\" to deferred", () => {
    expect(mapJiraStatus("Won't Do")).toBe("deferred");
  });

  it("defaults unknown status to open", () => {
    expect(mapJiraStatus("Custom Status")).toBe("open");
  });

  it("is case-insensitive", () => {
    expect(mapJiraStatus("IN PROGRESS")).toBe("in-progress");
    expect(mapJiraStatus("done")).toBe("closed");
    expect(mapJiraStatus("TO DO")).toBe("open");
  });
});

// --- Priority mapping tests ---

describe("mapJiraPriority", () => {
  it("maps 'Highest' to 0", () => {
    expect(mapJiraPriority("Highest")).toBe(0);
  });

  it("maps 'Critical' to 0", () => {
    expect(mapJiraPriority("Critical")).toBe(0);
  });

  it("maps 'Blocker' to 0", () => {
    expect(mapJiraPriority("Blocker")).toBe(0);
  });

  it("maps 'High' to 1", () => {
    expect(mapJiraPriority("High")).toBe(1);
  });

  it("maps 'Medium' to 2", () => {
    expect(mapJiraPriority("Medium")).toBe(2);
  });

  it("maps 'Low' to 3", () => {
    expect(mapJiraPriority("Low")).toBe(3);
  });

  it("maps 'Lowest' to 4", () => {
    expect(mapJiraPriority("Lowest")).toBe(4);
  });

  it("maps 'Trivial' to 4", () => {
    expect(mapJiraPriority("Trivial")).toBe(4);
  });

  it("defaults null priority to 2 (medium)", () => {
    expect(mapJiraPriority(null)).toBe(2);
  });

  it("defaults unknown priority to 2 (medium)", () => {
    expect(mapJiraPriority("Custom Priority")).toBe(2);
  });

  it("is case-insensitive", () => {
    expect(mapJiraPriority("HIGH")).toBe(1);
    expect(mapJiraPriority("low")).toBe(3);
  });
});

// --- Type mapping tests ---

describe("mapJiraType", () => {
  it("maps 'Story' to feature", () => {
    expect(mapJiraType("Story")).toBe("feature");
  });

  it("maps 'User Story' to feature", () => {
    expect(mapJiraType("User Story")).toBe("feature");
  });

  it("maps 'Bug' to bug", () => {
    expect(mapJiraType("Bug")).toBe("bug");
  });

  it("maps 'Defect' to bug", () => {
    expect(mapJiraType("Defect")).toBe("bug");
  });

  it("maps 'Task' to task", () => {
    expect(mapJiraType("Task")).toBe("task");
  });

  it("maps 'Sub-task' to task", () => {
    expect(mapJiraType("Sub-task")).toBe("task");
  });

  it("maps 'Epic' to epic", () => {
    expect(mapJiraType("Epic")).toBe("epic");
  });

  it("defaults unknown type to task", () => {
    expect(mapJiraType("Custom Type")).toBe("task");
  });

  it("is case-insensitive", () => {
    expect(mapJiraType("BUG")).toBe("bug");
    expect(mapJiraType("story")).toBe("feature");
  });
});

// --- Dependency extraction tests ---

describe("extractDeps", () => {
  it("extracts inward 'Blocks' links as deps", () => {
    const links = [
      {
        type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
        inwardIssue: { key: "PROJ-50" },
      },
    ];
    expect(extractDeps(links)).toEqual(["PROJ-50"]);
  });

  it("does not treat outward 'Blocks' links as deps", () => {
    const links = [
      {
        type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
        outwardIssue: { key: "PROJ-60" },
      },
    ];
    expect(extractDeps(links)).toEqual([]);
  });

  it("extracts dependency link type", () => {
    const links = [
      {
        type: { name: "Dependency", inward: "depends on", outward: "is depended on by" },
        inwardIssue: { key: "PROJ-70" },
      },
    ];
    expect(extractDeps(links)).toEqual(["PROJ-70"]);
  });

  it("returns empty array for no relevant links", () => {
    const links = [
      {
        type: { name: "Relates", inward: "relates to", outward: "relates to" },
        inwardIssue: { key: "PROJ-80" },
      },
    ];
    expect(extractDeps(links)).toEqual([]);
  });

  it("handles empty links array", () => {
    expect(extractDeps([])).toEqual([]);
  });

  it("extracts multiple deps", () => {
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
    expect(extractDeps(links)).toEqual(["PROJ-50", "PROJ-51"]);
  });
});

// --- WorkItem construction test ---

describe("jiraIssueToWorkItem", () => {
  it("converts a full Jira issue to a WorkItem", () => {
    const issue = makeJiraIssue();
    const item = jiraIssueToWorkItem(issue);

    expect(item.id).toBe("PROJ-123");
    expect(item.title).toBe("Fix login button not responding");
    expect(item.status).toBe("in-progress");
    expect(item.priority).toBe(1);
    expect(item.type).toBe("bug");
    expect(item.filePath).toBe("");
    expect(item.parent).toBe("PROJ-100");
    expect(item.deps).toEqual([]);
    expect(item.tags).toEqual({ labels: ["frontend", "urgent"] });
    expect(item.links).toEqual([]);
  });

  it("handles issue without labels", () => {
    const issue = makeJiraIssue({ labels: [] });
    const item = jiraIssueToWorkItem(issue);
    expect(item.tags).toEqual({});
  });

  it("handles issue without parent", () => {
    const issue = makeJiraIssue({ parent: undefined });
    const item = jiraIssueToWorkItem(issue);
    expect(item.parent).toBeUndefined();
  });

  it("handles issue without priority", () => {
    const issue = makeJiraIssue({ priority: null });
    const item = jiraIssueToWorkItem(issue);
    expect(item.priority).toBe(2); // default medium
  });

  it("handles issue with blocking deps", () => {
    const issue = makeJiraIssue({
      issuelinks: [
        {
          type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
          inwardIssue: { key: "PROJ-99" },
        },
      ],
    });
    const item = jiraIssueToWorkItem(issue);
    expect(item.deps).toEqual(["PROJ-99"]);
  });
});

// --- Auth header test ---

describe("buildAuthHeader", () => {
  it("builds correct Basic auth header", () => {
    const header = buildAuthHeader({
      baseUrl: "https://team.atlassian.net",
      email: "user@example.com",
      apiToken: "my-token",
    });

    const expected = `Basic ${Buffer.from("user@example.com:my-token").toString("base64")}`;
    expect(header).toBe(expected);
    expect(header).toBe("Basic dXNlckBleGFtcGxlLmNvbTpteS10b2tlbg==");
  });
});

// --- JiraAdapter tests with mocked fetch ---

describe("JiraAdapter", () => {
  let adapter: JiraAdapter;

  beforeEach(() => {
    adapter = new JiraAdapter(defaultConfig);
    vi.restoreAllMocks();
  });

  describe("listItems", () => {
    it("fetches and converts Jira issues to WorkItems", async () => {
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
      (mockIssues[1] as Record<string, unknown>).key = "PROJ-124";

      const mockResponse = makeJiraSearchResponse(mockIssues);

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const items = await adapter.listItems();

      expect(items).toHaveLength(2);
      expect(items[0].id).toBe("PROJ-123");
      expect(items[0].status).toBe("in-progress");
      expect(items[0].type).toBe("bug");
      expect(items[1].id).toBe("PROJ-124");
      expect(items[1].status).toBe("open");
      expect(items[1].type).toBe("feature");
    });

    it("handles pagination", async () => {
      const page1Issues = Array.from({ length: 2 }, (_, i) => {
        const issue = makeJiraIssue({ summary: `Issue ${i + 1}` });
        (issue as Record<string, unknown>).key = `PROJ-${i + 1}`;
        return issue;
      });
      const page2Issues = [makeJiraIssue({ summary: "Issue 3" })];
      (page2Issues[0] as Record<string, unknown>).key = "PROJ-3";

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              startAt: 0,
              maxResults: 2,
              total: 3,
              issues: page1Issues,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              startAt: 2,
              maxResults: 2,
              total: 3,
              issues: page2Issues,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );

      const items = await adapter.listItems({ maxResults: 2 });

      expect(items).toHaveLength(3);
      expect(items[0].id).toBe("PROJ-1");
      expect(items[2].id).toBe("PROJ-3");
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("sends correct authorization header", async () => {
      const mockResponse = makeJiraSearchResponse([]);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await adapter.listItems();

      const expectedAuth = `Basic ${Buffer.from("user@example.com:test-api-token").toString("base64")}`;
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("https://team.atlassian.net/rest/api/3/search"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expectedAuth,
          }),
        }),
      );
    });
  });

  describe("getItem", () => {
    it("fetches a single issue by key", async () => {
      const issue = makeJiraIssue();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(issue), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const item = await adapter.getItem("PROJ-123");

      expect(item).not.toBeNull();
      expect(item!.id).toBe("PROJ-123");
      expect(item!.title).toBe("Fix login button not responding");
      expect(fetch).toHaveBeenCalledWith(
        "https://team.atlassian.net/rest/api/3/issue/PROJ-123",
        expect.any(Object),
      );
    });

    it("returns null for 404", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Not found", { status: 404 }),
      );

      const item = await adapter.getItem("PROJ-999");
      expect(item).toBeNull();
    });

    it("throws on API error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Server Error", { status: 500, statusText: "Internal Server Error" }),
      );

      await expect(adapter.getItem("PROJ-123")).rejects.toThrow("Jira API error: 500");
    });
  });

  describe("summarize", () => {
    it("returns correct summary counts", async () => {
      const issues = [
        makeJiraIssue({ status: { name: "To Do" } }),
        makeJiraIssue({ status: { name: "Open" } }),
        makeJiraIssue({ status: { name: "In Progress" } }),
        makeJiraIssue({ status: { name: "Done" } }),
        makeJiraIssue({ status: { name: "Deferred" } }),
      ];
      issues.forEach((issue, i) => {
        (issue as Record<string, unknown>).key = `PROJ-${i + 1}`;
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(makeJiraSearchResponse(issues)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const summary = await adapter.summarize();

      expect(summary.total).toBe(5);
      expect(summary.open).toBe(2);
      expect(summary.inProgress).toBe(1);
      expect(summary.closed).toBe(1);
      expect(summary.deferred).toBe(1);
    });
  });

  describe("cache behavior", () => {
    it("uses cached results on second call within TTL", async () => {
      const mockResponse = makeJiraSearchResponse([makeJiraIssue()]);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      // First call fetches from API
      const items1 = await adapter.listItems();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second call uses cache
      const items2 = await adapter.listItems();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      expect(items1).toEqual(items2);
    });

    it("re-fetches after cache is cleared", async () => {
      const mockResponse = makeJiraSearchResponse([makeJiraIssue()]);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await adapter.listItems();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      adapter.clearCache();

      await adapter.listItems();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("re-fetches after cache expires", async () => {
      const mockResponse = makeJiraSearchResponse([makeJiraIssue()]);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await adapter.listItems();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Manually expire the cache by tampering with the internal timestamp
      const cache = adapter._getCacheEntry();
      if (cache) {
        cache.fetchedAt = Date.now() - 6 * 60 * 1000; // 6 minutes ago
      }

      await adapter.listItems();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("detect", () => {
    it("returns true when JIRA_BASE_URL env var is set", async () => {
      const original = process.env.JIRA_BASE_URL;
      try {
        process.env.JIRA_BASE_URL = "https://team.atlassian.net";
        const result = await adapter.detect("/tmp/some-project");
        expect(result).toBe(true);
      } finally {
        if (original === undefined) {
          delete process.env.JIRA_BASE_URL;
        } else {
          process.env.JIRA_BASE_URL = original;
        }
      }
    });

    it("returns false when no env var and no config file", async () => {
      const original = process.env.JIRA_BASE_URL;
      try {
        delete process.env.JIRA_BASE_URL;
        const result = await adapter.detect("/tmp/nonexistent-project");
        expect(result).toBe(false);
      } finally {
        if (original !== undefined) {
          process.env.JIRA_BASE_URL = original;
        }
      }
    });
  });
});
