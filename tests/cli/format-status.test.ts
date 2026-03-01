import { describe, it, expect } from "vitest";
import { formatStatusDashboard, formatWorkQueueSummary } from "../../packages/cli/src/ui/format.js";
import type { ProjectStatus } from "@opcom/core";
import type { AgentSession, WorkItem } from "@opcom/types";

// Strip ANSI codes for easier assertion
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeProject(overrides: Partial<ProjectStatus["project"]> = {}): ProjectStatus["project"] {
  return {
    id: "proj-1",
    name: "testproject",
    path: "/home/user/testproject",
    stack: { languages: [], frameworks: [], packageManagers: [], infrastructure: [], versionManagers: [] },
    git: { branch: "main", clean: true, uncommittedCount: 0 },
    workSystem: null,
    ...overrides,
  } as ProjectStatus["project"];
}

function makeStatus(
  projectOverrides: Partial<ProjectStatus["project"]> = {},
  statusOverrides: Partial<ProjectStatus> = {},
): ProjectStatus {
  const project = makeProject(projectOverrides);
  return {
    project,
    workSummary: null,
    gitFresh: project.git,
    ...statusOverrides,
  };
}

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "ticket-1",
    title: "Fix the bug",
    status: "open",
    priority: 2,
    type: "bug",
    filePath: "/path/to/ticket",
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "agent-1",
    projectId: "proj-1",
    backend: "claude-code",
    state: "streaming",
    startedAt: new Date().toISOString(),
    workItemId: undefined,
    ...overrides,
  } as AgentSession;
}

// --- formatStatusDashboard ---

