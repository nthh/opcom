import { describe, it, expect } from "vitest";
import {
  assessDecomposition,
  formatPlanningPrompt,
  formatDecompositionPrompt,
  parsePlanningResponse,
  parseDecompositionResponse,
  generatePlanningSession,
  generateDecomposition,
} from "@opcom/core";
import type {
  WorkItem,
  PlanningInput,
  Plan,
  StackInfo,
} from "@opcom/types";

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

const emptyStack: StackInfo = {
  languages: [],
  frameworks: [],
  packageManagers: [],
  infrastructure: [],
  versionManagers: [],
};

function makePlanningInput(overrides?: Partial<PlanningInput>): PlanningInput {
  return {
    projects: [
      {
        name: "my-app",
        projectId: "my-app",
        stack: {
          ...emptyStack,
          languages: [{ name: "typescript", version: "5.7", sourceFile: "tsconfig.json" }],
          frameworks: [{ name: "react", sourceFile: "package.json" }],
        },
        tickets: [
          makeWorkItem({ id: "add-auth", title: "Add authentication", priority: 1 }),
          makeWorkItem({ id: "fix-tests", title: "Fix failing tests", priority: 2, type: "bug" }),
          makeWorkItem({
            id: "add-dashboard",
            title: "Add dashboard",
            priority: 2,
            deps: ["add-auth"],
          }),
        ],
        ticketCount: 3,
      },
    ],
    userPrompt: "Plan the next sprint",
    ...overrides,
  };
}

// --- assessDecomposition ---

describe("assessDecomposition", () => {
  it("returns false for a simple ticket", () => {
    const ticket = makeWorkItem({ id: "simple", title: "Fix login bug" });
    const result = assessDecomposition(ticket);

    expect(result.needsDecomposition).toBe(false);
    expect(result.criteria).toEqual([]);
    expect(result.reason).toContain("agent-sized");
  });

  it("detects multiple providers in title", () => {
    const ticket = makeWorkItem({
      id: "cloud-adapters",
      title: "Cloud storage adapters for R2 and GCS",
    });
    const result = assessDecomposition(ticket);

    expect(result.needsDecomposition).toBe(true);
    expect(result.criteria).toContain("multiple-providers");
  });

  it("detects TUI + backend scope", () => {
    const ticket = makeWorkItem({
      id: "dashboard-api",
      title: "Dashboard TUI and backend API",
    });
    const result = assessDecomposition(ticket);

    expect(result.needsDecomposition).toBe(true);
    expect(result.criteria).toContain("tui-plus-backend");
  });

  it("detects complex spec (>200 lines)", () => {
    const ticket = makeWorkItem({ id: "big-feature", title: "Implement big feature" });
    const spec = "line\n".repeat(250);
    const result = assessDecomposition(ticket, spec);

    expect(result.needsDecomposition).toBe(true);
    expect(result.criteria).toContain("complex-spec");
  });

  it("does not flag spec under threshold", () => {
    const ticket = makeWorkItem({ id: "small-feature", title: "Implement small feature" });
    const spec = "line\n".repeat(50);
    const result = assessDecomposition(ticket, spec);

    expect(result.criteria).not.toContain("complex-spec");
  });

  it("returns false if ticket already has children", () => {
    const parent = makeWorkItem({ id: "cloud-adapters", title: "Cloud storage adapters for R2 and GCS" });
    const children = [
      makeWorkItem({ id: "r2-adapter", title: "R2 adapter", parent: "cloud-adapters" }),
    ];
    const result = assessDecomposition(parent, undefined, [parent, ...children]);

    expect(result.needsDecomposition).toBe(false);
    expect(result.reason).toContain("Already has sub-tickets");
  });

  it("detects types + implementation scope", () => {
    const ticket = makeWorkItem({
      id: "implement-adapter",
      title: "Implement type adapter and test suite",
    });
    const result = assessDecomposition(ticket);

    expect(result.needsDecomposition).toBe(true);
    expect(result.criteria).toContain("types-impl-tests");
  });
});

// --- formatPlanningPrompt ---

