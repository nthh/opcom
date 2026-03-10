import { describe, it, expect } from "vitest";
import { applyStrategy, extractSubtasks, expandSubtaskSteps, computeDepthStages, computePlan, recomputePlan } from "../../packages/core/src/orchestrator/planner.js";
import type { PlanStep, WorkItem, Subtask } from "@opcom/types";

function makeStep(ticketId: string, track: string, blockedBy: string[] = []): PlanStep {
  return {
    ticketId,
    projectId: "proj",
    status: blockedBy.length > 0 ? "blocked" : "ready",
    track,
    blockedBy,
  };
}

function makeWorkItem(id: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    title: id,
    status: "open",
    priority: 2,
    type: "feature",
    filePath: `/tickets/${id}/README.md`,
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

describe("applyStrategy", () => {
  // Steps sorted by priority: track-a has two steps, track-b has one, track-c has two
  const steps: PlanStep[] = [
    makeStep("a1", "track-a"),   // highest priority
    makeStep("b1", "track-b"),
    makeStep("c1", "track-c"),
    makeStep("a2", "track-a"),
    makeStep("c2", "track-c"),
  ];

  describe("mixed (default)", () => {
    it("returns steps in original priority order", () => {
      const result = applyStrategy(steps, "mixed");
      expect(result.map((s) => s.ticketId)).toEqual(["a1", "b1", "c1", "a2", "c2"]);
    });

    it("returns steps unchanged when strategy is undefined", () => {
      const result = applyStrategy(steps, undefined);
      expect(result.map((s) => s.ticketId)).toEqual(["a1", "b1", "c1", "a2", "c2"]);
    });
  });

  describe("spread", () => {
    it("round-robins across tracks", () => {
      const result = applyStrategy(steps, "spread");
      // Round 1: a1 (track-a), b1 (track-b), c1 (track-c)
      // Round 2: a2 (track-a), c2 (track-c)
      expect(result.map((s) => s.ticketId)).toEqual(["a1", "b1", "c1", "a2", "c2"]);
    });

    it("interleaves tracks when one track dominates priority", () => {
      // All high-priority steps are in track-a
      const dominated: PlanStep[] = [
        makeStep("a1", "track-a"),
        makeStep("a2", "track-a"),
        makeStep("a3", "track-a"),
        makeStep("b1", "track-b"),
        makeStep("c1", "track-c"),
      ];
      const result = applyStrategy(dominated, "spread");
      // Round 1: a1, b1, c1 (one per track)
      // Round 2: a2 (only track-a has more)
      // Round 3: a3
      expect(result.map((s) => s.ticketId)).toEqual(["a1", "b1", "c1", "a2", "a3"]);
    });
  });

  describe("swarm", () => {
    it("groups all steps from highest-priority track first", () => {
      const result = applyStrategy(steps, "swarm");
      // track-a steps first (a1, a2), then track-b (b1), then track-c (c1, c2)
      expect(result.map((s) => s.ticketId)).toEqual(["a1", "a2", "b1", "c1", "c2"]);
    });

    it("focuses on dominant track completely before moving on", () => {
      const dominated: PlanStep[] = [
        makeStep("a1", "track-a"),
        makeStep("b1", "track-b"),
        makeStep("b2", "track-b"),
        makeStep("b3", "track-b"),
        makeStep("a2", "track-a"),
      ];
      const result = applyStrategy(dominated, "swarm");
      // track-a first (a1 has highest priority), then track-b
      expect(result.map((s) => s.ticketId)).toEqual(["a1", "a2", "b1", "b2", "b3"]);
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty input", () => {
      expect(applyStrategy([], "spread")).toEqual([]);
      expect(applyStrategy([], "swarm")).toEqual([]);
      expect(applyStrategy([], "mixed")).toEqual([]);
    });

    it("returns single step unchanged", () => {
      const single = [makeStep("x", "track-x")];
      expect(applyStrategy(single, "spread")).toEqual(single);
      expect(applyStrategy(single, "swarm")).toEqual(single);
    });

    it("uses ticketId as fallback track when track is undefined", () => {
      const noTracks: PlanStep[] = [
        { ...makeStep("a", ""), track: undefined },
        { ...makeStep("b", ""), track: undefined },
      ];
      // Each step gets its own "track" (ticketId), so spread still works
      const result = applyStrategy(noTracks, "spread");
      expect(result).toHaveLength(2);
    });

    it("all steps in same track — spread and swarm produce same result", () => {
      const sameTrack: PlanStep[] = [
        makeStep("s1", "only-track"),
        makeStep("s2", "only-track"),
        makeStep("s3", "only-track"),
      ];
      const spread = applyStrategy(sameTrack, "spread");
      const swarm = applyStrategy(sameTrack, "swarm");
      expect(spread.map((s) => s.ticketId)).toEqual(["s1", "s2", "s3"]);
      expect(swarm.map((s) => s.ticketId)).toEqual(["s1", "s2", "s3"]);
    });
  });
});

describe("extractSubtasks", () => {
  it("parses task lines with parallel marker", () => {
    const body = `## Tasks\n- [ ] Set up database (parallel)\n- [ ] Build API (parallel)`;
    const subtasks = extractSubtasks(body);
    expect(subtasks).toHaveLength(2);
    expect(subtasks[0]).toEqual({
      id: "set-up-database",
      title: "Set up database",
      parallel: true,
      deps: [],
    });
    expect(subtasks[1]).toEqual({
      id: "build-api",
      title: "Build API",
      parallel: true,
      deps: [],
    });
  });

  it("parses task lines with deps marker", () => {
    const body = `- [ ] First task (parallel)\n- [ ] Second task (deps: first-task)`;
    const subtasks = extractSubtasks(body);
    expect(subtasks).toHaveLength(2);
    expect(subtasks[0].deps).toEqual([]);
    expect(subtasks[1].deps).toEqual(["first-task"]);
    expect(subtasks[1].parallel).toBe(false);
  });

  it("defaults to parallel — no marker means no deps", () => {
    const body = `- [ ] Step one\n- [ ] Step two\n- [ ] Step three`;
    const subtasks = extractSubtasks(body);
    expect(subtasks).toHaveLength(3);
    expect(subtasks[0].deps).toEqual([]);
    expect(subtasks[1].deps).toEqual([]);
    expect(subtasks[2].deps).toEqual([]);
    expect(subtasks[0].parallel).toBe(true);
    expect(subtasks[1].parallel).toBe(true);
    expect(subtasks[2].parallel).toBe(true);
  });

  it("applies sequential marker — depends on previous", () => {
    const body = `- [ ] Step one\n- [ ] Step two (sequential)\n- [ ] Step three (sequential)`;
    const subtasks = extractSubtasks(body);
    expect(subtasks).toHaveLength(3);
    expect(subtasks[0].deps).toEqual([]); // first has no deps
    expect(subtasks[1].deps).toEqual(["step-one"]); // depends on previous
    expect(subtasks[2].deps).toEqual(["step-two"]); // depends on previous
    expect(subtasks[1].parallel).toBe(false);
  });

  it("handles mixed parallel and sequential tasks", () => {
    const body = [
      "- [ ] Setup infra",
      "- [ ] Setup database",
      "- [ ] Build API (deps: setup-infra, setup-database)",
      "- [ ] Write tests (deps: build-api)",
    ].join("\n");
    const subtasks = extractSubtasks(body);
    expect(subtasks).toHaveLength(4);
    expect(subtasks[0]).toMatchObject({ id: "setup-infra", parallel: true, deps: [] });
    expect(subtasks[1]).toMatchObject({ id: "setup-database", parallel: true, deps: [] });
    expect(subtasks[2]).toMatchObject({ id: "build-api", parallel: false, deps: ["setup-infra", "setup-database"] });
    expect(subtasks[3]).toMatchObject({ id: "write-tests", parallel: false, deps: ["build-api"] });
  });

  it("returns empty array for body with no task lines", () => {
    const body = "# Heading\n\nSome text without task lists.";
    expect(extractSubtasks(body)).toEqual([]);
  });

  it("returns empty array for empty/undefined body", () => {
    expect(extractSubtasks("")).toEqual([]);
  });

  it("handles checked task items", () => {
    const body = "- [x] Already done\n- [ ] Still todo";
    const subtasks = extractSubtasks(body);
    expect(subtasks).toHaveLength(2);
    expect(subtasks[0].id).toBe("already-done");
    expect(subtasks[1].id).toBe("still-todo");
  });

  it("slugifies titles into IDs", () => {
    const body = "- [ ] Set Up The Database Schema (parallel)";
    const subtasks = extractSubtasks(body);
    expect(subtasks[0].id).toBe("set-up-the-database-schema");
  });
});

describe("expandSubtaskSteps (swarm decomposition)", () => {
  it("swarm plan creates one step per subtask, parent has no step", () => {
    const allTickets = new Map([
      ["parent-ticket", {
        ticket: makeWorkItem("parent-ticket", {
          subtasks: [
            { id: "sub-a", title: "Sub A", parallel: true, deps: [] },
            { id: "sub-b", title: "Sub B", parallel: true, deps: [] },
            { id: "sub-c", title: "Sub C", parallel: false, deps: ["sub-a", "sub-b"] },
          ],
        }),
        projectId: "proj",
      }],
    ]);

    const steps: PlanStep[] = [makeStep("parent-ticket", "track-1")];
    const expanded = expandSubtaskSteps(steps, allTickets);

    // Parent has no step — only subtask steps
    expect(expanded.find((s) => s.ticketId === "parent-ticket")).toBeUndefined();
    expect(expanded).toHaveLength(3);
    expect(expanded.map((s) => s.ticketId)).toEqual([
      "parent-ticket/sub-a",
      "parent-ticket/sub-b",
      "parent-ticket/sub-c",
    ]);
  });

  it("subtask blockedBy reflects parsed deps", () => {
    const allTickets = new Map([
      ["t1", {
        ticket: makeWorkItem("t1", {
          subtasks: [
            { id: "setup", title: "Setup", parallel: true, deps: [] },
            { id: "build", title: "Build", parallel: false, deps: ["setup"] },
            { id: "test", title: "Test", parallel: false, deps: ["build"] },
          ],
        }),
        projectId: "proj",
      }],
    ]);

    const steps: PlanStep[] = [makeStep("t1", "track-1")];
    const expanded = expandSubtaskSteps(steps, allTickets);

    expect(expanded[0].ticketId).toBe("t1/setup");
    expect(expanded[0].blockedBy).toEqual([]);
    expect(expanded[0].status).toBe("ready");

    expect(expanded[1].ticketId).toBe("t1/build");
    expect(expanded[1].blockedBy).toEqual(["t1/setup"]);
    expect(expanded[1].status).toBe("blocked");

    expect(expanded[2].ticketId).toBe("t1/test");
    expect(expanded[2].blockedBy).toEqual(["t1/build"]);
    expect(expanded[2].status).toBe("blocked");
  });

  it("parallel subtasks all launch (all ready) up to maxConcurrentAgents", () => {
    const allTickets = new Map([
      ["big-task", {
        ticket: makeWorkItem("big-task", {
          subtasks: [
            { id: "a", title: "A", parallel: true, deps: [] },
            { id: "b", title: "B", parallel: true, deps: [] },
            { id: "c", title: "C", parallel: true, deps: [] },
            { id: "d", title: "D", parallel: true, deps: [] },
          ],
        }),
        projectId: "proj",
      }],
    ]);

    const steps: PlanStep[] = [makeStep("big-task", "track-1")];
    const expanded = expandSubtaskSteps(steps, allTickets);

    // All 4 parallel subtasks should be ready (no blockedBy)
    const readySteps = expanded.filter((s) => s.status === "ready");
    expect(readySteps).toHaveLength(4);

    // maxConcurrentAgents limits how many start — that's the executor's job.
    // The planner's job is to make them all "ready" so the executor can pick up to max.
    for (const step of expanded) {
      expect(step.blockedBy).toEqual([]);
      expect(step.status).toBe("ready");
    }
  });

  it("tickets without subtasks pass through unchanged", () => {
    const allTickets = new Map([
      ["simple", {
        ticket: makeWorkItem("simple"),
        projectId: "proj",
      }],
    ]);

    const steps: PlanStep[] = [makeStep("simple", "track-1")];
    const expanded = expandSubtaskSteps(steps, allTickets);
    expect(expanded).toHaveLength(1);
    expect(expanded[0].ticketId).toBe("simple");
  });

  it("rewrites blockedBy references from parent to leaf subtasks", () => {
    const allTickets = new Map([
      ["dep-parent", {
        ticket: makeWorkItem("dep-parent", {
          subtasks: [
            { id: "x", title: "X", parallel: true, deps: [] },
            { id: "y", title: "Y", parallel: false, deps: ["x"] },
          ],
        }),
        projectId: "proj",
      }],
      ["downstream", {
        ticket: makeWorkItem("downstream"),
        projectId: "proj",
      }],
    ]);

    const steps: PlanStep[] = [
      makeStep("dep-parent", "track-1"),
      makeStep("downstream", "track-2", ["dep-parent"]),
    ];

    const expanded = expandSubtaskSteps(steps, allTickets);

    // "downstream" should now depend on the leaf subtask "dep-parent/y" (not "dep-parent")
    const downstream = expanded.find((s) => s.ticketId === "downstream")!;
    expect(downstream.blockedBy).toContain("dep-parent/y");
    expect(downstream.blockedBy).not.toContain("dep-parent");
  });

  it("subtasks with no deps inherit parent external blockedBy", () => {
    const allTickets = new Map([
      ["blocker", {
        ticket: makeWorkItem("blocker"),
        projectId: "proj",
      }],
      ["child", {
        ticket: makeWorkItem("child", {
          subtasks: [
            { id: "a", title: "A", parallel: true, deps: [] },
            { id: "b", title: "B", parallel: true, deps: [] },
          ],
        }),
        projectId: "proj",
      }],
    ]);

    const steps: PlanStep[] = [
      makeStep("blocker", "track-1"),
      makeStep("child", "track-2", ["blocker"]),
    ];

    const expanded = expandSubtaskSteps(steps, allTickets);

    // Subtask A and B should inherit "blocker" as external dep
    const subA = expanded.find((s) => s.ticketId === "child/a")!;
    const subB = expanded.find((s) => s.ticketId === "child/b")!;
    expect(subA.blockedBy).toEqual(["blocker"]);
    expect(subB.blockedBy).toEqual(["blocker"]);
  });
});

describe("mixed mode: swarm tickets decompose, normal tickets don't", () => {
  it("computePlan with mixed strategy decomposes subtask tickets only", () => {
    const ticketSets = [{
      projectId: "proj",
      tickets: [
        makeWorkItem("with-subtasks", {
          subtasks: [
            { id: "part-a", title: "Part A", parallel: true, deps: [] },
            { id: "part-b", title: "Part B", parallel: true, deps: [] },
          ],
        }),
        makeWorkItem("normal-ticket"),
      ],
    }];

    const plan = computePlan(
      ticketSets,
      {},
      "test-plan",
      undefined,
      { strategy: "mixed" },
    );

    // "with-subtasks" should be decomposed into 2 subtask steps
    const subtaskSteps = plan.steps.filter((s) => s.ticketId.startsWith("with-subtasks/"));
    expect(subtaskSteps).toHaveLength(2);

    // "normal-ticket" should remain as a single step
    const normalStep = plan.steps.find((s) => s.ticketId === "normal-ticket");
    expect(normalStep).toBeDefined();

    // Parent "with-subtasks" should NOT have its own step
    const parentStep = plan.steps.find((s) => s.ticketId === "with-subtasks");
    expect(parentStep).toBeUndefined();
  });

  it("computePlan with spread strategy does NOT decompose subtask tickets", () => {
    const ticketSets = [{
      projectId: "proj",
      tickets: [
        makeWorkItem("has-subtasks", {
          subtasks: [
            { id: "a", title: "A", parallel: true, deps: [] },
            { id: "b", title: "B", parallel: true, deps: [] },
          ],
        }),
      ],
    }];

    const plan = computePlan(
      ticketSets,
      {},
      "test-plan",
      undefined,
      { strategy: "spread" },
    );

    // Spread does not decompose — the original ticket remains as one step
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].ticketId).toBe("has-subtasks");
  });
});

