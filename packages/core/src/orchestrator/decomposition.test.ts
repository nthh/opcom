import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ProposedTicket,
  TicketDecomposition,
  WorkItem,
  Plan,
} from "@opcom/types";
import {
  writeSubTicket,
  writeSubTickets,
  formatTicketFile,
  assessTicketsForDecomposition,
  applyDecomposition,
  hasChildren,
  getChildTicketIds,
  isParentComplete,
} from "./decomposition.js";

// --- Helpers ---

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "test-ticket",
    title: "Test Ticket",
    status: "open",
    priority: 2,
    type: "feature",
    filePath: "/tmp/test/.tickets/impl/test-ticket/README.md",
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

function makeProposedTicket(overrides: Partial<ProposedTicket> = {}): ProposedTicket {
  return {
    id: "sub-ticket-1",
    title: "Sub Ticket 1",
    type: "feature",
    priority: 2,
    deps: [],
    description: "A sub-ticket",
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "test-plan",
    name: "Test Plan",
    status: "planning",
    scope: {},
    steps: [],
    config: {
      maxConcurrentAgents: 3,
      autoStart: false,
      backend: "claude-code",
      worktree: true,
      pauseOnFailure: true,
      ticketTransitions: true,
      autoCommit: true,
      verification: { runTests: true, runOracle: false },
      stall: { enabled: true, agentTimeoutMs: 1200000, planStallTimeoutMs: 1800000, maxIdenticalFailures: 2 },
    },
    context: "",
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

// --- Tests ---

describe("formatTicketFile", () => {
  it("formats a ticket with all fields", () => {
    const ticket = makeProposedTicket({
      id: "cloud-types",
      title: "Cloud Service Types",
      type: "feature",
      priority: 1,
      deps: ["base-types", "core-utils"],
      parent: "cloud-services",
      description: "Define TypeScript types for cloud services.",
    });

    const content = formatTicketFile(ticket);

    expect(content).toContain("---");
    expect(content).toContain("id: cloud-types");
    expect(content).toContain('title: "Cloud Service Types"');
    expect(content).toContain("status: open");
    expect(content).toContain("type: feature");
    expect(content).toContain("priority: 1");
    expect(content).toContain("milestone: cloud-services");
    expect(content).toContain("deps:");
    expect(content).toContain("  - base-types");
    expect(content).toContain("  - core-utils");
    expect(content).toContain("# Cloud Service Types");
    expect(content).toContain("Define TypeScript types for cloud services.");
  });

  it("formats a ticket with no deps", () => {
    const ticket = makeProposedTicket({
      id: "standalone",
      title: "Standalone Task",
      deps: [],
    });

    const content = formatTicketFile(ticket);
    expect(content).toContain("deps: []");
  });

  it("formats a ticket with no parent", () => {
    const ticket = makeProposedTicket({
      id: "no-parent",
      title: "No Parent",
      parent: undefined,
    });

    const content = formatTicketFile(ticket);
    expect(content).not.toContain("milestone:");
  });

  it("escapes quotes in title", () => {
    const ticket = makeProposedTicket({
      title: 'A "quoted" title',
    });

    const content = formatTicketFile(ticket);
    expect(content).toContain('title: "A \\"quoted\\" title"');
  });
});

describe("writeSubTicket", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes sub-ticket as sibling file in parent directory", async () => {
    const ticket = makeProposedTicket({
      id: "cloud-r2-adapter",
      title: "R2 Storage Adapter",
      parent: "cloud-storage",
      deps: ["cloud-types"],
      description: "Implement R2 adapter.",
    });

    const filePath = await writeSubTicket(tempDir, ticket);

    // Should be a sibling .md file in parent's directory
    expect(filePath).toBe(join(tempDir, ".tickets", "impl", "cloud-storage", "cloud-r2-adapter.md"));

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("id: cloud-r2-adapter");
    expect(content).toContain('title: "R2 Storage Adapter"');
    expect(content).toContain("milestone: cloud-storage");
    expect(content).toContain("  - cloud-types");
  });

  it("creates own directory for top-level ticket (no parent)", async () => {
    const ticket = makeProposedTicket({ id: "top-level-ticket" });
    await writeSubTicket(tempDir, ticket);

    const dirStat = await stat(join(tempDir, ".tickets", "impl", "top-level-ticket"));
    expect(dirStat.isDirectory()).toBe(true);

    const filePath = join(tempDir, ".tickets", "impl", "top-level-ticket", "README.md");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("id: top-level-ticket");
  });
});