describe("formatPlanningPrompt", () => {
  it("includes user prompt", () => {
    const input = makePlanningInput();
    const prompt = formatPlanningPrompt(input);

    expect(prompt).toContain("# User Request");
    expect(prompt).toContain("Plan the next sprint");
  });

  it("includes project information", () => {
    const input = makePlanningInput();
    const prompt = formatPlanningPrompt(input);

    expect(prompt).toContain("## Project: my-app (my-app)");
    expect(prompt).toContain("typescript 5.7");
    expect(prompt).toContain("react");
    expect(prompt).toContain("Tickets: 3 total");
  });

  it("lists open tickets with deps and priority", () => {
    const input = makePlanningInput();
    const prompt = formatPlanningPrompt(input);

    expect(prompt).toContain("[P1] add-auth");
    expect(prompt).toContain("[P2] fix-tests");
    expect(prompt).toContain("deps:[add-auth]");
  });

  it("shows closed tickets when present", () => {
    const input = makePlanningInput({
      projects: [
        {
          name: "my-app",
          projectId: "my-app",
          stack: emptyStack,
          tickets: [
            makeWorkItem({ id: "done-ticket", title: "Done", status: "closed" }),
            makeWorkItem({ id: "open-ticket", title: "Open" }),
          ],
          ticketCount: 2,
        },
      ],
    });
    const prompt = formatPlanningPrompt(input);

    expect(prompt).toContain("### Recently Closed");
    expect(prompt).toContain("done-ticket");
  });

  it("includes current plan info when provided", () => {
    const plan: Plan = {
      id: "plan-1",
      name: "sprint-1",
      status: "executing",
      scope: {},
      steps: [
        { ticketId: "a", projectId: "p", status: "done", blockedBy: [] },
        { ticketId: "b", projectId: "p", status: "in-progress", blockedBy: ["a"] },
        { ticketId: "c", projectId: "p", status: "blocked", blockedBy: ["b"] },
      ],
      config: {
        maxConcurrentAgents: 3, autoStart: false, backend: "claude-code",
        worktree: true, pauseOnFailure: true, ticketTransitions: true,
        autoCommit: true, verification: { runTests: true, runOracle: false },
      },
      context: "Focus on auth first",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };

    const input = makePlanningInput({ currentPlan: plan });
    const prompt = formatPlanningPrompt(input);

    expect(prompt).toContain("# Current Plan");
    expect(prompt).toContain("sprint-1 (executing)");
    expect(prompt).toContain("1 done");
    expect(prompt).toContain("1 in-progress");
    expect(prompt).toContain("Focus on auth first");
  });

  it("includes cloud services when present", () => {
    const input = makePlanningInput({
      projects: [
        {
          name: "cloud-app",
          projectId: "cloud-app",
          stack: emptyStack,
          tickets: [makeWorkItem({ id: "t1" })],
          ticketCount: 1,
          cloudServices: [
            { provider: "turso", kind: "database" } as any,
            { provider: "cloudflare-r2", kind: "storage" } as any,
          ],
        },
      ],
    });
    const prompt = formatPlanningPrompt(input);

    expect(prompt).toContain("Cloud services: turso, cloudflare-r2");
  });

  it("includes response format instructions", () => {
    const input = makePlanningInput();
    const prompt = formatPlanningPrompt(input);

    expect(prompt).toContain("## Plan Name");
    expect(prompt).toContain("## Reasoning");
    expect(prompt).toContain("## Scope");
    expect(prompt).toContain("## New Tickets");
    expect(prompt).toContain("## Decompositions");
    expect(prompt).toContain("## Execution Order");
  });

  it("shows ticket roles when present", () => {
    const input = makePlanningInput({
      projects: [
        {
          name: "my-app",
          projectId: "my-app",
          stack: emptyStack,
          tickets: [
            makeWorkItem({ id: "deploy-infra", title: "Deploy infra", role: "devops" }),
          ],
          ticketCount: 1,
        },
      ],
    });
    const prompt = formatPlanningPrompt(input);

    expect(prompt).toContain("role:devops");
  });

  it("shows parent ticket when present", () => {
    const input = makePlanningInput({
      projects: [
        {
          name: "my-app",
          projectId: "my-app",
          stack: emptyStack,
          tickets: [
            makeWorkItem({ id: "sub-task", title: "Sub task", parent: "big-epic" }),
          ],
          ticketCount: 1,
        },
      ],
    });
    const prompt = formatPlanningPrompt(input);

    expect(prompt).toContain("parent:big-epic");
  });
});

// --- formatDecompositionPrompt ---

describe("formatDecompositionPrompt", () => {
  it("includes ticket info and criteria", () => {
    const ticket = makeWorkItem({
      id: "cloud-storage",
      title: "Cloud storage adapters",
      deps: ["cloud-types"],
    });
    const prompt = formatDecompositionPrompt(ticket, undefined, []);

    expect(prompt).toContain("cloud-storage");
    expect(prompt).toContain("Cloud storage adapters");
    expect(prompt).toContain("Dependencies: cloud-types");
    expect(prompt).toContain("One ticket per provider");
    expect(prompt).toContain(`parent: ${ticket.id}`);
  });

  it("includes spec when provided", () => {
    const ticket = makeWorkItem({ id: "big-feature", title: "Big feature" });
    const spec = "# Storage Spec\nR2 and GCS adapters needed.";
    const prompt = formatDecompositionPrompt(ticket, spec, []);

    expect(prompt).toContain("## Linked Specification");
    expect(prompt).toContain("R2 and GCS adapters needed");
  });

  it("includes other open tickets for dep awareness", () => {
    const ticket = makeWorkItem({ id: "t1", title: "Main ticket" });
    const others = [
      makeWorkItem({ id: "t2", title: "Other open", status: "open" }),
      makeWorkItem({ id: "t3", title: "Closed one", status: "closed" }),
    ];
    const prompt = formatDecompositionPrompt(ticket, undefined, others);

    expect(prompt).toContain("## Existing Tickets");
    expect(prompt).toContain("t2");
    expect(prompt).not.toContain("t3"); // closed tickets excluded
  });
});