describe("computeDepthStages", () => {
  it("stages within a swarm group by dependency depth", () => {
    const steps: PlanStep[] = [
      makeStep("t/a", "track", []),
      makeStep("t/b", "track", []),
      makeStep("t/c", "track", ["t/a", "t/b"]),
      makeStep("t/d", "track", ["t/c"]),
    ];

    const stages = computeDepthStages(steps);

    expect(stages).toHaveLength(3);

    // Depth 0: a, b (no deps)
    expect(stages[0].stepTicketIds).toContain("t/a");
    expect(stages[0].stepTicketIds).toContain("t/b");
    expect(stages[0].name).toBe("depth-0");

    // Depth 1: c (depends on a, b)
    expect(stages[1].stepTicketIds).toEqual(["t/c"]);
    expect(stages[1].name).toBe("depth-1");

    // Depth 2: d (depends on c)
    expect(stages[2].stepTicketIds).toEqual(["t/d"]);
    expect(stages[2].name).toBe("depth-2");
  });

  it("returns empty for no steps", () => {
    expect(computeDepthStages([])).toEqual([]);
  });

  it("all independent steps form a single depth-0 stage", () => {
    const steps: PlanStep[] = [
      makeStep("x", "t"),
      makeStep("y", "t"),
      makeStep("z", "t"),
    ];
    const stages = computeDepthStages(steps);
    expect(stages).toHaveLength(1);
    expect(stages[0].stepTicketIds).toHaveLength(3);
  });
});

