import { describe, it, expect } from "vitest";
import {
  parseCommand,
  formatStatusResponse,
  formatProjectResponse,
  formatAgentsResponse,
  formatAgentCompletedResponse,
} from "@opcom/core";
import type { ChannelCommand } from "@opcom/core";
import type { ProjectStatusSnapshot, AgentSession, WorkItem } from "@opcom/types";

// --- parseCommand ---

describe("parseCommand", () => {
  it("parses 'status' as status command", () => {
    const cmd = parseCommand("status");
    expect(cmd.type).toBe("status");
    expect(cmd.raw).toBe("status");
  });

  it("parses 'what's going on' as status", () => {
    const cmd = parseCommand("what's going on");
    expect(cmd.type).toBe("status");
  });

  it("parses 'whats going on' (no apostrophe) as status", () => {
    const cmd = parseCommand("whats going on");
    expect(cmd.type).toBe("status");
  });

  it("parses 'how's it going' as status", () => {
    const cmd = parseCommand("how's it going");
    expect(cmd.type).toBe("status");
  });

  it("parses 'status folia' as status_project", () => {
    const cmd = parseCommand("status folia");
    expect(cmd.type).toBe("status_project");
    expect(cmd.projectId).toBe("folia");
  });

  it("parses 'status of folia' as status_project", () => {
    const cmd = parseCommand("status of folia");
    expect(cmd.type).toBe("status_project");
    expect(cmd.projectId).toBe("folia");
  });

  it("parses 'work on folia/tile-server-perf' as work with project and work item", () => {
    const cmd = parseCommand("work on folia/tile-server-perf");
    expect(cmd.type).toBe("work");
    expect(cmd.projectId).toBe("folia");
    expect(cmd.workItemId).toBe("tile-server-perf");
  });

  it("parses 'start folia/auth' as work", () => {
    const cmd = parseCommand("start folia/auth");
    expect(cmd.type).toBe("work");
    expect(cmd.projectId).toBe("folia");
    expect(cmd.workItemId).toBe("auth");
  });

  it("parses 'work on folia' as work with project only", () => {
    const cmd = parseCommand("work on folia");
    expect(cmd.type).toBe("work");
    expect(cmd.projectId).toBe("folia");
    expect(cmd.workItemId).toBeUndefined();
  });

  it("parses 'agents' as agents command", () => {
    const cmd = parseCommand("agents");
    expect(cmd.type).toBe("agents");
  });

  it("parses 'what's running' as agents", () => {
    const cmd = parseCommand("what's running");
    expect(cmd.type).toBe("agents");
  });

  it("parses 'whats running' (no apostrophe) as agents", () => {
    const cmd = parseCommand("whats running");
    expect(cmd.type).toBe("agents");
  });

  it("parses 'who's working' as agents", () => {
    const cmd = parseCommand("who's working");
    expect(cmd.type).toBe("agents");
  });

  it("parses 'stop folia' as stop", () => {
    const cmd = parseCommand("stop folia");
    expect(cmd.type).toBe("stop");
    expect(cmd.projectId).toBe("folia");
  });

  it("parses 'stop the folia agent' as stop", () => {
    const cmd = parseCommand("stop the folia agent");
    expect(cmd.type).toBe("stop");
    expect(cmd.projectId).toBe("folia");
  });

  it("parses 'approve merge' as approve_merge", () => {
    const cmd = parseCommand("approve merge");
    expect(cmd.type).toBe("approve_merge");
  });

  it("parses 'approve' as approve_merge", () => {
    const cmd = parseCommand("approve");
    expect(cmd.type).toBe("approve_merge");
  });

  it("parses 'random text' as unknown", () => {
    const cmd = parseCommand("random text");
    expect(cmd.type).toBe("unknown");
    expect(cmd.raw).toBe("random text");
  });

  it("parses empty string as unknown", () => {
    const cmd = parseCommand("");
    expect(cmd.type).toBe("unknown");
  });

  it("handles leading/trailing whitespace", () => {
    const cmd = parseCommand("  status  ");
    expect(cmd.type).toBe("status");
  });

  it("is case-insensitive", () => {
    const cmd = parseCommand("STATUS");
    expect(cmd.type).toBe("status");

    const cmd2 = parseCommand("Status Folia");
    expect(cmd2.type).toBe("status_project");
    expect(cmd2.projectId).toBe("folia");
  });
});

// --- Format helpers ---

