import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stripAnsi, ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";
import {
  createTicketFocusState,
  rebuildDisplayLines,
  renderTicketFocus,
} from "../../packages/cli/src/tui/views/ticket-focus.js";
import {
  computeTicketTraceability,
  type TicketTraceability,
} from "../../packages/cli/src/tui/health-data.js";
import type { Panel } from "../../packages/cli/src/tui/layout.js";
import type { WorkItem } from "@opcom/types";

function makeTicket(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: overrides.id ?? "plan-stages",
    title: overrides.title ?? "Plan stages implementation",
    status: overrides.status ?? "open",
    priority: overrides.priority ?? 2,
    type: overrides.type ?? "feature",
    filePath: overrides.filePath ?? "/tickets/plan-stages/README.md",
    deps: overrides.deps ?? [],
    links: overrides.links ?? [],
    tags: overrides.tags ?? {},
  };
}

function makePanel(overrides: Partial<Panel> = {}): Panel {
  return {
    id: "ticket-focus",
    x: 0,
    y: 0,
    width: 80,
    height: 30,
    title: "Ticket",
    ...overrides,
  };
}

// --- computeTicketTraceability tests ---

describe("computeTicketTraceability", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "opcom-trace-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts spec link with anchor from ticket links", () => {
    const ticket = makeTicket({
      links: ["docs/spec/orchestrator.md#plan-stages"],
    });
    const result = computeTicketTraceability(ticket, [ticket], tmpDir);
    expect(result.specLink).toEqual({ spec: "orchestrator", anchor: "plan-stages" });
  });

  it("extracts spec link without anchor", () => {
    const ticket = makeTicket({
      links: ["docs/spec/tui.md"],
    });
    const result = computeTicketTraceability(ticket, [ticket], tmpDir);
    expect(result.specLink).toEqual({ spec: "tui", anchor: undefined });
  });

  it("returns null specLink when no spec link present", () => {
    const ticket = makeTicket({ links: [] });
    const result = computeTicketTraceability(ticket, [ticket], tmpDir);
    expect(result.specLink).toBeNull();
  });

  it("returns null specLink for non-spec links", () => {
    const ticket = makeTicket({ links: ["README.md", "CHANGELOG.md"] });
    const result = computeTicketTraceability(ticket, [ticket], tmpDir);
    expect(result.specLink).toBeNull();
  });

  it("handles short spec path (spec/name without docs/ prefix)", () => {
    const ticket = makeTicket({
      links: ["spec/orchestrator.md#plan-stages"],
    });
    const result = computeTicketTraceability(ticket, [ticket], tmpDir);
    expect(result.specLink).toEqual({ spec: "orchestrator", anchor: "plan-stages" });
  });

  it("finds related tickets with same spec and anchor", () => {
    const ticket = makeTicket({
      id: "plan-stages",
      links: ["docs/spec/orchestrator.md#plan-stages"],
    });
    const related1 = makeTicket({
      id: "plan-overview-screen",
      links: ["docs/spec/orchestrator.md#plan-stages"],
      status: "closed",
    });
    const related2 = makeTicket({
      id: "executor-worktree",
      links: ["docs/spec/orchestrator.md#executor"],
    });
    const unrelated = makeTicket({
      id: "tui-nav",
      links: ["docs/spec/tui.md#navigation"],
    });

    const result = computeTicketTraceability(
      ticket,
      [ticket, related1, related2, unrelated],
      tmpDir,
    );
    expect(result.relatedTickets).toEqual([
      { id: "plan-overview-screen", status: "closed" },
    ]);
  });

  it("finds related tickets matching spec without anchors", () => {
    const ticket = makeTicket({
      id: "tui-health",
      links: ["docs/spec/tui.md"],
    });
    const related = makeTicket({
      id: "tui-nav",
      links: ["docs/spec/tui.md#navigation"],
      status: "open",
    });

    const result = computeTicketTraceability(
      ticket,
      [ticket, related],
      tmpDir,
    );
    expect(result.relatedTickets).toEqual([
      { id: "tui-nav", status: "open" },
    ]);
  });

  it("excludes self from related tickets", () => {
    const ticket = makeTicket({
      id: "plan-stages",
      links: ["docs/spec/orchestrator.md#plan-stages"],
    });

    const result = computeTicketTraceability(ticket, [ticket], tmpDir);
    expect(result.relatedTickets).toEqual([]);
  });

  it("returns empty related tickets when no spec link", () => {
    const ticket = makeTicket({ id: "no-spec", links: [] });
    const other = makeTicket({
      id: "other",
      links: ["docs/spec/tui.md"],
    });

    const result = computeTicketTraceability(ticket, [ticket, other], tmpDir);
    expect(result.relatedTickets).toEqual([]);
  });

  it("finds test files in spec-named directory", () => {
    // Create tests/orchestrator/ with test files
    const testsDir = join(tmpDir, "tests", "orchestrator");
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(join(testsDir, "executor.test.ts"), "test");
    writeFileSync(join(testsDir, "plan.test.ts"), "test");
    writeFileSync(join(testsDir, "helper.ts"), "not a test");

    const ticket = makeTicket({
      links: ["docs/spec/orchestrator.md#plan-stages"],
    });
    const result = computeTicketTraceability(ticket, [ticket], tmpDir);
    expect(result.testFiles).toContain("tests/orchestrator/executor.test.ts");
    expect(result.testFiles).toContain("tests/orchestrator/plan.test.ts");
    expect(result.testFiles).not.toContain("tests/orchestrator/helper.ts");
  });

  it("finds top-level test files matching spec name", () => {
    const testsDir = join(tmpDir, "tests");
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(join(testsDir, "tui-integration.test.ts"), "test");
    writeFileSync(join(testsDir, "other.test.ts"), "test");

    const ticket = makeTicket({
      links: ["docs/spec/tui.md#navigation"],
    });
    const result = computeTicketTraceability(ticket, [ticket], tmpDir);
    expect(result.testFiles).toContain("tests/tui-integration.test.ts");
    expect(result.testFiles).not.toContain("tests/other.test.ts");
  });

  it("returns empty test files when no spec link", () => {
    const ticket = makeTicket({ links: [] });
    const result = computeTicketTraceability(ticket, [ticket], tmpDir);
    expect(result.testFiles).toEqual([]);
  });

  it("returns empty test files when tests dir does not exist", () => {
    const ticket = makeTicket({
      links: ["docs/spec/orchestrator.md#plan-stages"],
    });
    const result = computeTicketTraceability(ticket, [ticket], tmpDir);
    expect(result.testFiles).toEqual([]);
  });
});