describe("writeSubTickets", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes multiple sub-tickets as sibling files in parent directory", async () => {
    const decomposition: TicketDecomposition = {
      parentTicketId: "cloud-serverless",
      reason: "Multiple providers",
      subTickets: [
        makeProposedTicket({
          id: "cloud-serverless-types",
          title: "Serverless Types",
          deps: [],
          parent: "cloud-serverless",
        }),
        makeProposedTicket({
          id: "cloud-serverless-cf",
          title: "Cloudflare Workers Adapter",
          deps: ["cloud-serverless-types"],
          parent: "cloud-serverless",
        }),
        makeProposedTicket({
          id: "cloud-serverless-firebase",
          title: "Firebase Functions Adapter",
          deps: ["cloud-serverless-types"],
          parent: "cloud-serverless",
        }),
      ],
    };

    const paths = await writeSubTickets(tempDir, decomposition);

    expect(paths).toHaveLength(3);

    // All files should be in the parent's directory
    const parentDir = join(tempDir, ".tickets", "impl", "cloud-serverless");
    expect(paths[0]).toBe(join(parentDir, "cloud-serverless-types.md"));
    expect(paths[1]).toBe(join(parentDir, "cloud-serverless-cf.md"));
    expect(paths[2]).toBe(join(parentDir, "cloud-serverless-firebase.md"));

    // Verify each file exists and has correct content
    for (const path of paths) {
      const content = await readFile(path, "utf-8");
      expect(content).toContain("milestone: cloud-serverless");
    }

    // Check specific files
    const typesContent = await readFile(paths[0], "utf-8");
    expect(typesContent).toContain("id: cloud-serverless-types");
    expect(typesContent).toContain("deps: []");

    const cfContent = await readFile(paths[1], "utf-8");
    expect(cfContent).toContain("id: cloud-serverless-cf");
    expect(cfContent).toContain("  - cloud-serverless-types");
  });

  it("sets parent on sub-tickets that are missing it and writes as siblings", async () => {
    const decomposition: TicketDecomposition = {
      parentTicketId: "big-ticket",
      reason: "Too large",
      subTickets: [
        makeProposedTicket({ id: "sub-a", parent: undefined }),
        makeProposedTicket({ id: "sub-b", parent: undefined }),
      ],
    };

    const paths = await writeSubTickets(tempDir, decomposition);

    // Parent was set by writeSubTickets, so files go in parent's directory
    const parentDir = join(tempDir, ".tickets", "impl", "big-ticket");
    expect(paths[0]).toBe(join(parentDir, "sub-a.md"));
    expect(paths[1]).toBe(join(parentDir, "sub-b.md"));

    const contentA = await readFile(paths[0], "utf-8");
    expect(contentA).toContain("milestone: big-ticket");

    const contentB = await readFile(paths[1], "utf-8");
    expect(contentB).toContain("milestone: big-ticket");
  });
});

describe("assessTicketsForDecomposition", () => {
  it("flags tickets with multiple providers", () => {
    const tickets = [
      makeWorkItem({
        id: "cloud-adapters",
        title: "Cloud R2 and GCS Storage Adapters",
      }),
    ];

    const assessments = assessTicketsForDecomposition(tickets);

    expect(assessments).toHaveLength(1);
    expect(assessments[0].needsDecomposition).toBe(true);
    expect(assessments[0].criteria).toContain("multiple-providers");
  });

  it("skips closed/deferred tickets", () => {
    const tickets = [
      makeWorkItem({ id: "closed-one", status: "closed", title: "R2 GCS Adapters" }),
      makeWorkItem({ id: "deferred-one", status: "deferred", title: "S3 R2 Adapters" }),
      makeWorkItem({ id: "open-one", title: "Simple task" }),
    ];

    const assessments = assessTicketsForDecomposition(tickets);

    expect(assessments).toHaveLength(1);
    expect(assessments[0].ticketId).toBe("open-one");
  });

  it("flags tickets with complex spec", () => {
    const tickets = [makeWorkItem({ id: "big-spec" })];
    const specContents = new Map([
      ["big-spec", "x\n".repeat(250)],
    ]);

    const assessments = assessTicketsForDecomposition(tickets, specContents);

    expect(assessments[0].needsDecomposition).toBe(true);
    expect(assessments[0].criteria).toContain("complex-spec");
  });

  it("skips tickets that already have children", () => {
    const tickets = [
      makeWorkItem({ id: "parent-ticket", title: "R2 GCS Storage Adapters" }),
      makeWorkItem({ id: "child-ticket", parent: "parent-ticket" }),
    ];

    const assessments = assessTicketsForDecomposition(tickets);

    const parentAssessment = assessments.find((a) => a.ticketId === "parent-ticket");
    expect(parentAssessment?.needsDecomposition).toBe(false);
  });

  it("marks agent-sized tickets as not needing decomposition", () => {
    const tickets = [
      makeWorkItem({ id: "small-task", title: "Fix button color" }),
    ];

    const assessments = assessTicketsForDecomposition(tickets);

    expect(assessments[0].needsDecomposition).toBe(false);
    expect(assessments[0].reason).toContain("agent-sized");
  });
});

describe("hasChildren", () => {
  it("returns true when ticket has children", () => {
    const tickets = [
      makeWorkItem({ id: "parent" }),
      makeWorkItem({ id: "child-1", parent: "parent" }),
      makeWorkItem({ id: "child-2", parent: "parent" }),
    ];

    expect(hasChildren("parent", tickets)).toBe(true);
  });

  it("returns false when ticket has no children", () => {
    const tickets = [
      makeWorkItem({ id: "standalone" }),
      makeWorkItem({ id: "other" }),
    ];

    expect(hasChildren("standalone", tickets)).toBe(false);
  });
});

