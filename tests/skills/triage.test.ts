import { describe, it, expect } from "vitest";
import {
  formatTriagePrompt,
  parseTriageResponse,
  filterBlockedTickets,
  generateTriage,
} from "@opcom/core";
import type { TriageInput } from "@opcom/core";
import type { WorkItem } from "@opcom/types";

function makeWorkItem(overrides?: Partial<WorkItem>): WorkItem {
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

function makeTriageInput(
  overrides?: Partial<TriageInput>,
): TriageInput {
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

describe("filterBlockedTickets", () => {
  it("returns tickets with no deps", () => {
    const tickets = [
      makeWorkItem({ id: "a", deps: [] }),
      makeWorkItem({ id: "b", deps: [] }),
    ];
    const result = filterBlockedTickets(tickets, tickets);
    expect(result).toHaveLength(2);
  });

  it("filters out tickets with unresolved deps", () => {
    const allTickets = [
      makeWorkItem({ id: "a", deps: [], status: "open" }),
      makeWorkItem({ id: "b", deps: ["a"] }),
    ];
    const openTickets = allTickets.filter((t) => t.status === "open");
    const result = filterBlockedTickets(openTickets, allTickets);

    // "a" has no deps so it passes; "b" depends on "a" which is still open
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("allows tickets whose deps are all closed", () => {
    const allTickets = [
      makeWorkItem({ id: "a", deps: [], status: "closed" }),
      makeWorkItem({ id: "b", deps: ["a"], status: "open" }),
    ];
    const openTickets = allTickets.filter((t) => t.status === "open");
    const result = filterBlockedTickets(openTickets, allTickets);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("filters ticket with multiple unresolved deps", () => {
    const allTickets = [
      makeWorkItem({ id: "a", deps: [], status: "closed" }),
      makeWorkItem({ id: "b", deps: [], status: "open" }),
      makeWorkItem({ id: "c", deps: ["a", "b"], status: "open" }),
    ];
    const openTickets = allTickets.filter((t) => t.status === "open");
    const result = filterBlockedTickets(openTickets, allTickets);

    // "b" is unblocked (no deps); "c" is blocked because "b" is still open
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });
});

describe("formatTriagePrompt", () => {
  it("includes project information", () => {
    const input = makeTriageInput();
    const prompt = formatTriagePrompt(input);

    expect(prompt).toContain("## Project: my-app");
    expect(prompt).toContain("Active agents: 1");
    expect(prompt).toContain("Hours since last commit: 4");
  });

  it("separates available and blocked tickets", () => {
    const input = makeTriageInput();
    const prompt = formatTriagePrompt(input);

    expect(prompt).toContain("### Available Tickets");
    expect(prompt).toContain("### Blocked Tickets");
    expect(prompt).toContain("ticket-3");
    expect(prompt).toContain("blocked by: ticket-1");
  });

  it("shows ticket priorities", () => {
    const input = makeTriageInput();
    const prompt = formatTriagePrompt(input);

    expect(prompt).toContain("[P1] ticket-1");
    expect(prompt).toContain("[P2] ticket-2");
  });

  it("includes response format instructions", () => {
    const input = makeTriageInput();
    const prompt = formatTriagePrompt(input);

    expect(prompt).toContain("**Action**");
    expect(prompt).toContain("**Project**");
    expect(prompt).toContain("**Reasoning**");
  });

  it("handles project with no tickets", () => {
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
    const prompt = formatTriagePrompt(input);

    expect(prompt).toContain("empty-project");
    expect(prompt).not.toContain("### Available Tickets");
  });
});

describe("parseTriageResponse", () => {
  it("parses well-formed numbered recommendations", () => {
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

    const recommendations = parseTriageResponse(response);

    expect(recommendations).toHaveLength(3);
    expect(recommendations[0].action).toBe("Implement caching layer");
    expect(recommendations[0].project).toBe("my-app");
    expect(recommendations[0].ticketId).toBe("ticket-1");
    expect(recommendations[0].priority).toBe(1);
    expect(recommendations[0].reasoning).toContain("High priority");

    expect(recommendations[1].action).toBe("Fix failing test suite");
    expect(recommendations[1].ticketId).toBe("ticket-2");

    expect(recommendations[2].ticketId).toBeUndefined();
  });

  it("returns empty array for unparseable response", () => {
    const response = "I cannot analyze the workspace state.";
    const recommendations = parseTriageResponse(response);
    expect(recommendations).toHaveLength(0);
  });
});

describe("generateTriage", () => {
  it("orchestrates prompt formatting and response parsing", async () => {
    const input = makeTriageInput();

    const mockLlmCall = async (prompt: string): Promise<string> => {
      expect(prompt).toContain("my-app");
      return `1. **Action**: Add caching
   - **Project**: my-app
   - **Ticket**: ticket-1
   - **Priority**: 1
   - **Reasoning**: Top priority item
`;
    };

    const recommendations = await generateTriage(input, mockLlmCall);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].action).toBe("Add caching");
    expect(recommendations[0].project).toBe("my-app");
    expect(recommendations[0].ticketId).toBe("ticket-1");
  });
});
