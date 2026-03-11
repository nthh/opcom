import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockComputePlan = vi.fn();
const mockSavePlan = vi.fn();
const mockAssess = vi.fn();
const mockGenerateDecomposition = vi.fn();
const mockWriteSubTickets = vi.fn();

const baseTickets = [
  {
    id: "cloud-r2-gcs",
    title: "Cloud R2 and GCS Storage Adapters",
    status: "open",
    priority: 2,
    type: "feature",
    filePath: "/projects/a/.tickets/impl/cloud-r2-gcs/README.md",
    deps: [],
    links: [],
    tags: {},
  },
  {
    id: "fix-button",
    title: "Fix button color",
    status: "open",
    priority: 1,
    type: "bug",
    filePath: "/projects/a/.tickets/impl/fix-button/README.md",
    deps: [],
    links: [],
    tags: {},
  },
];

const parentWithChildren = [
  {
    id: "big-ticket",
    title: "R2 and GCS adapters",
    status: "open",
    priority: 2,
    type: "feature",
    filePath: "/projects/a/.tickets/impl/big-ticket/README.md",
    deps: [],
    links: [],
    tags: {},
  },
  {
    id: "sub-1",
    title: "R2 adapter",
    status: "open",
    priority: 2,
    type: "feature",
    filePath: "/projects/a/.tickets/impl/big-ticket/sub-1.md",
    deps: [],
    links: [],
    tags: {},
    parent: "big-ticket",
  },
  {
    id: "sub-2",
    title: "GCS adapter",
    status: "open",
    priority: 2,
    type: "feature",
    filePath: "/projects/a/.tickets/impl/big-ticket/sub-2.md",
    deps: ["sub-1"],
    links: [],
    tags: {},
    parent: "big-ticket",
  },
];

let scanTicketsFn = vi.fn(async () => baseTickets);