describe("getChildTicketIds", () => {
  it("returns child IDs for a parent", () => {
    const tickets = [
      makeWorkItem({ id: "parent" }),
      makeWorkItem({ id: "child-1", parent: "parent" }),
      makeWorkItem({ id: "child-2", parent: "parent" }),
      makeWorkItem({ id: "unrelated" }),
    ];

    const children = getChildTicketIds("parent", tickets);
    expect(children).toEqual(["child-1", "child-2"]);
  });

  it("returns empty array when no children", () => {
    const tickets = [makeWorkItem({ id: "alone" })];
    expect(getChildTicketIds("alone", tickets)).toEqual([]);
  });
});

describe("isParentComplete", () => {
  it("returns true when all children are closed", () => {
    const tickets = [
      makeWorkItem({ id: "parent" }),
      makeWorkItem({ id: "child-1", parent: "parent", status: "closed" }),
      makeWorkItem({ id: "child-2", parent: "parent", status: "closed" }),
    ];

    expect(isParentComplete("parent", tickets)).toBe(true);
  });

  it("returns false when some children are open", () => {
    const tickets = [
      makeWorkItem({ id: "parent" }),
      makeWorkItem({ id: "child-1", parent: "parent", status: "closed" }),
      makeWorkItem({ id: "child-2", parent: "parent", status: "open" }),
    ];

    expect(isParentComplete("parent", tickets)).toBe(false);
  });

  it("returns false when ticket has no children", () => {
    const tickets = [makeWorkItem({ id: "no-kids" })];
    expect(isParentComplete("no-kids", tickets)).toBe(false);
  });
});

describe("applyDecomposition", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes sub-tickets and recomputes plan", async () => {
    const parentTicket = makeWorkItem({
      id: "cloud-serverless",
      title: "Cloud Serverless Adapters",
    });

    const plan = makePlan({
      scope: { ticketIds: ["cloud-serverless"] },
      steps: [
        {
          ticketId: "cloud-serverless",
          projectId: "opcom",
          status: "ready",
          blockedBy: [],
        },
      ],
    });

    const ticketSets = [
      {
        projectId: "opcom",
        tickets: [parentTicket],
      },
    ];

    const decomposition: TicketDecomposition = {
      parentTicketId: "cloud-serverless",
      reason: "Multiple providers",
      subTickets: [
        makeProposedTicket({
          id: "serverless-types",
          title: "Serverless Types",
          deps: [],
          parent: "cloud-serverless",
        }),
        makeProposedTicket({
          id: "serverless-cf",
          title: "CF Workers Adapter",
          deps: ["serverless-types"],
          parent: "cloud-serverless",
        }),
      ],
    };

    const result = await applyDecomposition(plan, decomposition, tempDir, ticketSets);

    // Sub-ticket files were created
    expect(result.createdPaths).toHaveLength(2);
    for (const path of result.createdPaths) {
      const content = await readFile(path, "utf-8");
      expect(content).toContain("milestone: cloud-serverless");
    }

    // Plan was recomputed with sub-tickets as steps
    // Parent should be excluded (has children), sub-tickets are the steps
    const stepIds = result.plan.steps.map((s) => s.ticketId);
    expect(stepIds).toContain("serverless-types");
    expect(stepIds).toContain("serverless-cf");
    expect(stepIds).not.toContain("cloud-serverless");

    // serverless-cf should be blocked by serverless-types
    const cfStep = result.plan.steps.find((s) => s.ticketId === "serverless-cf");
    expect(cfStep?.blockedBy).toContain("serverless-types");
    expect(cfStep?.status).toBe("blocked");

    // serverless-types should be ready
    const typesStep = result.plan.steps.find((s) => s.ticketId === "serverless-types");
    expect(typesStep?.status).toBe("ready");
  });

  it("preserves plan metadata after decomposition", async () => {
    const plan = makePlan({
      id: "my-plan-id",
      name: "My Plan",
      status: "planning",
      context: "Some accumulated context",
      createdAt: "2026-01-01T00:00:00Z",
    });

    const ticketSets = [
      {
        projectId: "proj",
        tickets: [makeWorkItem({ id: "big-ticket" })],
      },
    ];

    const decomposition: TicketDecomposition = {
      parentTicketId: "big-ticket",
      reason: "Too large",
      subTickets: [
        makeProposedTicket({ id: "sub-1", parent: "big-ticket" }),
      ],
    };

    const result = await applyDecomposition(plan, decomposition, tempDir, ticketSets);

    expect(result.plan.id).toBe("my-plan-id");
    expect(result.plan.name).toBe("My Plan");
    expect(result.plan.status).toBe("planning");
    expect(result.plan.context).toBe("Some accumulated context");
    expect(result.plan.createdAt).toBe("2026-01-01T00:00:00Z");
  });
});
