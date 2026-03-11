import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Plan, DecompositionAssessment, WorkItem, ProjectConfig } from "@opcom/types";

// Mocks for @opcom/core
const mockGenerateDecomposition = vi.fn();
const mockWriteSubTickets = vi.fn();
const mockScanTickets = vi.fn();
const mockSavePlan = vi.fn();
const mockComputePlan = vi.fn();

vi.mock("@opcom/core", async () => {
  const actual = await vi.importActual<typeof import("@opcom/core")>("@opcom/core");
  return {
    ...actual,
    loadGlobalConfig: vi.fn().mockResolvedValue({ defaultWorkspace: "default" }),
    loadWorkspace: vi.fn().mockResolvedValue({ projectIds: ["proj-a"] }),
    loadProject: vi.fn().mockImplementation(async (id: string) => {
      if (id === "proj-a") {
        return {
          id: "proj-a",
          name: "Test Project",
          path: "/tmp/test-project",
          stack: {
            languages: [],
            frameworks: [],
            packageManagers: [],
            infrastructure: [],
            versionManagers: [],
          },
        };
      }
      return null;
    }),
    scanTickets: (...args: unknown[]) => mockScanTickets(...args),
    generateDecomposition: (...args: unknown[]) => mockGenerateDecomposition(...args),
    writeSubTickets: (...args: unknown[]) => mockWriteSubTickets(...args),
    savePlan: (...args: unknown[]) => mockSavePlan(...args),
    computePlan: (...args: unknown[]) => {
      mockComputePlan(...args);
      const ticketSets = args[0] as Array<{ tickets: Array<{ id: string; parent?: string }> }>;
      const allTickets = ticketSets.flatMap((ts) => ts.tickets);
      const steps = allTickets
        .filter((t) => !allTickets.some((c) => c.parent === t.id))
        .map((t) => ({
          ticketId: t.id,
          projectId: "proj-a",
          status: "ready",
          blockedBy: [],
        }));
      return {
        id: "new-plan",
        name: "Test Plan",
        status: "planning",
        scope: { projectIds: ["proj-a"] },
        steps,
        config: {
          maxConcurrentAgents: 3,
          backend: "claude-code",
          worktree: true,
          pauseOnFailure: true,
          ticketTransitions: true,
          autoCommit: true,
          verification: { runTests: true, runOracle: false },
          stall: { enabled: true, agentTimeoutMs: 1200000, planStallTimeoutMs: 1800000, maxIdenticalFailures: 2 },
        },
        context: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    assessTicketsForDecomposition: vi.fn().mockReturnValue([]),
    Station: { isRunning: vi.fn().mockResolvedValue({ running: false }) },
    SessionManager: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    })),
    EventStore: vi.fn().mockImplementation(() => ({})),
    refreshProjectStatus: vi.fn().mockResolvedValue({
      gitFresh: { branch: "main", remote: null, clean: true },
      workSummary: null,
    }),
  };
});

import { TuiClient } from "../../packages/cli/src/tui/client.js";
import { createAnthropicLlmCall } from "../../packages/cli/src/tui/llm.js";

describe("createAnthropicLlmCall", () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("returns null when ANTHROPIC_API_KEY is not set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = createAnthropicLlmCall();
    expect(result).toBeNull();
  });

  it("returns a function when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-123";
    const result = createAnthropicLlmCall();
    expect(result).toBeInstanceOf(Function);
  });
});