describe("parent ticket closes when all subtasks complete", () => {
  it("recomputePlan resolves parent dep when all subtask steps are done", () => {
    // Simulate: parent decomposed into subtasks, downstream depends on leaf subtask
    const plan = {
      id: "test",
      name: "test",
      status: "executing" as const,
      scope: {},
      steps: [
        { ticketId: "parent/sub-a", projectId: "proj", status: "done" as const, blockedBy: [] },
        { ticketId: "parent/sub-b", projectId: "proj", status: "done" as const, blockedBy: ["parent/sub-a"] },
        { ticketId: "downstream", projectId: "proj", status: "blocked" as const, blockedBy: ["parent/sub-b"] },
      ],
      config: {
        maxConcurrentAgents: 2,
        autoStart: true,
        backend: "claude",
        worktree: false,
        pauseOnFailure: false,
        ticketTransitions: true,
        autoCommit: true,
        verification: { runTests: true, runOracle: false },
        stall: { enabled: false, agentTimeoutMs: 0, planStallTimeoutMs: 0, maxIdenticalFailures: 2 },
        strategy: "swarm" as const,
      },
      context: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ticketSets = [{
      projectId: "proj",
      tickets: [
        makeWorkItem("parent"),
        makeWorkItem("downstream", { deps: ["parent"] }),
      ],
    }];

    const updated = recomputePlan(plan, ticketSets);

    // "downstream" was blocked by "parent/sub-b" which is done → should now be "ready"
    const downstream = updated.steps.find((s: PlanStep) => s.ticketId === "downstream");
    expect(downstream?.status).toBe("ready");
  });
});

describe("swarm computePlan end-to-end", () => {
  it("decomposes ticket with subtasks into separate steps in swarm mode", () => {
    const ticketSets = [{
      projectId: "proj",
      tickets: [
        makeWorkItem("epic", {
          priority: 1,
          subtasks: [
            { id: "setup", title: "Setup", parallel: true, deps: [] },
            { id: "impl", title: "Implementation", parallel: false, deps: ["setup"] },
            { id: "test", title: "Testing", parallel: false, deps: ["impl"] },
          ],
        }),
        makeWorkItem("other-ticket", { priority: 2 }),
      ],
    }];

    const plan = computePlan(
      ticketSets,
      {},
      "swarm-plan",
      undefined,
      { strategy: "swarm" },
    );

    // Should have 4 steps: 3 subtask steps + 1 normal ticket
    expect(plan.steps).toHaveLength(4);

    // Subtask steps
    const setup = plan.steps.find((s) => s.ticketId === "epic/setup")!;
    const impl = plan.steps.find((s) => s.ticketId === "epic/impl")!;
    const test = plan.steps.find((s) => s.ticketId === "epic/test")!;

    expect(setup).toBeDefined();
    expect(impl).toBeDefined();
    expect(test).toBeDefined();

    expect(setup.blockedBy).toEqual([]);
    expect(impl.blockedBy).toEqual(["epic/setup"]);
    expect(test.blockedBy).toEqual(["epic/impl"]);

    // Normal ticket still present
    expect(plan.steps.find((s) => s.ticketId === "other-ticket")).toBeDefined();

    // Parent ticket NOT present as a step
    expect(plan.steps.find((s) => s.ticketId === "epic")).toBeUndefined();
  });
});