// --- parsePlanningResponse ---

describe("parsePlanningResponse", () => {
  it("parses a well-formed planning response", () => {
    const response = `
## Plan Name
sprint-q1-auth

## Reasoning
We should focus on auth first since the dashboard depends on it.
Then tackle tests to stabilize before adding features.

## Scope
- add-auth
- fix-tests
- add-dashboard

## New Tickets

### auth-types
- title: Authentication type definitions
- type: feature
- priority: 1
- deps: []
- parent: add-auth
- description: Define auth types and interfaces

### auth-impl
- title: Authentication implementation
- type: feature
- priority: 1
- deps: [auth-types]
- parent: add-auth
- description: Implement auth logic

## Decompositions

### Decompose: add-auth
- reason: Auth spans types, implementation, and tests
- sub-tickets: auth-types, auth-impl

## Execution Order
- auth-types
- auth-impl
- fix-tests
- add-dashboard
`;

    const proposal = parsePlanningResponse(response);

    expect(proposal.name).toBe("sprint-q1-auth");
    expect(proposal.reasoning).toContain("auth first");
    expect(proposal.scope.ticketIds).toEqual(["add-auth", "fix-tests", "add-dashboard"]);

    // New tickets
    expect(proposal.newTickets).toHaveLength(2);
    expect(proposal.newTickets[0].id).toBe("auth-types");
    expect(proposal.newTickets[0].title).toBe("Authentication type definitions");
    expect(proposal.newTickets[0].type).toBe("feature");
    expect(proposal.newTickets[0].priority).toBe(1);
    expect(proposal.newTickets[0].deps).toEqual([]);
    expect(proposal.newTickets[0].parent).toBe("add-auth");

    expect(proposal.newTickets[1].id).toBe("auth-impl");
    expect(proposal.newTickets[1].deps).toEqual(["auth-types"]);

    // Decompositions
    expect(proposal.decompositions).toHaveLength(1);
    expect(proposal.decompositions[0].parentTicketId).toBe("add-auth");
    expect(proposal.decompositions[0].reason).toContain("types, implementation, and tests");
    expect(proposal.decompositions[0].subTickets).toHaveLength(2);

    // Execution order
    expect(proposal.ordering).toEqual([
      "auth-types",
      "auth-impl",
      "fix-tests",
      "add-dashboard",
    ]);
  });

  it("handles minimal response (no new tickets or decompositions)", () => {
    const response = `
## Plan Name
simple-plan

## Reasoning
Just run the existing tickets in order.

## Scope
- ticket-1
- ticket-2

## Execution Order
- ticket-1
- ticket-2
`;

    const proposal = parsePlanningResponse(response);

    expect(proposal.name).toBe("simple-plan");
    expect(proposal.scope.ticketIds).toEqual(["ticket-1", "ticket-2"]);
    expect(proposal.newTickets).toEqual([]);
    expect(proposal.decompositions).toEqual([]);
    expect(proposal.ordering).toEqual(["ticket-1", "ticket-2"]);
  });

  it("handles completely empty response", () => {
    const proposal = parsePlanningResponse("");

    expect(proposal.name).toBe("untitled-plan");
    expect(proposal.reasoning).toBe("");
    expect(proposal.newTickets).toEqual([]);
    expect(proposal.decompositions).toEqual([]);
    expect(proposal.ordering).toEqual([]);
  });

  it("parses new tickets with various field formats", () => {
    const response = `
## Plan Name
test

## New Tickets

### my-ticket
- title: My New Ticket
- type: bug
- priority: 3
- deps: [dep-a, dep-b]
- description: Fix a critical bug

## Execution Order
- my-ticket
`;

    const proposal = parsePlanningResponse(response);

    expect(proposal.newTickets).toHaveLength(1);
    const ticket = proposal.newTickets[0];
    expect(ticket.id).toBe("my-ticket");
    expect(ticket.title).toBe("My New Ticket");
    expect(ticket.type).toBe("bug");
    expect(ticket.priority).toBe(3);
    expect(ticket.deps).toEqual(["dep-a", "dep-b"]);
    expect(ticket.description).toBe("Fix a critical bug");
  });

  it("defaults missing fields in new tickets", () => {
    const response = `
## Plan Name
test

## New Tickets

### bare-ticket
- title: Just a title

## Execution Order
- bare-ticket
`;

    const proposal = parsePlanningResponse(response);
    const ticket = proposal.newTickets[0];

    expect(ticket.id).toBe("bare-ticket");
    expect(ticket.type).toBe("feature"); // default
    expect(ticket.priority).toBe(2); // default
    expect(ticket.deps).toEqual([]); // default
  });
});