describe("formatStatusDashboard", () => {
  it("renders basic project list", () => {
    const s1 = makeStatus({ name: "folia" });
    const s2 = makeStatus({ name: "life", git: null }, { gitFresh: null });
    const output = strip(formatStatusDashboard("personal", [s1, s2]));

    expect(output).toContain("opcom");
    expect(output).toContain("personal");
    expect(output).toContain("PROJECTS (2)");
    expect(output).toContain("folia");
    expect(output).toContain("life");
    expect(output).toContain("(no git)");
  });

  it("shows ticket summary counts by default", () => {
    const s = makeStatus({ name: "folia" }, { workSummary: { total: 10, open: 5, inProgress: 2, closed: 3, deferred: 0 } });
    const output = strip(formatStatusDashboard("ws", [s]));
    expect(output).toContain("5 open / 10 total");
  });

  it("shows full ticket list for single-project view", () => {
    const s = makeStatus(
      { id: "proj-folia", name: "folia" },
      { workSummary: { total: 3, open: 2, inProgress: 1, closed: 0, deferred: 0 } },
    );
    const tickets: WorkItem[] = [
      makeWorkItem({ id: "auth-bug", title: "Auth migration", priority: 0, status: "in-progress" }),
      makeWorkItem({ id: "perf", title: "Tile server perf", priority: 1 }),
      makeWorkItem({ id: "docs", title: "API docs", priority: 2 }),
    ];
    const projectTickets = new Map([["proj-folia", tickets]]);

    const output = strip(formatStatusDashboard("ws", [s], undefined, {
      projectTickets,
      projectFilter: "folia",
    }));

    expect(output).toContain("Tickets");
    expect(output).toContain("Auth migration");
    expect(output).toContain("Tile server perf");
    expect(output).toContain("API docs");
    // Should be sorted by priority (P0 first)
    const authIdx = output.indexOf("Auth migration");
    const perfIdx = output.indexOf("Tile server perf");
    const docsIdx = output.indexOf("API docs");
    expect(authIdx).toBeLessThan(perfIdx);
    expect(perfIdx).toBeLessThan(docsIdx);
  });

  it("does not show inline tickets in multi-project view", () => {
    const s = makeStatus(
      { id: "proj-folia", name: "folia" },
      { workSummary: { total: 1, open: 1, inProgress: 0, closed: 0, deferred: 0 } },
    );
    const tickets: WorkItem[] = [makeWorkItem({ id: "t1", title: "Some ticket" })];
    const projectTickets = new Map([["proj-folia", tickets]]);

    const output = strip(formatStatusDashboard("ws", [s], undefined, {
      projectTickets,
      projectFilter: null,
    }));

    // Inline tickets section should not appear (the work queue summary is separate)
    const projectsSection = output.split("WORK QUEUE")[0];
    expect(projectsSection).not.toMatch(/P\d\s+.*Some ticket/);
  });

  it("includes global WORK QUEUE in multi-project view", () => {
    const s1 = makeStatus({ id: "proj-folia", name: "folia" });
    const s2 = makeStatus({ id: "proj-life", name: "life" });

    const projectTickets = new Map([
      ["proj-folia", [
        makeWorkItem({ id: "t1", title: "Tile server perf", priority: 1 }),
      ]],
      ["proj-life", [
        makeWorkItem({ id: "t2", title: "Dentist appointment", priority: 1 }),
        makeWorkItem({ id: "t3", title: "Weekly groceries", priority: 3 }),
      ]],
    ]);

    const output = strip(formatStatusDashboard("ws", [s1, s2], undefined, {
      projectTickets,
      projectFilter: null,
    }));

    expect(output).toContain("WORK QUEUE (3)");
    expect(output).toContain("Tile server perf");
    expect(output).toContain("folia");
    expect(output).toContain("Dentist appointment");
    expect(output).toContain("life");
    expect(output).toContain("Weekly groceries");
  });

  it("excludes closed items from global work queue", () => {
    const s = makeStatus({ id: "proj-1", name: "myproj" });
    const projectTickets = new Map([
      ["proj-1", [
        makeWorkItem({ id: "t1", title: "Open task", status: "open" }),
        makeWorkItem({ id: "t2", title: "Done task", status: "closed" }),
      ]],
    ]);

    const output = strip(formatStatusDashboard("ws", [s], undefined, {
      projectTickets,
      projectFilter: null,
    }));

    expect(output).toContain("WORK QUEUE (1)");
    expect(output).toContain("Open task");
    expect(output).not.toContain("Done task");
  });

  it("shows agent icon on work items with active agents", () => {
    const s = makeStatus({ id: "proj-1", name: "folia" });
    const agents: AgentSession[] = [
      makeAgent({ workItemId: "t1", state: "streaming" }),
    ];
    const projectTickets = new Map([
      ["proj-1", [
        makeWorkItem({ id: "t1", title: "Active task", priority: 1 }),
        makeWorkItem({ id: "t2", title: "No agent task", priority: 2 }),
      ]],
    ]);

    const output = formatStatusDashboard("ws", [s], agents, {
      projectTickets,
      projectFilter: null,
    });

    // The active task line should have the robot emoji
    const lines = output.split("\n");
    const activeLine = lines.find((l) => l.includes("Active task"));
    const noAgentLine = lines.find((l) => l.includes("No agent task"));
    expect(activeLine).toContain("\ud83e\udd16");
    expect(noAgentLine).not.toContain("\ud83e\udd16");
  });

  it("does not show WORK QUEUE when no tickets exist", () => {
    const s = makeStatus({ name: "emptyproj" });
    const output = strip(formatStatusDashboard("ws", [s]));
    expect(output).not.toContain("WORK QUEUE");
  });

  it("does not show WORK QUEUE for single-project view", () => {
    const s = makeStatus({ id: "proj-1", name: "folia" });
    const projectTickets = new Map([
      ["proj-1", [makeWorkItem({ id: "t1", title: "Some work" })]],
    ]);

    const output = strip(formatStatusDashboard("ws", [s], undefined, {
      projectTickets,
      projectFilter: "folia",
    }));

    expect(output).not.toContain("WORK QUEUE");
  });
});

// --- formatWorkQueueSummary ---

describe("formatWorkQueueSummary", () => {
  it("sorts items by priority", () => {
    const statuses = [
      makeStatus({ id: "p1", name: "proj-a" }),
      makeStatus({ id: "p2", name: "proj-b" }),
    ];
    const projectTickets = new Map([
      ["p1", [makeWorkItem({ id: "low", title: "Low prio", priority: 3 })]],
      ["p2", [makeWorkItem({ id: "high", title: "High prio", priority: 0 })]],
    ]);

    const output = strip(formatWorkQueueSummary(statuses, projectTickets));
    const highIdx = output.indexOf("High prio");
    const lowIdx = output.indexOf("Low prio");
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it("shows project name next to each item", () => {
    const statuses = [makeStatus({ id: "p1", name: "folia" })];
    const projectTickets = new Map([
      ["p1", [makeWorkItem({ id: "t1", title: "My task", priority: 1 })]],
    ]);

    const output = strip(formatWorkQueueSummary(statuses, projectTickets));
    expect(output).toContain("folia");
    expect(output).toContain("My task");
  });

  it("shows empty message when no open items", () => {
    const statuses = [makeStatus({ id: "p1", name: "proj" })];
    const projectTickets = new Map([
      ["p1", [makeWorkItem({ status: "closed" })]],
    ]);

    const output = strip(formatWorkQueueSummary(statuses, projectTickets));
    expect(output).toContain("WORK QUEUE (0)");
    expect(output).toContain("No open work items");
  });
});
