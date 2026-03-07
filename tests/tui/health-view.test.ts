import { describe, it, expect } from "vitest";
import { stripAnsi, ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";
import {
  renderHealthView,
  createHealthViewState,
  healthScrollUp,
  healthScrollDown,
  type HealthViewState,
} from "../../packages/cli/src/tui/views/health-view.js";
import {
  formatHealthBar,
  isHealthWarning,
  type HealthData,
  type SpecCoverageItem,
  type SpecSectionCoverage,
} from "../../packages/cli/src/tui/health-data.js";
import type { Panel } from "../../packages/cli/src/tui/layout.js";

function makeHealthData(overrides: Partial<HealthData> = {}): HealthData {
  return {
    specCount: 16,
    specsCovered: 10,
    specsPartial: 3,
    specsUncovered: 3,
    specs: [
      { name: "detection", sections: 4, ticketCount: 4, status: "covered" },
      { name: "config", sections: 3, ticketCount: 0, status: "uncovered" },
      { name: "adapters", sections: 6, ticketCount: 6, status: "covered" },
      { name: "orchestrator", sections: 8, ticketCount: 5, status: "partial" },
      { name: "tui", sections: 9, ticketCount: 9, status: "covered" },
    ],
    ticketCount: 68,
    ticketsWithSpec: 53,
    ticketsWithoutSpec: 15,
    brokenLinks: [],
    useCases: [
      { id: "UC-001", title: "First-Run Onboarding", done: 7, total: 14 },
    ],
    ...overrides,
  };
}

function makePanel(overrides: Partial<Panel> = {}): Panel {
  return {
    id: "health",
    x: 0,
    y: 0,
    width: 80,
    height: 30,
    title: "Health",
    ...overrides,
  };
}

function getBufferText(buf: ScreenBuffer, row: number): string {
  // Read the buffer by flushing and capturing
  // Instead, use the writeLine approach by rendering to a buffer then reading
  const lines: string[] = [];
  for (let r = 0; r < buf.rows; r++) {
    // Capture line by writing to buffer and checking
    lines.push("");
  }
  return "";
}

// --- formatHealthBar tests ---

describe("formatHealthBar", () => {
  it("formats spec coverage percentage", () => {
    const data = makeHealthData();
    const bar = formatHealthBar(data);
    // (10 covered + 3 partial) / 16 = 81%
    expect(bar).toContain("16 specs (81% covered)");
  });

  it("formats ticket link percentage", () => {
    const data = makeHealthData();
    const bar = formatHealthBar(data);
    // 53/68 = 78%
    expect(bar).toContain("68 tickets (78% linked)");
  });

  it("shows broken link count", () => {
    const data = makeHealthData();
    const bar = formatHealthBar(data);
    expect(bar).toContain("0 broken");
  });

  it("shows use case summary when present", () => {
    const data = makeHealthData();
    const bar = formatHealthBar(data);
    // 7/14 = 50%
    expect(bar).toContain("UC-001: 50%");
  });

  it("handles zero specs", () => {
    const data = makeHealthData({ specCount: 0, specs: [], specsCovered: 0, specsPartial: 0, specsUncovered: 0 });
    const bar = formatHealthBar(data);
    expect(bar).toContain("0 specs (0% covered)");
  });

  it("handles zero tickets", () => {
    const data = makeHealthData({ ticketCount: 0, ticketsWithSpec: 0, ticketsWithoutSpec: 0 });
    const bar = formatHealthBar(data);
    expect(bar).toContain("0 tickets (0% linked)");
  });

  it("omits use case when none exist", () => {
    const data = makeHealthData({ useCases: [] });
    const bar = formatHealthBar(data);
    expect(bar).not.toContain("UC-");
  });

  it("shows broken count when non-zero", () => {
    const data = makeHealthData({
      brokenLinks: [{ ticket: "t1", link: "spec/foo.md#bar", reason: "file not found" }],
    });
    const bar = formatHealthBar(data);
    expect(bar).toContain("1 broken");
  });
});

// --- isHealthWarning tests ---

describe("isHealthWarning", () => {
  it("returns false when healthy", () => {
    const data = makeHealthData({
      brokenLinks: [],
      ticketCount: 100,
      ticketsWithSpec: 80,
      ticketsWithoutSpec: 20,
    });
    expect(isHealthWarning(data)).toBe(false);
  });

  it("returns true when broken links exist", () => {
    const data = makeHealthData({
      brokenLinks: [{ ticket: "t1", link: "bad", reason: "not found" }],
    });
    expect(isHealthWarning(data)).toBe(true);
  });

  it("returns true when > 25% tickets unlinked", () => {
    const data = makeHealthData({
      ticketCount: 100,
      ticketsWithSpec: 70,
      ticketsWithoutSpec: 30,
      brokenLinks: [],
    });
    expect(isHealthWarning(data)).toBe(true);
  });

  it("returns false at exactly 25% unlinked", () => {
    const data = makeHealthData({
      ticketCount: 100,
      ticketsWithSpec: 75,
      ticketsWithoutSpec: 25,
      brokenLinks: [],
    });
    expect(isHealthWarning(data)).toBe(false);
  });

  it("returns false with zero tickets", () => {
    const data = makeHealthData({
      ticketCount: 0,
      ticketsWithSpec: 0,
      ticketsWithoutSpec: 0,
      brokenLinks: [],
    });
    expect(isHealthWarning(data)).toBe(false);
  });
});

// --- createHealthViewState tests ---

describe("createHealthViewState", () => {
  it("creates initial state with defaults", () => {
    const state = createHealthViewState();
    expect(state.data).toBeNull();
    expect(state.selectedIndex).toBe(0);
    expect(state.scrollOffset).toBe(0);
    expect(state.drilledSpec).toBeNull();
    expect(state.sectionCoverage).toBeNull();
  });
});

// --- healthScrollDown / healthScrollUp tests ---

describe("healthScrollDown", () => {
  it("increments selectedIndex within spec list", () => {
    const state = createHealthViewState();
    state.data = makeHealthData();
    healthScrollDown(state, 30);
    expect(state.selectedIndex).toBe(1);
  });

  it("does not exceed spec list bounds", () => {
    const state = createHealthViewState();
    state.data = makeHealthData(); // 5 specs
    state.selectedIndex = 4;
    healthScrollDown(state, 30);
    expect(state.selectedIndex).toBe(4);
  });

  it("scrolls within drill-down when drilled", () => {
    const state = createHealthViewState();
    state.drilledSpec = "tui";
    state.sectionCoverage = [
      { anchor: "a", title: "A", tickets: [] },
      { anchor: "b", title: "B", tickets: [] },
      { anchor: "c", title: "C", tickets: [] },
    ];
    state.drillSelectedIndex = 0;
    healthScrollDown(state, 30);
    expect(state.drillSelectedIndex).toBe(1);
  });

  it("does not exceed drill-down bounds", () => {
    const state = createHealthViewState();
    state.drilledSpec = "tui";
    state.sectionCoverage = [
      { anchor: "a", title: "A", tickets: [] },
    ];
    state.drillSelectedIndex = 0;
    healthScrollDown(state, 30);
    expect(state.drillSelectedIndex).toBe(0);
  });

  it("does nothing when data is null", () => {
    const state = createHealthViewState();
    healthScrollDown(state, 30);
    expect(state.selectedIndex).toBe(0);
  });
});

describe("healthScrollUp", () => {
  it("decrements selectedIndex", () => {
    const state = createHealthViewState();
    state.data = makeHealthData();
    state.selectedIndex = 3;
    healthScrollUp(state);
    expect(state.selectedIndex).toBe(2);
  });

  it("does not go below 0", () => {
    const state = createHealthViewState();
    state.data = makeHealthData();
    state.selectedIndex = 0;
    healthScrollUp(state);
    expect(state.selectedIndex).toBe(0);
  });

  it("scrolls within drill-down when drilled", () => {
    const state = createHealthViewState();
    state.drilledSpec = "tui";
    state.sectionCoverage = [
      { anchor: "a", title: "A", tickets: [] },
      { anchor: "b", title: "B", tickets: [] },
    ];
    state.drillSelectedIndex = 1;
    healthScrollUp(state);
    expect(state.drillSelectedIndex).toBe(0);
  });
});

// --- renderHealthView tests ---

describe("renderHealthView", () => {
  it("renders loading state when data is null", () => {
    const buf = new ScreenBuffer(80, 30);
    const panel = makePanel();
    const state = createHealthViewState();

    renderHealthView(buf, panel, state);
    buf.flush();
    // Verify no crash — loading state renders
  });

  it("renders overview with spec coverage section", () => {
    const buf = new ScreenBuffer(100, 40);
    const panel = makePanel({ width: 100, height: 39 });
    const state = createHealthViewState();
    state.data = makeHealthData();

    renderHealthView(buf, panel, state);
    buf.flush();
    // Verify no crash — overview renders with data
  });

  it("renders spec list with correct statuses", () => {
    const buf = new ScreenBuffer(100, 40);
    const panel = makePanel({ width: 100, height: 39 });
    const state = createHealthViewState();
    state.data = makeHealthData({
      specs: [
        { name: "detection", sections: 4, ticketCount: 4, status: "covered" },
        { name: "config", sections: 3, ticketCount: 0, status: "uncovered" },
      ],
      specCount: 2,
      specsCovered: 1,
      specsPartial: 0,
      specsUncovered: 1,
    });

    renderHealthView(buf, panel, state);
    buf.flush();
    // Verify no crash with mixed statuses
  });

  it("renders drill-down when spec is selected", () => {
    const buf = new ScreenBuffer(100, 40);
    const panel = makePanel({ width: 100, height: 39 });
    const state = createHealthViewState();
    state.data = makeHealthData();
    state.drilledSpec = "tui";
    state.sectionCoverage = [
      { anchor: "navigation", title: "Navigation", tickets: [{ id: "tui-nav", status: "closed" }] },
      { anchor: "rendering", title: "Rendering", tickets: [] },
    ];

    renderHealthView(buf, panel, state);
    buf.flush();
    // Verify no crash — drill-down renders
  });

  it("renders broken links section when present", () => {
    const buf = new ScreenBuffer(100, 40);
    const panel = makePanel({ width: 100, height: 39 });
    const state = createHealthViewState();
    state.data = makeHealthData({
      brokenLinks: [
        { ticket: "bad-ticket", link: "spec/foo.md#missing", reason: "anchor not found" },
      ],
    });

    renderHealthView(buf, panel, state);
    buf.flush();
    // Verify no crash with broken links
  });

  it("renders use cases when present", () => {
    const buf = new ScreenBuffer(100, 40);
    const panel = makePanel({ width: 100, height: 39 });
    const state = createHealthViewState();
    state.data = makeHealthData({
      useCases: [
        { id: "UC-001", title: "Onboarding", done: 5, total: 10 },
        { id: "UC-002", title: "Orchestration", done: 12, total: 12 },
      ],
    });

    renderHealthView(buf, panel, state);
    buf.flush();
    // Verify no crash with use cases
  });

  it("handles narrow terminal gracefully", () => {
    const buf = new ScreenBuffer(40, 15);
    const panel = makePanel({ width: 40, height: 14 });
    const state = createHealthViewState();
    state.data = makeHealthData();

    renderHealthView(buf, panel, state);
    buf.flush();
    // Verify no crash in narrow terminal
  });

  it("handles many specs with scrolling", () => {
    const state = createHealthViewState();
    const specs: SpecCoverageItem[] = [];
    for (let i = 0; i < 30; i++) {
      specs.push({ name: `spec-${i}`, sections: i, ticketCount: i, status: i % 3 === 0 ? "covered" : i % 3 === 1 ? "partial" : "uncovered" });
    }
    state.data = makeHealthData({ specs, specCount: 30 });

    // Scroll down several times
    healthScrollDown(state, 20);
    healthScrollDown(state, 20);
    healthScrollDown(state, 20);
    expect(state.selectedIndex).toBe(3);

    const buf = new ScreenBuffer(100, 20);
    const panel = makePanel({ width: 100, height: 19 });
    renderHealthView(buf, panel, state);
    buf.flush();
    // Verify no crash with scroll state
  });
});

// --- Health bar integration tests ---

describe("health bar formatting edge cases", () => {
  it("rounds percentages correctly", () => {
    const data = makeHealthData({
      specCount: 3,
      specsCovered: 1,
      specsPartial: 0,
      specsUncovered: 2,
    });
    const bar = formatHealthBar(data);
    // 1/3 = 33%
    expect(bar).toContain("33% covered");
  });

  it("shows 100% when fully covered", () => {
    const data = makeHealthData({
      specCount: 5,
      specsCovered: 5,
      specsPartial: 0,
      specsUncovered: 0,
    });
    const bar = formatHealthBar(data);
    expect(bar).toContain("100% covered");
  });

  it("includes partial in coverage percentage", () => {
    const data = makeHealthData({
      specCount: 10,
      specsCovered: 3,
      specsPartial: 2,
      specsUncovered: 5,
    });
    const bar = formatHealthBar(data);
    // (3 + 2) / 10 = 50%
    expect(bar).toContain("50% covered");
  });
});