// --- rebuildDisplayLines with traceability tests ---

describe("rebuildDisplayLines with traceability", () => {
  it("shows spec link with green check when linked", () => {
    const ticket = makeTicket({
      links: ["docs/spec/orchestrator.md#plan-stages"],
    });
    const state = createTicketFocusState(ticket, null);
    state.traceability = {
      specLink: { spec: "orchestrator", anchor: "plan-stages" },
      relatedTickets: [],
      testFiles: [],
    };
    state.loaded = true;
    rebuildDisplayLines(state, 100);

    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).toContain("orchestrator.md#plan-stages");
    expect(text).toContain("\u2713 linked");
  });

  it("shows red warning when no spec link", () => {
    const ticket = makeTicket({ links: [] });
    const state = createTicketFocusState(ticket, null);
    state.traceability = {
      specLink: null,
      relatedTickets: [],
      testFiles: [],
    };
    state.loaded = true;
    rebuildDisplayLines(state, 100);

    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).toContain("\u26A0 no spec link");
  });

  it("shows spec link without anchor", () => {
    const ticket = makeTicket({ links: ["docs/spec/tui.md"] });
    const state = createTicketFocusState(ticket, null);
    state.traceability = {
      specLink: { spec: "tui" },
      relatedTickets: [],
      testFiles: [],
    };
    state.loaded = true;
    rebuildDisplayLines(state, 100);

    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).toContain("tui.md");
    expect(text).toContain("\u2713 linked");
    expect(text).not.toContain("#");
  });

  it("shows related tickets", () => {
    const ticket = makeTicket();
    const state = createTicketFocusState(ticket, null);
    state.traceability = {
      specLink: { spec: "orchestrator", anchor: "plan-stages" },
      relatedTickets: [
        { id: "plan-overview-screen", status: "closed" },
        { id: "executor-worktree", status: "open" },
      ],
      testFiles: [],
    };
    state.loaded = true;
    rebuildDisplayLines(state, 120);

    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).toContain("Related:");
    expect(text).toContain("plan-overview-screen (closed)");
    expect(text).toContain("executor-worktree (open)");
  });

  it("omits related section when no related tickets", () => {
    const ticket = makeTicket();
    const state = createTicketFocusState(ticket, null);
    state.traceability = {
      specLink: { spec: "orchestrator" },
      relatedTickets: [],
      testFiles: [],
    };
    state.loaded = true;
    rebuildDisplayLines(state, 100);

    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).not.toContain("Related:");
  });

  it("shows test files", () => {
    const ticket = makeTicket();
    const state = createTicketFocusState(ticket, null);
    state.traceability = {
      specLink: { spec: "orchestrator" },
      relatedTickets: [],
      testFiles: [
        "tests/orchestrator/executor.test.ts",
        "tests/orchestrator/plan.test.ts",
      ],
    };
    state.loaded = true;
    rebuildDisplayLines(state, 120);

    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).toContain("Tests:");
    expect(text).toContain("tests/orchestrator/executor.test.ts");
    expect(text).toContain("tests/orchestrator/plan.test.ts");
  });

  it("omits tests section when no test files", () => {
    const ticket = makeTicket();
    const state = createTicketFocusState(ticket, null);
    state.traceability = {
      specLink: { spec: "orchestrator" },
      relatedTickets: [],
      testFiles: [],
    };
    state.loaded = true;
    rebuildDisplayLines(state, 100);

    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).not.toContain("Tests:");
  });

  it("does not show traceability section when traceability is null", () => {
    const ticket = makeTicket();
    const state = createTicketFocusState(ticket, null);
    state.traceability = null;
    state.loaded = true;
    rebuildDisplayLines(state, 100);

    const text = state.displayLines.map(stripAnsi).join("\n");
    expect(text).not.toContain("Spec:");
    expect(text).not.toContain("\u2713 linked");
    expect(text).not.toContain("\u26A0 no spec link");
  });
});