vi.mock("@opcom/core", () => ({
  loadGlobalConfig: vi.fn(async () => ({ defaultWorkspace: "ws" })),
  loadWorkspace: vi.fn(async () => ({ projectIds: ["proj-a"] })),
  loadProject: vi.fn(async () => ({ path: "/projects/a" })),
  scanTickets: (...args: unknown[]) => scanTicketsFn(...args),
  computePlan: (...args: unknown[]) => {
    mockComputePlan(...args);
    const ticketSets = args[0] as Array<{ tickets: Array<{ id: string; parent?: string }> }>;
    const allTickets = ticketSets.flatMap((ts) => ts.tickets);
    // Simulate real planner: exclude parent tickets
    const steps = allTickets
      .filter((t) => !allTickets.some((c) => c.parent === t.id))
      .map((t) => ({
        ticketId: t.id,
        projectId: "proj-a",
        status: "ready",
        blockedBy: [],
      }));
    return {
      id: "plan-1",
      name: "test-plan",
      status: "planning",
      scope: {},
      steps,
      config: {
        maxConcurrentAgents: 3,
        worktree: true,
        pauseOnFailure: true,
        verification: { runTests: true, runOracle: false },
      },
      context: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },
  resolveTeam: vi.fn(async () => null),
  resolveScope: vi.fn(),
  listPlans: vi.fn(async () => []),
  loadPlan: vi.fn(async () => null),
  savePlan: (...args: unknown[]) => mockSavePlan(...args),
  deletePlan: vi.fn(),
  checkHygiene: vi.fn(),
  assessTicketsForDecomposition: (...args: unknown[]) => mockAssess(...args),
  generateDecomposition: (...args: unknown[]) => mockGenerateDecomposition(...args),
  writeSubTickets: (...args: unknown[]) => mockWriteSubTickets(...args),
  defaultOrchestratorConfig: vi.fn(() => ({
    maxConcurrentAgents: 3,
    worktree: true,
    pauseOnFailure: true,
    ticketTransitions: true,
    autoCommit: true,
    verification: { runTests: true, runOracle: false },
  })),
  Executor: vi.fn(),
  SessionManager: vi.fn().mockImplementation(() => ({ init: vi.fn() })),
  EventStore: vi.fn(),
}));

vi.mock("../../packages/cli/src/tui/views/plan-overview.js", () => ({
  computePlanSummary: vi.fn(() => ({
    totalSteps: 0,
    readyCount: 0,
    blockedCount: 0,
    tracks: [],
    criticalPathLength: 0,
    criticalPath: [],
    config: {
      maxConcurrentAgents: 3,
      backend: "claude-code",
      worktree: true,
      autoCommit: true,
      pauseOnFailure: true,
      verification: { runTests: true, runOracle: false },
    },
  })),
}));

import { runPlanCreate } from "../../packages/cli/src/commands/plan.js";

describe("plan create decomposition assessment", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    scanTicketsFn = vi.fn(async () => baseTickets);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("warns about oversized tickets before creating plan", async () => {
    mockAssess.mockReturnValue([
      {
        ticketId: "cloud-r2-gcs",
        needsDecomposition: true,
        reason: "Matches decomposition criteria: multiple-providers",
        criteria: ["multiple-providers"],
      },
      {
        ticketId: "fix-button",
        needsDecomposition: false,
        reason: "Ticket appears agent-sized",
        criteria: [],
      },
    ]);

    await runPlanCreate({
      name: "test",
      promptFn: async () => "s", // skip
    });

    // Should display the warning
    const logCalls = consoleSpy.mock.calls.map((c) => c.join(" "));
    expect(logCalls.some((l) => l.includes("1 oversized ticket(s)"))).toBe(true);
    expect(logCalls.some((l) => l.includes("cloud-r2-gcs") && l.includes("multiple-providers"))).toBe(true);

    // Plan should still be created (user chose skip)
    expect(mockSavePlan).toHaveBeenCalled();
  });

  it("interactive prompt: skip preserves original ticket unchanged", async () => {
    mockAssess.mockReturnValue([
      {
        ticketId: "cloud-r2-gcs",
        needsDecomposition: true,
        reason: "Matches criteria: multiple-providers",
        criteria: ["multiple-providers"],
      },
    ]);

    await runPlanCreate({
      name: "test",
      promptFn: async () => "s",
    });

    // No decomposition should happen
    expect(mockGenerateDecomposition).not.toHaveBeenCalled();
    expect(mockWriteSubTickets).not.toHaveBeenCalled();

    // Plan created with original tickets
    expect(mockSavePlan).toHaveBeenCalled();
    expect(mockComputePlan).toHaveBeenCalledTimes(1);
  });

  it("interactive prompt: abort cancels plan creation", async () => {
    mockAssess.mockReturnValue([
      {
        ticketId: "cloud-r2-gcs",
        needsDecomposition: true,
        reason: "Too large",
        criteria: ["multiple-providers"],
      },
    ]);

    await runPlanCreate({
      name: "test",
      promptFn: async () => "a",
    });

    // Should not create plan
    expect(mockSavePlan).not.toHaveBeenCalled();
    expect(consoleSpy.mock.calls.some((c) => c.join(" ").includes("Aborted"))).toBe(true);
  });

  it("--decompose flag auto-decomposes without prompting", async () => {
    mockAssess.mockReturnValue([
      {
        ticketId: "cloud-r2-gcs",
        needsDecomposition: true,
        reason: "Multiple providers",
        criteria: ["multiple-providers"],
      },
    ]);

    const mockLlm = vi.fn(async () => `
### cloud-r2-adapter
- title: R2 Storage Adapter
- type: feature
- priority: 2
- deps: []
- parent: cloud-r2-gcs
- description: Implement R2 adapter

### cloud-gcs-adapter
- title: GCS Storage Adapter
- type: feature
- priority: 2
- deps: []
- parent: cloud-r2-gcs
- description: Implement GCS adapter
`);

    mockGenerateDecomposition.mockResolvedValue({
      parentTicketId: "cloud-r2-gcs",
      reason: "Multiple providers",
      subTickets: [
        { id: "cloud-r2-adapter", title: "R2 Storage Adapter", type: "feature", priority: 2, deps: [], parent: "cloud-r2-gcs" },
        { id: "cloud-gcs-adapter", title: "GCS Storage Adapter", type: "feature", priority: 2, deps: [], parent: "cloud-r2-gcs" },
      ],
    });

    mockWriteSubTickets.mockResolvedValue([
      "/projects/a/.tickets/impl/cloud-r2-gcs/cloud-r2-adapter.md",
      "/projects/a/.tickets/impl/cloud-r2-gcs/cloud-gcs-adapter.md",
    ]);

    // After decomposition, rescan returns parent + children
    let scanCount = 0;
    scanTicketsFn = vi.fn(async () => {
      scanCount++;
      if (scanCount > 1) {
        // Rescan picks up new sub-tickets
        return [
          ...baseTickets,
          {
            id: "cloud-r2-adapter",
            title: "R2 Storage Adapter",
            status: "open",
            priority: 2,
            type: "feature",
            filePath: "/projects/a/.tickets/impl/cloud-r2-gcs/cloud-r2-adapter.md",
            deps: [],
            links: [],
            tags: {},
            parent: "cloud-r2-gcs",
          },
          {
            id: "cloud-gcs-adapter",
            title: "GCS Storage Adapter",
            status: "open",
            priority: 2,
            type: "feature",
            filePath: "/projects/a/.tickets/impl/cloud-r2-gcs/cloud-gcs-adapter.md",
            deps: [],
            links: [],
            tags: {},
            parent: "cloud-r2-gcs",
          },
        ];
      }
      return baseTickets;
    });

    await runPlanCreate({
      name: "test",
      decompose: true,
      llmCall: mockLlm,
    });

    // Should not prompt — auto-decompose
    // generateDecomposition should be called
    expect(mockGenerateDecomposition).toHaveBeenCalledTimes(1);
    expect(mockWriteSubTickets).toHaveBeenCalledTimes(1);

    // Plan should be created after rescan
    expect(mockSavePlan).toHaveBeenCalled();

    // Ticket sets should have been rebuilt (rescan triggered)
    expect(scanTicketsFn).toHaveBeenCalledTimes(2);
  });

  it("--no-decompose flag skips assessment entirely", async () => {
    await runPlanCreate({
      name: "test",
      decompose: false,
    });

    // Assessment should NOT be called
    expect(mockAssess).not.toHaveBeenCalled();

    // Plan created normally
    expect(mockSavePlan).toHaveBeenCalled();
  });

  it("already-decomposed tickets with sub-ticket files are not flagged", async () => {
    scanTicketsFn = vi.fn(async () => parentWithChildren);

    // assessTicketsForDecomposition returns not-needed for parent (has children)
    mockAssess.mockReturnValue([
      {
        ticketId: "big-ticket",
        needsDecomposition: false,
        reason: "Already has sub-tickets",
        criteria: [],
      },
      {
        ticketId: "sub-1",
        needsDecomposition: false,
        reason: "Ticket appears agent-sized",
        criteria: [],
      },
      {
        ticketId: "sub-2",
        needsDecomposition: false,
        reason: "Ticket appears agent-sized",
        criteria: [],
      },
    ]);

    await runPlanCreate({ name: "test" });

    // No oversized warnings
    const logCalls = consoleSpy.mock.calls.map((c) => c.join(" "));
    expect(logCalls.some((l) => l.includes("oversized"))).toBe(false);

    // Plan created with sub-tickets (parent excluded by planner)
    expect(mockSavePlan).toHaveBeenCalled();
  });

  it("decompose action creates sub-ticket files on disk", async () => {
    mockAssess.mockReturnValue([
      {
        ticketId: "cloud-r2-gcs",
        needsDecomposition: true,
        reason: "Multiple providers",
        criteria: ["multiple-providers"],
      },
    ]);

    mockGenerateDecomposition.mockResolvedValue({
      parentTicketId: "cloud-r2-gcs",
      reason: "Multiple providers",
      subTickets: [
        { id: "sub-a", title: "Sub A", type: "feature", priority: 2, deps: [], parent: "cloud-r2-gcs" },
      ],
    });

    mockWriteSubTickets.mockResolvedValue(["/projects/a/.tickets/impl/cloud-r2-gcs/sub-a.md"]);

    const mockLlm = vi.fn(async () => "decomposition response");

    await runPlanCreate({
      name: "test",
      promptFn: async () => "d",
      llmCall: mockLlm,
    });

    // writeSubTickets should be called with the project path and decomposition result
    expect(mockWriteSubTickets).toHaveBeenCalledTimes(1);
    expect(mockWriteSubTickets.mock.calls[0][0]).toBe("/projects/a");

    // Log should mention created sub-tickets
    const logCalls = consoleSpy.mock.calls.map((c) => c.join(" "));
    expect(logCalls.some((l) => l.includes("Created 1 sub-ticket"))).toBe(true);
  });

  it("no assessment shown when no tickets need decomposition", async () => {
    mockAssess.mockReturnValue([
      {
        ticketId: "cloud-r2-gcs",
        needsDecomposition: false,
        reason: "Ticket appears agent-sized",
        criteria: [],
      },
      {
        ticketId: "fix-button",
        needsDecomposition: false,
        reason: "Ticket appears agent-sized",
        criteria: [],
      },
    ]);

    await runPlanCreate({ name: "test" });

    // No decomposition warnings
    const logCalls = consoleSpy.mock.calls.map((c) => c.join(" "));
    expect(logCalls.some((l) => l.includes("oversized"))).toBe(false);
    expect(logCalls.some((l) => l.includes("Decomposition"))).toBe(false);

    // Plan created normally
    expect(mockSavePlan).toHaveBeenCalled();
  });

  it("decompose without llmCall shows error and skips", async () => {
    mockAssess.mockReturnValue([
      {
        ticketId: "cloud-r2-gcs",
        needsDecomposition: true,
        reason: "Multiple providers",
        criteria: ["multiple-providers"],
      },
    ]);

    await runPlanCreate({
      name: "test",
      decompose: true,
      // No llmCall provided
    });

    const errorCalls = consoleErrorSpy.mock.calls.map((c) => c.join(" "));
    expect(errorCalls.some((l) => l.includes("LLM backend"))).toBe(true);

    // Plan should still be created (falls back to skip)
    expect(mockSavePlan).toHaveBeenCalled();
  });

  it("sub-tickets created by decomposition appear in the resulting plan", async () => {
    mockAssess.mockReturnValue([
      {
        ticketId: "cloud-r2-gcs",
        needsDecomposition: true,
        reason: "Multiple providers",
        criteria: ["multiple-providers"],
      },
    ]);

    mockGenerateDecomposition.mockResolvedValue({
      parentTicketId: "cloud-r2-gcs",
      reason: "Multiple providers",
      subTickets: [
        { id: "sub-r2", title: "R2 Adapter", type: "feature", priority: 2, deps: [], parent: "cloud-r2-gcs" },
        { id: "sub-gcs", title: "GCS Adapter", type: "feature", priority: 2, deps: ["sub-r2"], parent: "cloud-r2-gcs" },
      ],
    });

    mockWriteSubTickets.mockResolvedValue([
      "/projects/a/.tickets/impl/cloud-r2-gcs/sub-r2.md",
      "/projects/a/.tickets/impl/cloud-r2-gcs/sub-gcs.md",
    ]);

    // After rescan, return tickets with children
    let scanCount = 0;
    scanTicketsFn = vi.fn(async () => {
      scanCount++;
      if (scanCount > 1) {
        return [
          { ...baseTickets[0] }, // cloud-r2-gcs (now parent)
          baseTickets[1], // fix-button
          {
            id: "sub-r2",
            title: "R2 Adapter",
            status: "open",
            priority: 2,
            type: "feature",
            filePath: "/projects/a/.tickets/impl/cloud-r2-gcs/sub-r2.md",
            deps: [],
            links: [],
            tags: {},
            parent: "cloud-r2-gcs",
          },
          {
            id: "sub-gcs",
            title: "GCS Adapter",
            status: "open",
            priority: 2,
            type: "feature",
            filePath: "/projects/a/.tickets/impl/cloud-r2-gcs/sub-gcs.md",
            deps: ["sub-r2"],
            links: [],
            tags: {},
            parent: "cloud-r2-gcs",
          },
        ];
      }
      return baseTickets;
    });

    await runPlanCreate({
      name: "test",
      decompose: true,
      llmCall: vi.fn(async () => "response"),
    });

    // computePlan should be called with the rescanned tickets (including sub-tickets)
    expect(mockComputePlan).toHaveBeenCalled();
    const ticketSets = mockComputePlan.mock.calls[0][0] as Array<{ tickets: Array<{ id: string }> }>;
    const allIds = ticketSets.flatMap((ts) => ts.tickets.map((t) => t.id));
    expect(allIds).toContain("sub-r2");
    expect(allIds).toContain("sub-gcs");

    // The plan (from our mock computePlan) should have sub-tickets as steps
    // and parent excluded (our mock does this)
    const savedPlan = mockSavePlan.mock.calls[0][0];
    const stepIds = savedPlan.steps.map((s: { ticketId: string }) => s.ticketId);
    expect(stepIds).toContain("sub-r2");
    expect(stepIds).toContain("sub-gcs");
    expect(stepIds).not.toContain("cloud-r2-gcs"); // parent excluded
  });
});