function makeProject(overrides: Partial<ProjectStatusSnapshot> = {}): ProjectStatusSnapshot {
  return {
    id: "folia",
    name: "folia",
    path: "/home/user/projects/folia",
    git: { branch: "main", clean: true, remote: "origin" },
    workSummary: { total: 10, open: 5, inProgress: 2, closed: 3, deferred: 0 },
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
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

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
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

describe("formatStatusResponse", () => {
  it("shows project list and agent count", () => {
    const projects = [makeProject(), makeProject({ id: "mtnmap", name: "mtnmap" })];
    const agents = [makeAgent()];
    const response = formatStatusResponse(projects, agents);

    expect(response.text).toContain("folia");
    expect(response.text).toContain("mtnmap");
    expect(response.text).toContain("1 agent running");
  });

  it("shows 'No agents running' when empty", () => {
    const response = formatStatusResponse([makeProject()], []);
    expect(response.text).toContain("No agents running");
  });

  it("handles no projects", () => {
    const response = formatStatusResponse([], []);
    expect(response.text).toContain("No projects configured");
  });

  it("includes richText with markdown formatting", () => {
    const projects = [makeProject()];
    const response = formatStatusResponse(projects, []);
    expect(response.richText).toBeDefined();
    expect(response.richText).toContain("**folia**");
  });

  it("includes action buttons when agents are active", () => {
    const response = formatStatusResponse([makeProject()], [makeAgent()]);
    expect(response.actions).toBeDefined();
    expect(response.actions!.length).toBeGreaterThan(0);
    expect(response.actions![0].label).toBe("View Agents");
  });

  it("has no actions when no agents are active", () => {
    const response = formatStatusResponse([makeProject()], []);
    expect(response.actions).toBeUndefined();
  });
});

// --- formatProjectResponse ---

describe("formatProjectResponse", () => {
  it("shows project details with tickets", () => {
    const project = makeProject();
    const agents = [makeAgent()];
    const tickets = [
      makeWorkItem(),
      makeWorkItem({ id: "auth", title: "Fix auth", status: "in-progress" }),
    ];

    const response = formatProjectResponse(project, agents, tickets);
    expect(response.text).toContain("folia");
    expect(response.text).toContain("main");
    expect(response.text).toContain("In progress:");
    expect(response.text).toContain("Fix auth");
  });

  it("shows active agents on the project", () => {
    const response = formatProjectResponse(
      makeProject(),
      [makeAgent()],
      [makeWorkItem()],
    );
    expect(response.text).toContain("Active agents:");
    expect(response.text).toContain("claude-code");
  });

  it("provides start work action for open tickets", () => {
    const response = formatProjectResponse(
      makeProject(),
      [],
      [makeWorkItem()],
    );
    expect(response.actions).toBeDefined();
    expect(response.actions![0].label).toBe("Start Work");
  });
});

// --- formatAgentsResponse ---

describe("formatAgentsResponse", () => {
  it("shows active agents with details", () => {
    const agents = [
      makeAgent(),
      makeAgent({ id: "agent-2", projectId: "mtnmap", workItemId: "auth", state: "idle" }),
    ];
    const response = formatAgentsResponse(agents);

    expect(response.text).toContain("2 agents active");
    expect(response.text).toContain("folia");
    expect(response.text).toContain("mtnmap");
  });

  it("shows 'No agents running' when empty", () => {
    const response = formatAgentsResponse([]);
    expect(response.text).toBe("No agents running.");
  });

  it("excludes stopped agents", () => {
    const agents = [makeAgent({ state: "stopped" })];
    const response = formatAgentsResponse(agents);
    expect(response.text).toBe("No agents running.");
  });

  it("includes stop actions for each active agent", () => {
    const agents = [makeAgent()];
    const response = formatAgentsResponse(agents);
    expect(response.actions).toBeDefined();
    expect(response.actions![0].style).toBe("danger");
    expect(response.actions![0].label).toContain("Stop");
  });
});

// --- formatAgentCompletedResponse ---

describe("formatAgentCompletedResponse", () => {
  it("shows completion info with project and work item", () => {
    const agent = makeAgent({ state: "stopped", stoppedAt: new Date().toISOString() });
    const response = formatAgentCompletedResponse(agent);

    expect(response.text).toContain("Agent completed folia/tile-server-perf");
    expect(response.text).toContain("claude-code");
  });

  it("includes approve and view actions", () => {
    const agent = makeAgent();
    const response = formatAgentCompletedResponse(agent);

    expect(response.actions).toBeDefined();
    expect(response.actions!.length).toBe(2);
    expect(response.actions![0].label).toBe("Approve Merge");
    expect(response.actions![1].label).toBe("View Diff");
  });
});
