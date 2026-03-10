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
const emptyStack = {
    languages: [],
    frameworks: [],
    packageManagers: [],
    infrastructure: [],
    versionManagers: [],
};
function makePlanningInput(overrides) {
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
(0, vitest_1.describe)("assessDecomposition", () => {
    (0, vitest_1.it)("returns false for a simple ticket", () => {
        const ticket = makeWorkItem({ id: "simple", title: "Fix login bug" });
        const result = (0, core_1.assessDecomposition)(ticket);
        (0, vitest_1.expect)(result.needsDecomposition).toBe(false);
        (0, vitest_1.expect)(result.criteria).toEqual([]);
        (0, vitest_1.expect)(result.reason).toContain("agent-sized");
    });
    (0, vitest_1.it)("detects multiple providers in title", () => {
        const ticket = makeWorkItem({
            id: "cloud-adapters",
            title: "Cloud storage adapters for R2 and GCS",
        });
        const result = (0, core_1.assessDecomposition)(ticket);
        (0, vitest_1.expect)(result.needsDecomposition).toBe(true);
        (0, vitest_1.expect)(result.criteria).toContain("multiple-providers");
    });
    (0, vitest_1.it)("detects TUI + backend scope", () => {
        const ticket = makeWorkItem({
            id: "dashboard-api",
            title: "Dashboard TUI and backend API",
        });
        const result = (0, core_1.assessDecomposition)(ticket);
        (0, vitest_1.expect)(result.needsDecomposition).toBe(true);
        (0, vitest_1.expect)(result.criteria).toContain("tui-plus-backend");
    });
    (0, vitest_1.it)("detects complex spec (>200 lines)", () => {
        const ticket = makeWorkItem({ id: "big-feature", title: "Implement big feature" });
        const spec = "line\n".repeat(250);
        const result = (0, core_1.assessDecomposition)(ticket, spec);
        (0, vitest_1.expect)(result.needsDecomposition).toBe(true);
        (0, vitest_1.expect)(result.criteria).toContain("complex-spec");
    });
    (0, vitest_1.it)("does not flag spec under threshold", () => {
        const ticket = makeWorkItem({ id: "small-feature", title: "Implement small feature" });
        const spec = "line\n".repeat(50);
        const result = (0, core_1.assessDecomposition)(ticket, spec);
        (0, vitest_1.expect)(result.criteria).not.toContain("complex-spec");
    });
    (0, vitest_1.it)("returns false if ticket already has children", () => {
        const parent = makeWorkItem({ id: "cloud-adapters", title: "Cloud storage adapters for R2 and GCS" });
        const children = [
            makeWorkItem({ id: "r2-adapter", title: "R2 adapter", parent: "cloud-adapters" }),
        ];
        const result = (0, core_1.assessDecomposition)(parent, undefined, [parent, ...children]);
        (0, vitest_1.expect)(result.needsDecomposition).toBe(false);
        (0, vitest_1.expect)(result.reason).toContain("Already has sub-tickets");
    });
    (0, vitest_1.it)("detects types + implementation scope", () => {
        const ticket = makeWorkItem({
            id: "implement-adapter",
            title: "Implement type adapter and test suite",
        });
        const result = (0, core_1.assessDecomposition)(ticket);
        (0, vitest_1.expect)(result.needsDecomposition).toBe(true);
        (0, vitest_1.expect)(result.criteria).toContain("types-impl-tests");
    });
});
// --- formatPlanningPrompt ---
(0, vitest_1.describe)("formatPlanningPrompt", () => {
    (0, vitest_1.it)("includes user prompt", () => {
        const input = makePlanningInput();
        const prompt = (0, core_1.formatPlanningPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("# User Request");
        (0, vitest_1.expect)(prompt).toContain("Plan the next sprint");
    });
    (0, vitest_1.it)("includes project information", () => {
        const input = makePlanningInput();
        const prompt = (0, core_1.formatPlanningPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("## Project: my-app (my-app)");
        (0, vitest_1.expect)(prompt).toContain("typescript 5.7");
        (0, vitest_1.expect)(prompt).toContain("react");
        (0, vitest_1.expect)(prompt).toContain("Tickets: 3 total");
    });
    (0, vitest_1.it)("lists open tickets with deps and priority", () => {
        const input = makePlanningInput();
        const prompt = (0, core_1.formatPlanningPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("[P1] add-auth");
        (0, vitest_1.expect)(prompt).toContain("[P2] fix-tests");
        (0, vitest_1.expect)(prompt).toContain("deps:[add-auth]");
    });
    (0, vitest_1.it)("shows closed tickets when present", () => {
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
        const prompt = (0, core_1.formatPlanningPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("### Recently Closed");
        (0, vitest_1.expect)(prompt).toContain("done-ticket");
    });
    (0, vitest_1.it)("includes current plan info when provided", () => {
        const plan = {
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
        const prompt = (0, core_1.formatPlanningPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("# Current Plan");
        (0, vitest_1.expect)(prompt).toContain("sprint-1 (executing)");
        (0, vitest_1.expect)(prompt).toContain("1 done");
        (0, vitest_1.expect)(prompt).toContain("1 in-progress");
        (0, vitest_1.expect)(prompt).toContain("Focus on auth first");
    });
    (0, vitest_1.it)("includes cloud services when present", () => {
        const input = makePlanningInput({
            projects: [
                {
                    name: "cloud-app",
                    projectId: "cloud-app",
                    stack: emptyStack,
                    tickets: [makeWorkItem({ id: "t1" })],
                    ticketCount: 1,
                    cloudServices: [
                        { provider: "turso", kind: "database" },
                        { provider: "cloudflare-r2", kind: "storage" },
                    ],
                },
            ],
        });
        const prompt = (0, core_1.formatPlanningPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("Cloud services: turso, cloudflare-r2");
    });
    (0, vitest_1.it)("includes response format instructions", () => {
        const input = makePlanningInput();
        const prompt = (0, core_1.formatPlanningPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("## Plan Name");
        (0, vitest_1.expect)(prompt).toContain("## Reasoning");
        (0, vitest_1.expect)(prompt).toContain("## Scope");
        (0, vitest_1.expect)(prompt).toContain("## New Tickets");
        (0, vitest_1.expect)(prompt).toContain("## Decompositions");
        (0, vitest_1.expect)(prompt).toContain("## Execution Order");
    });
    (0, vitest_1.it)("shows ticket roles when present", () => {
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
        const prompt = (0, core_1.formatPlanningPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("role:devops");
    });
    (0, vitest_1.it)("shows parent ticket when present", () => {
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
        const prompt = (0, core_1.formatPlanningPrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("parent:big-epic");
    });
});
// --- formatDecompositionPrompt ---
(0, vitest_1.describe)("formatDecompositionPrompt", () => {
    (0, vitest_1.it)("includes ticket info and criteria", () => {
        const ticket = makeWorkItem({
            id: "cloud-storage",
            title: "Cloud storage adapters",
            deps: ["cloud-types"],
        });
        const prompt = (0, core_1.formatDecompositionPrompt)(ticket, undefined, []);
        (0, vitest_1.expect)(prompt).toContain("cloud-storage");
        (0, vitest_1.expect)(prompt).toContain("Cloud storage adapters");
        (0, vitest_1.expect)(prompt).toContain("Dependencies: cloud-types");
        (0, vitest_1.expect)(prompt).toContain("One ticket per provider");
        (0, vitest_1.expect)(prompt).toContain(`parent: ${ticket.id}`);
    });
    (0, vitest_1.it)("includes spec when provided", () => {
        const ticket = makeWorkItem({ id: "big-feature", title: "Big feature" });
        const spec = "# Storage Spec\nR2 and GCS adapters needed.";
        const prompt = (0, core_1.formatDecompositionPrompt)(ticket, spec, []);
        (0, vitest_1.expect)(prompt).toContain("## Linked Specification");
        (0, vitest_1.expect)(prompt).toContain("R2 and GCS adapters needed");
    });
    (0, vitest_1.it)("includes other open tickets for dep awareness", () => {
        const ticket = makeWorkItem({ id: "t1", title: "Main ticket" });
        const others = [
            makeWorkItem({ id: "t2", title: "Other open", status: "open" }),
            makeWorkItem({ id: "t3", title: "Closed one", status: "closed" }),
        ];
        const prompt = (0, core_1.formatDecompositionPrompt)(ticket, undefined, others);
        (0, vitest_1.expect)(prompt).toContain("## Existing Tickets");
        (0, vitest_1.expect)(prompt).toContain("t2");
        (0, vitest_1.expect)(prompt).not.toContain("t3"); // closed tickets excluded
    });
});
// --- parsePlanningResponse ---
(0, vitest_1.describe)("parsePlanningResponse", () => {
    (0, vitest_1.it)("parses a well-formed planning response", () => {
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
        const proposal = (0, core_1.parsePlanningResponse)(response);
        (0, vitest_1.expect)(proposal.name).toBe("sprint-q1-auth");
        (0, vitest_1.expect)(proposal.reasoning).toContain("auth first");
        (0, vitest_1.expect)(proposal.scope.ticketIds).toEqual(["add-auth", "fix-tests", "add-dashboard"]);
        // New tickets
        (0, vitest_1.expect)(proposal.newTickets).toHaveLength(2);
        (0, vitest_1.expect)(proposal.newTickets[0].id).toBe("auth-types");
        (0, vitest_1.expect)(proposal.newTickets[0].title).toBe("Authentication type definitions");
        (0, vitest_1.expect)(proposal.newTickets[0].type).toBe("feature");
        (0, vitest_1.expect)(proposal.newTickets[0].priority).toBe(1);
        (0, vitest_1.expect)(proposal.newTickets[0].deps).toEqual([]);
        (0, vitest_1.expect)(proposal.newTickets[0].parent).toBe("add-auth");
        (0, vitest_1.expect)(proposal.newTickets[1].id).toBe("auth-impl");
        (0, vitest_1.expect)(proposal.newTickets[1].deps).toEqual(["auth-types"]);
        // Decompositions
        (0, vitest_1.expect)(proposal.decompositions).toHaveLength(1);
        (0, vitest_1.expect)(proposal.decompositions[0].parentTicketId).toBe("add-auth");
        (0, vitest_1.expect)(proposal.decompositions[0].reason).toContain("types, implementation, and tests");
        (0, vitest_1.expect)(proposal.decompositions[0].subTickets).toHaveLength(2);
        // Execution order
        (0, vitest_1.expect)(proposal.ordering).toEqual([
            "auth-types",
            "auth-impl",
            "fix-tests",
            "add-dashboard",
        ]);
    });
    (0, vitest_1.it)("handles minimal response (no new tickets or decompositions)", () => {
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
        const proposal = (0, core_1.parsePlanningResponse)(response);
        (0, vitest_1.expect)(proposal.name).toBe("simple-plan");
        (0, vitest_1.expect)(proposal.scope.ticketIds).toEqual(["ticket-1", "ticket-2"]);
        (0, vitest_1.expect)(proposal.newTickets).toEqual([]);
        (0, vitest_1.expect)(proposal.decompositions).toEqual([]);
        (0, vitest_1.expect)(proposal.ordering).toEqual(["ticket-1", "ticket-2"]);
    });
    (0, vitest_1.it)("handles completely empty response", () => {
        const proposal = (0, core_1.parsePlanningResponse)("");
        (0, vitest_1.expect)(proposal.name).toBe("untitled-plan");
        (0, vitest_1.expect)(proposal.reasoning).toBe("");
        (0, vitest_1.expect)(proposal.newTickets).toEqual([]);
        (0, vitest_1.expect)(proposal.decompositions).toEqual([]);
        (0, vitest_1.expect)(proposal.ordering).toEqual([]);
    });
    (0, vitest_1.it)("parses new tickets with various field formats", () => {
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
        const proposal = (0, core_1.parsePlanningResponse)(response);
        (0, vitest_1.expect)(proposal.newTickets).toHaveLength(1);
        const ticket = proposal.newTickets[0];
        (0, vitest_1.expect)(ticket.id).toBe("my-ticket");
        (0, vitest_1.expect)(ticket.title).toBe("My New Ticket");
        (0, vitest_1.expect)(ticket.type).toBe("bug");
        (0, vitest_1.expect)(ticket.priority).toBe(3);
        (0, vitest_1.expect)(ticket.deps).toEqual(["dep-a", "dep-b"]);
        (0, vitest_1.expect)(ticket.description).toBe("Fix a critical bug");
    });
    (0, vitest_1.it)("defaults missing fields in new tickets", () => {
        const response = `
## Plan Name
test

## New Tickets

### bare-ticket
- title: Just a title

## Execution Order
- bare-ticket
`;
        const proposal = (0, core_1.parsePlanningResponse)(response);
        const ticket = proposal.newTickets[0];
        (0, vitest_1.expect)(ticket.id).toBe("bare-ticket");
        (0, vitest_1.expect)(ticket.type).toBe("feature"); // default
        (0, vitest_1.expect)(ticket.priority).toBe(2); // default
        (0, vitest_1.expect)(ticket.deps).toEqual([]); // default
    });
});
// --- parseDecompositionResponse ---
(0, vitest_1.describe)("parseDecompositionResponse", () => {
    (0, vitest_1.it)("parses sub-tickets from decomposition response", () => {
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
        const decomposition = (0, core_1.parseDecompositionResponse)(response, "cloud-storage");
        (0, vitest_1.expect)(decomposition.parentTicketId).toBe("cloud-storage");
        (0, vitest_1.expect)(decomposition.subTickets).toHaveLength(3);
        // All sub-tickets should have parent set
        for (const sub of decomposition.subTickets) {
            (0, vitest_1.expect)(sub.parent).toBe("cloud-storage");
        }
        (0, vitest_1.expect)(decomposition.subTickets[0].id).toBe("cloud-storage-types");
        (0, vitest_1.expect)(decomposition.subTickets[0].deps).toEqual([]);
        (0, vitest_1.expect)(decomposition.subTickets[1].id).toBe("cloud-r2-adapter");
        (0, vitest_1.expect)(decomposition.subTickets[1].deps).toEqual(["cloud-storage-types"]);
        (0, vitest_1.expect)(decomposition.subTickets[2].id).toBe("cloud-gcs-adapter");
        (0, vitest_1.expect)(decomposition.subTickets[2].deps).toEqual(["cloud-storage-types"]);
    });
    (0, vitest_1.it)("handles empty response", () => {
        const decomposition = (0, core_1.parseDecompositionResponse)("", "parent-ticket");
        (0, vitest_1.expect)(decomposition.parentTicketId).toBe("parent-ticket");
        (0, vitest_1.expect)(decomposition.subTickets).toEqual([]);
    });
    (0, vitest_1.it)("preserves explicit parent from response", () => {
        const response = `
### sub-a
- title: Sub A
- parent: explicit-parent
- deps: []
- description: Has explicit parent
`;
        const decomposition = (0, core_1.parseDecompositionResponse)(response, "cloud-storage");
        // Should keep explicit parent
        (0, vitest_1.expect)(decomposition.subTickets[0].parent).toBe("explicit-parent");
    });
});
// --- generatePlanningSession ---
(0, vitest_1.describe)("generatePlanningSession", () => {
    (0, vitest_1.it)("orchestrates prompt formatting and response parsing", async () => {
        const input = makePlanningInput();
        const mockLlm = async (prompt) => {
            (0, vitest_1.expect)(prompt).toContain("my-app");
            (0, vitest_1.expect)(prompt).toContain("Plan the next sprint");
            (0, vitest_1.expect)(prompt).toContain("add-auth");
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
        const proposal = await (0, core_1.generatePlanningSession)(input, mockLlm);
        (0, vitest_1.expect)(proposal.name).toBe("sprint-1");
        (0, vitest_1.expect)(proposal.scope.ticketIds).toEqual(["add-auth", "fix-tests", "add-dashboard"]);
        (0, vitest_1.expect)(proposal.ordering).toHaveLength(3);
    });
});
// --- generateDecomposition ---
(0, vitest_1.describe)("generateDecomposition", () => {
    (0, vitest_1.it)("orchestrates decomposition prompt and response parsing", async () => {
        const ticket = makeWorkItem({
            id: "cloud-storage",
            title: "Cloud storage adapters",
        });
        const mockLlm = async (prompt) => {
            (0, vitest_1.expect)(prompt).toContain("cloud-storage");
            (0, vitest_1.expect)(prompt).toContain("One ticket per provider");
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
        const decomposition = await (0, core_1.generateDecomposition)(ticket, undefined, [], mockLlm);
        (0, vitest_1.expect)(decomposition.parentTicketId).toBe("cloud-storage");
        (0, vitest_1.expect)(decomposition.subTickets).toHaveLength(2);
        (0, vitest_1.expect)(decomposition.subTickets[0].parent).toBe("cloud-storage");
        (0, vitest_1.expect)(decomposition.subTickets[1].parent).toBe("cloud-storage");
    });
});
//# sourceMappingURL=planning.test.js.map