// --- parseDecompositionResponse ---

describe("parseDecompositionResponse", () => {
  it("parses sub-tickets from decomposition response", () => {
    const response = `
### cloud-storage-types
- title: Cloud storage type definitions
- type: feature
- priority: 1
- deps: []
- description: Define types for R2 and GCS

### cloud-r2-adapter
- title: R2 storage adapter
- type: feature
- priority: 2
- deps: [cloud-storage-types]
- description: Implement Cloudflare R2 adapter

### cloud-gcs-adapter
- title: GCS storage adapter
- type: feature
- priority: 2
- deps: [cloud-storage-types]
- description: Implement Google Cloud Storage adapter
`;

    const decomposition = parseDecompositionResponse(response, "cloud-storage");

    expect(decomposition.parentTicketId).toBe("cloud-storage");
    expect(decomposition.subTickets).toHaveLength(3);

    // All sub-tickets should have parent set
    for (const sub of decomposition.subTickets) {
      expect(sub.parent).toBe("cloud-storage");
    }

    expect(decomposition.subTickets[0].id).toBe("cloud-storage-types");
    expect(decomposition.subTickets[0].deps).toEqual([]);

    expect(decomposition.subTickets[1].id).toBe("cloud-r2-adapter");
    expect(decomposition.subTickets[1].deps).toEqual(["cloud-storage-types"]);

    expect(decomposition.subTickets[2].id).toBe("cloud-gcs-adapter");
    expect(decomposition.subTickets[2].deps).toEqual(["cloud-storage-types"]);
  });

  it("handles empty response", () => {
    const decomposition = parseDecompositionResponse("", "parent-ticket");

    expect(decomposition.parentTicketId).toBe("parent-ticket");
    expect(decomposition.subTickets).toEqual([]);
  });

  it("preserves explicit parent from response", () => {
    const response = `
### sub-a
- title: Sub A
- parent: explicit-parent
- deps: []
- description: Has explicit parent
`;

    const decomposition = parseDecompositionResponse(response, "cloud-storage");
    // Should keep explicit parent
    expect(decomposition.subTickets[0].parent).toBe("explicit-parent");
  });
});

// --- generatePlanningSession ---

describe("generatePlanningSession", () => {
  it("orchestrates prompt formatting and response parsing", async () => {
    const input = makePlanningInput();

    const mockLlm = async (prompt: string): Promise<string> => {
      expect(prompt).toContain("my-app");
      expect(prompt).toContain("Plan the next sprint");
      expect(prompt).toContain("add-auth");

      return `
## Plan Name
sprint-1

## Reasoning
Start with auth, then tests, then dashboard.

## Scope
- add-auth
- fix-tests
- add-dashboard

## Execution Order
- add-auth
- fix-tests
- add-dashboard
`;
    };

    const proposal = await generatePlanningSession(input, mockLlm);

    expect(proposal.name).toBe("sprint-1");
    expect(proposal.scope.ticketIds).toEqual(["add-auth", "fix-tests", "add-dashboard"]);
    expect(proposal.ordering).toHaveLength(3);
  });
});

// --- generateDecomposition ---

describe("generateDecomposition", () => {
  it("orchestrates decomposition prompt and response parsing", async () => {
    const ticket = makeWorkItem({
      id: "cloud-storage",
      title: "Cloud storage adapters",
    });

    const mockLlm = async (prompt: string): Promise<string> => {
      expect(prompt).toContain("cloud-storage");
      expect(prompt).toContain("One ticket per provider");

      return `
### cloud-storage-r2
- title: R2 adapter
- type: feature
- priority: 2
- deps: []
- description: Implement R2 adapter

### cloud-storage-gcs
- title: GCS adapter
- type: feature
- priority: 2
- deps: []
- description: Implement GCS adapter
`;
    };

    const decomposition = await generateDecomposition(
      ticket,
      undefined,
      [],
      mockLlm,
    );

    expect(decomposition.parentTicketId).toBe("cloud-storage");
    expect(decomposition.subTickets).toHaveLength(2);
    expect(decomposition.subTickets[0].parent).toBe("cloud-storage");
    expect(decomposition.subTickets[1].parent).toBe("cloud-storage");
  });
});