// --- renderTicketFocus with traceability tests ---

describe("renderTicketFocus with traceability", () => {
  it("renders without crash when traceability data is present", () => {
    const buf = new ScreenBuffer(100, 40);
    const panel = makePanel({ width: 100, height: 39 });
    const ticket = makeTicket({
      links: ["docs/spec/orchestrator.md#plan-stages"],
    });
    const state = createTicketFocusState(ticket, null);
    state.traceability = {
      specLink: { spec: "orchestrator", anchor: "plan-stages" },
      relatedTickets: [{ id: "plan-overview", status: "closed" }],
      testFiles: ["tests/orchestrator/executor.test.ts"],
    };
    state.loaded = true;
    rebuildDisplayLines(state, 98);

    renderTicketFocus(buf, panel, state);
    buf.flush();
  });

  it("renders without crash when traceability is null", () => {
    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();
    const ticket = makeTicket();
    const state = createTicketFocusState(ticket, null);
    state.traceability = null;
    state.loaded = true;
    rebuildDisplayLines(state, 78);

    renderTicketFocus(buf, panel, state);
    buf.flush();
  });

  it("renders without crash when no spec link (warning state)", () => {
    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();
    const ticket = makeTicket({ links: [] });
    const state = createTicketFocusState(ticket, null);
    state.traceability = {
      specLink: null,
      relatedTickets: [],
      testFiles: [],
    };
    state.loaded = true;
    rebuildDisplayLines(state, 78);

    renderTicketFocus(buf, panel, state);
    buf.flush();
  });

  it("handles narrow terminal with traceability data", () => {
    const buf = new ScreenBuffer(40, 15);
    const panel = makePanel({ width: 40, height: 14 });
    const ticket = makeTicket({
      links: ["docs/spec/orchestrator.md#plan-stages"],
    });
    const state = createTicketFocusState(ticket, null);
    state.traceability = {
      specLink: { spec: "orchestrator", anchor: "plan-stages" },
      relatedTickets: [
        { id: "plan-overview", status: "closed" },
        { id: "executor-gate", status: "open" },
      ],
      testFiles: ["tests/orchestrator/executor.test.ts"],
    };
    state.loaded = true;
    rebuildDisplayLines(state, 38);

    renderTicketFocus(buf, panel, state);
    buf.flush();
  });
});

// --- createTicketFocusState tests ---

describe("createTicketFocusState", () => {
  it("initializes traceability as null", () => {
    const ticket = makeTicket();
    const state = createTicketFocusState(ticket, null);
    expect(state.traceability).toBeNull();
  });
});