describe("TuiClient.decomposeAndRecreatePlan", () => {
  let client: TuiClient;

  const baseTickets: WorkItem[] = [
    {
      id: "cloud-r2-gcs",
      title: "Cloud R2 and GCS Storage Adapters",
      status: "open",
      priority: 2,
      type: "feature",
      filePath: "/tmp/test-project/.tickets/impl/cloud-r2-gcs/README.md",
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
      filePath: "/tmp/test-project/.tickets/impl/fix-button/README.md",
      deps: [],
      links: [],
      tags: {},
    },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    client = new TuiClient();
    await client.connect();

    // Seed the client with project config and tickets
    client.projectConfigs.set("proj-a", {
      id: "proj-a",
      name: "Test Project",
      path: "/tmp/test-project",
    } as ProjectConfig);
    client.projectTickets.set("proj-a", [...baseTickets]);
  });

  it("calls generateDecomposition for each assessment", async () => {
    const assessments: DecompositionAssessment[] = [
      {
        ticketId: "cloud-r2-gcs",
        needsDecomposition: true,
        reason: "Multiple providers",
        criteria: ["multiple-providers"],
      },
    ];

    mockGenerateDecomposition.mockResolvedValue({
      parentTicketId: "cloud-r2-gcs",
      reason: "Multiple providers",
      subTickets: [
        { id: "sub-r2", title: "R2 Adapter", type: "feature", priority: 2, deps: [], parent: "cloud-r2-gcs" },
      ],
    });
    mockWriteSubTickets.mockResolvedValue(["/tmp/test-project/.tickets/impl/cloud-r2-gcs/sub-r2.md"]);

    // After decomposition, rescan returns tickets with sub-tickets
    mockScanTickets.mockResolvedValue([
      ...baseTickets,
      {
        id: "sub-r2",
        title: "R2 Adapter",
        status: "open",
        priority: 2,
        type: "feature",
        filePath: "/tmp/test-project/.tickets/impl/cloud-r2-gcs/sub-r2.md",
        deps: [],
        links: [],
        tags: {},
        parent: "cloud-r2-gcs",
      },
    ]);

    const mockLlm = vi.fn(async () => "llm response");
    const newPlan = await client.decomposeAndRecreatePlan("proj-a", assessments, mockLlm);

    expect(mockGenerateDecomposition).toHaveBeenCalledTimes(1);
    expect(mockGenerateDecomposition.mock.calls[0][0].id).toBe("cloud-r2-gcs");
    expect(mockWriteSubTickets).toHaveBeenCalledTimes(1);
    expect(mockWriteSubTickets.mock.calls[0][0]).toBe("/tmp/test-project");
    expect(newPlan).not.toBeNull();
  });

  it("rescans tickets and recreates plan after decomposition", async () => {
    const assessments: DecompositionAssessment[] = [
      {
        ticketId: "cloud-r2-gcs",
        needsDecomposition: true,
        reason: "Multiple providers",
        criteria: ["multiple-providers"],
      },
    ];

    mockGenerateDecomposition.mockResolvedValue({
      parentTicketId: "cloud-r2-gcs",
      reason: "Multiple providers",
      subTickets: [
        { id: "sub-r2", title: "R2 Adapter", type: "feature", priority: 2, deps: [], parent: "cloud-r2-gcs" },
        { id: "sub-gcs", title: "GCS Adapter", type: "feature", priority: 2, deps: ["sub-r2"], parent: "cloud-r2-gcs" },
      ],
    });
    mockWriteSubTickets.mockResolvedValue([
      "/tmp/test-project/.tickets/impl/cloud-r2-gcs/sub-r2.md",
      "/tmp/test-project/.tickets/impl/cloud-r2-gcs/sub-gcs.md",
    ]);

    const freshTickets = [
      ...baseTickets,
      {
        id: "sub-r2",
        title: "R2 Adapter",
        status: "open",
        priority: 2,
        type: "feature",
        filePath: "/tmp/test-project/.tickets/impl/cloud-r2-gcs/sub-r2.md",
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
        filePath: "/tmp/test-project/.tickets/impl/cloud-r2-gcs/sub-gcs.md",
        deps: ["sub-r2"],
        links: [],
        tags: {},
        parent: "cloud-r2-gcs",
      },
    ];
    mockScanTickets.mockResolvedValue(freshTickets);

    const mockLlm = vi.fn(async () => "llm response");
    const newPlan = await client.decomposeAndRecreatePlan("proj-a", assessments, mockLlm);

    // Verify rescan happened
    expect(mockScanTickets).toHaveBeenCalledWith("/tmp/test-project");

    // Verify plan was recreated with fresh tickets
    expect(mockComputePlan).toHaveBeenCalled();
    const ticketSets = mockComputePlan.mock.calls[0][0];
    const allIds = ticketSets.flatMap((ts: { tickets: Array<{ id: string }> }) => ts.tickets.map((t) => t.id));
    expect(allIds).toContain("sub-r2");
    expect(allIds).toContain("sub-gcs");

    // Plan should include sub-tickets as steps, not the parent
    expect(newPlan).not.toBeNull();
    const stepIds = newPlan!.steps.map((s) => s.ticketId);
    expect(stepIds).toContain("sub-r2");
    expect(stepIds).toContain("sub-gcs");
    expect(stepIds).not.toContain("cloud-r2-gcs");

    // Plan saved
    expect(mockSavePlan).toHaveBeenCalled();
  });

  it("returns null when project tickets are not loaded", async () => {
    client.projectTickets.delete("proj-a");

    const result = await client.decomposeAndRecreatePlan(
      "proj-a",
      [{ ticketId: "x", needsDecomposition: true, reason: "test", criteria: [] }],
      vi.fn(async () => ""),
    );

    expect(result).toBeNull();
  });

  it("returns null for unknown project", async () => {
    const result = await client.decomposeAndRecreatePlan(
      "nonexistent",
      [{ ticketId: "x", needsDecomposition: true, reason: "test", criteria: [] }],
      vi.fn(async () => ""),
    );

    expect(result).toBeNull();
  });
});

// Import afterAll at top level
import { afterAll } from "vitest";
