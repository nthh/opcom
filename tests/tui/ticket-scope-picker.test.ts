import { describe, it, expect } from "vitest";
import type { WorkItem } from "@opcom/types";
import {
  createTicketScopePickerState,
  moveUp,
  moveDown,
  toggleItem,
  selectAll,
  selectNone,
  getSelectedTicketIds,
  rebuildPickerDisplayLines,
  scrollUp,
  scrollDown,
  scrollToTop,
  scrollToBottom,
} from "../../packages/cli/src/tui/views/ticket-scope-picker.js";

function makeTicket(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "ticket",
    title: "Ticket",
    status: "open",
    priority: 2,
    type: "feature",
    filePath: "/tmp/.tickets/impl/ticket/README.md",
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

describe("createTicketScopePickerState", () => {
  it("creates state with all tickets selected by default", () => {
    const tickets = [
      makeTicket({ id: "a", title: "Alpha" }),
      makeTicket({ id: "b", title: "Beta" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);

    expect(state.selectedIds.has("a")).toBe(true);
    expect(state.selectedIds.has("b")).toBe(true);
    expect(state.items).toHaveLength(2);
    expect(state.confirmed).toBeNull();
  });

  it("groups children under parent epics", () => {
    const tickets = [
      makeTicket({ id: "epic", title: "Epic", priority: 1 }),
      makeTicket({ id: "child-a", title: "Child A", parent: "epic" }),
      makeTicket({ id: "child-b", title: "Child B", parent: "epic" }),
      makeTicket({ id: "standalone", title: "Standalone" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);

    // Should have 2 items: 1 epic + 1 standalone
    expect(state.items).toHaveLength(2);
    expect(state.items[0].kind).toBe("epic");
    expect(state.items[0].id).toBe("epic");
    expect(state.items[0].childIds).toEqual(["child-a", "child-b"]);
    expect(state.items[1].kind).toBe("ticket");
    expect(state.items[1].id).toBe("standalone");
  });

  it("selects all children by default for epics", () => {
    const tickets = [
      makeTicket({ id: "epic", title: "Epic" }),
      makeTicket({ id: "c1", title: "C1", parent: "epic" }),
      makeTicket({ id: "c2", title: "C2", parent: "epic" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);

    expect(state.selectedIds.has("c1")).toBe(true);
    expect(state.selectedIds.has("c2")).toBe(true);
    // Parent itself is not in selectedIds (it's a group header)
    expect(state.selectedIds.has("epic")).toBe(false);
  });

  it("excludes closed/deferred tickets", () => {
    const tickets = [
      makeTicket({ id: "open", title: "Open", status: "open" }),
      makeTicket({ id: "closed", title: "Closed", status: "closed" }),
      makeTicket({ id: "deferred", title: "Deferred", status: "deferred" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);

    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe("open");
  });

  it("sorts epics before standalone tickets", () => {
    const tickets = [
      makeTicket({ id: "standalone", title: "Solo", priority: 1 }),
      makeTicket({ id: "epic", title: "Epic", priority: 2 }),
      makeTicket({ id: "child", title: "Child", parent: "epic" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);

    expect(state.items[0].kind).toBe("epic");
    expect(state.items[1].kind).toBe("ticket");
  });
});

describe("toggleItem", () => {
  it("toggles a standalone ticket off", () => {
    const tickets = [
      makeTicket({ id: "a", title: "A" }),
      makeTicket({ id: "b", title: "B" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);

    expect(state.selectedIds.has("a")).toBe(true);
    toggleItem(state); // cursor at 0 = "a"
    expect(state.selectedIds.has("a")).toBe(false);
    expect(state.selectedIds.has("b")).toBe(true);
  });

  it("toggles a standalone ticket on", () => {
    const tickets = [makeTicket({ id: "a", title: "A" })];
    const state = createTicketScopePickerState("proj", tickets);

    toggleItem(state); // deselect
    expect(state.selectedIds.has("a")).toBe(false);
    toggleItem(state); // reselect
    expect(state.selectedIds.has("a")).toBe(true);
  });

  it("toggles all epic children off when all selected", () => {
    const tickets = [
      makeTicket({ id: "epic", title: "Epic" }),
      makeTicket({ id: "c1", title: "C1", parent: "epic" }),
      makeTicket({ id: "c2", title: "C2", parent: "epic" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);

    // All children selected by default
    expect(state.selectedIds.has("c1")).toBe(true);
    expect(state.selectedIds.has("c2")).toBe(true);

    toggleItem(state); // cursor at 0 = epic → deselect all children
    expect(state.selectedIds.has("c1")).toBe(false);
    expect(state.selectedIds.has("c2")).toBe(false);
  });

  it("selects all epic children when some are deselected (partial → all)", () => {
    const tickets = [
      makeTicket({ id: "epic", title: "Epic" }),
      makeTicket({ id: "c1", title: "C1", parent: "epic" }),
      makeTicket({ id: "c2", title: "C2", parent: "epic" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);

    // Deselect one child manually
    state.selectedIds.delete("c1");

    toggleItem(state); // partial → all
    expect(state.selectedIds.has("c1")).toBe(true);
    expect(state.selectedIds.has("c2")).toBe(true);
  });
});

describe("selectAll / selectNone", () => {
  it("selectAll adds all ticket IDs", () => {
    const tickets = [
      makeTicket({ id: "epic", title: "Epic" }),
      makeTicket({ id: "c1", title: "C1", parent: "epic" }),
      makeTicket({ id: "solo", title: "Solo" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);
    selectNone(state);
    expect(state.selectedIds.size).toBe(0);

    selectAll(state);
    expect(state.selectedIds.has("c1")).toBe(true);
    expect(state.selectedIds.has("solo")).toBe(true);
  });

  it("selectNone clears all selections", () => {
    const tickets = [
      makeTicket({ id: "a", title: "A" }),
      makeTicket({ id: "b", title: "B" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);
    expect(state.selectedIds.size).toBe(2);

    selectNone(state);
    expect(state.selectedIds.size).toBe(0);
  });
});

describe("getSelectedTicketIds", () => {
  it("returns selected child and standalone IDs", () => {
    const tickets = [
      makeTicket({ id: "epic", title: "Epic" }),
      makeTicket({ id: "c1", title: "C1", parent: "epic" }),
      makeTicket({ id: "solo", title: "Solo" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);
    const ids = getSelectedTicketIds(state);

    expect(ids).toContain("c1");
    expect(ids).toContain("solo");
  });

  it("includes parent epic ID when children are selected", () => {
    const tickets = [
      makeTicket({ id: "epic", title: "Epic" }),
      makeTicket({ id: "c1", title: "C1", parent: "epic" }),
      makeTicket({ id: "c2", title: "C2", parent: "epic" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);
    const ids = getSelectedTicketIds(state);

    // Parent should be included so findParentTicketIds works
    expect(ids).toContain("epic");
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
  });

  it("does not include parent when no children are selected", () => {
    const tickets = [
      makeTicket({ id: "epic", title: "Epic" }),
      makeTicket({ id: "c1", title: "C1", parent: "epic" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);
    selectNone(state);
    const ids = getSelectedTicketIds(state);

    expect(ids).not.toContain("epic");
    expect(ids).toHaveLength(0);
  });
});

describe("navigation", () => {
  it("moveDown increments selectedIndex", () => {
    const tickets = [
      makeTicket({ id: "a", title: "A" }),
      makeTicket({ id: "b", title: "B" }),
      makeTicket({ id: "c", title: "C" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);
    expect(state.selectedIndex).toBe(0);

    moveDown(state);
    expect(state.selectedIndex).toBe(1);
    moveDown(state);
    expect(state.selectedIndex).toBe(2);
  });

  it("moveDown does not exceed bounds", () => {
    const tickets = [makeTicket({ id: "a", title: "A" })];
    const state = createTicketScopePickerState("proj", tickets);

    moveDown(state);
    expect(state.selectedIndex).toBe(0);
  });

  it("moveUp decrements selectedIndex", () => {
    const tickets = [
      makeTicket({ id: "a", title: "A" }),
      makeTicket({ id: "b", title: "B" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);
    state.selectedIndex = 1;

    moveUp(state);
    expect(state.selectedIndex).toBe(0);
  });

  it("moveUp does not go below 0", () => {
    const tickets = [makeTicket({ id: "a", title: "A" })];
    const state = createTicketScopePickerState("proj", tickets);

    moveUp(state);
    expect(state.selectedIndex).toBe(0);
  });
});

describe("display lines", () => {
  it("includes header and selected count", () => {
    const tickets = [
      makeTicket({ id: "a", title: "A" }),
      makeTicket({ id: "b", title: "B" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);

    const hasHeader = state.displayLines.some((l) => l.includes("Select Tickets"));
    const hasCount = state.displayLines.some((l) => l.includes("2 of 2"));
    expect(hasHeader).toBe(true);
    expect(hasCount).toBe(true);
  });

  it("shows ticket IDs", () => {
    const tickets = [
      makeTicket({ id: "my-feature", title: "My Feature" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);

    const hasId = state.displayLines.some((l) => l.includes("my-feature"));
    expect(hasId).toBe(true);
  });

  it("shows epic title with child count", () => {
    const tickets = [
      makeTicket({ id: "epic", title: "My Epic" }),
      makeTicket({ id: "c1", title: "C1", parent: "epic" }),
      makeTicket({ id: "c2", title: "C2", parent: "epic" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);

    const hasEpic = state.displayLines.some((l) => l.includes("My Epic") && l.includes("2 children"));
    expect(hasEpic).toBe(true);
  });

  it("updates count after selectNone", () => {
    const tickets = [
      makeTicket({ id: "a", title: "A" }),
      makeTicket({ id: "b", title: "B" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);
    selectNone(state);

    const hasZero = state.displayLines.some((l) => l.includes("0 of 2"));
    expect(hasZero).toBe(true);
  });

  it("shows key hints", () => {
    const tickets = [makeTicket({ id: "a", title: "A" })];
    const state = createTicketScopePickerState("proj", tickets);

    const hasKeys = state.displayLines.some((l) => l.includes("Space:toggle") && l.includes("Enter:confirm"));
    expect(hasKeys).toBe(true);
  });
});

describe("scroll helpers", () => {
  it("scrollUp decreases offset", () => {
    const tickets = [makeTicket({ id: "a", title: "A" })];
    const state = createTicketScopePickerState("proj", tickets);
    state.scrollOffset = 5;

    scrollUp(state, 2);
    expect(state.scrollOffset).toBe(3);
  });

  it("scrollUp does not go below 0", () => {
    const tickets = [makeTicket({ id: "a", title: "A" })];
    const state = createTicketScopePickerState("proj", tickets);
    state.scrollOffset = 1;

    scrollUp(state, 5);
    expect(state.scrollOffset).toBe(0);
  });

  it("scrollDown increases offset up to max", () => {
    const tickets = [makeTicket({ id: "a", title: "A" })];
    const state = createTicketScopePickerState("proj", tickets);

    scrollDown(state, 100, 5);
    expect(state.scrollOffset).toBe(Math.max(0, state.displayLines.length - 5));
  });

  it("scrollToTop resets to 0 and cursor to 0", () => {
    const tickets = [
      makeTicket({ id: "a", title: "A" }),
      makeTicket({ id: "b", title: "B" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);
    state.scrollOffset = 5;
    state.selectedIndex = 1;

    scrollToTop(state);
    expect(state.scrollOffset).toBe(0);
    expect(state.selectedIndex).toBe(0);
  });

  it("scrollToBottom moves cursor to last item", () => {
    const tickets = [
      makeTicket({ id: "a", title: "A" }),
      makeTicket({ id: "b", title: "B" }),
      makeTicket({ id: "c", title: "C" }),
    ];
    const state = createTicketScopePickerState("proj", tickets);

    scrollToBottom(state, 5);
    expect(state.selectedIndex).toBe(2);
  });
});
