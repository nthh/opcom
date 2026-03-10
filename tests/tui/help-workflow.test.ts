import { describe, it, expect } from "vitest";
import { buildHelpLines } from "../../packages/cli/src/tui/app.js";
import { stripAnsi } from "../../packages/cli/src/tui/renderer.js";

describe("buildHelpLines", () => {
  const lines = buildHelpLines();
  const plain = lines.map(stripAnsi);

  /** Get all plain lines between two section headers (exclusive) */
  function sectionLines(header: string): string[] {
    const start = plain.findIndex((l) => l === header);
    if (start === -1) return [];
    const end = plain.findIndex((l, i) => i > start && l !== "" && !l.startsWith("  ") && l !== header);
    return plain.slice(start + 1, end === -1 ? plain.length : end).filter((l) => l.startsWith("  "));
  }

  /** Extract key names from help lines like "  j/k        Navigate" → ["j/k"] */
  function extractKeys(sectionHeader: string): string[] {
    return sectionLines(sectionHeader)
      .map((l) => l.trim().split(/\s{2,}/)[0])
      .filter(Boolean);
  }

  // --- Workflow section ---

  it("includes Workflow section header", () => {
    expect(plain.some((l) => l.includes("Workflow"))).toBe(true);
  });

  it("shows 4 workflow steps in order", () => {
    const stepLines = plain.filter((l) => /^\s+\d\.\s/.test(l));
    expect(stepLines).toHaveLength(4);
    expect(stepLines[0]).toContain("Write spec");
    expect(stepLines[1]).toContain("Scaffold tickets");
    expect(stepLines[2]).toContain("Check health");
    expect(stepLines[3]).toContain("Assign agents");
  });

  it("health step mentions use cases (consolidated from separate U key)", () => {
    const healthLine = plain.find((l) => l.includes("Check health"));
    expect(healthLine).toContain("H");
    expect(healthLine).toContain("use cases");
  });

  it("includes w keybinding in assign step", () => {
    const assignLine = plain.find((l) => l.includes("Assign agents"));
    expect(assignLine).toContain("w");
  });

  it("mentions spec-driven process", () => {
    expect(plain.some((l) => l.includes("Spec-driven"))).toBe(true);
  });

  it("workflow section appears before Global section", () => {
    const workflowIdx = plain.findIndex((l) => l.includes("Workflow"));
    const globalIdx = plain.findIndex((l) => l === "Global");
    expect(workflowIdx).toBeLessThan(globalIdx);
  });

  // --- Section headers ---

  it("includes all expected section headers", () => {
    const expectedHeaders = [
      "Global",
      "Level 1: Dashboard",
      "Level 2: Project Detail",
      "Level 3: Agent Focus",
      "Level 3: Ticket Focus",
      "Level 3: Cloud Service Detail",
      "Level 3: Plan Step Focus",
      "Level 3: Plan Overview",
      "Level 3: Settings",
    ];
    for (const header of expectedHeaders) {
      expect(plain.some((l) => l === header)).toBe(true);
    }
  });

  // --- Key accuracy per section (must match actual handlers) ---

  it("Global keys match handler", () => {
    const keys = extractKeys("Global");
    expect(keys).toEqual(["Esc", "q", "?", "r"]);
  });

  it("Level 1 keys match dashboard handler", () => {
    const keys = extractKeys("Level 1: Dashboard");
    expect(keys).toEqual([
      "j/k", "Tab", "Enter", "w", "c", "C", "s", "S",
      "/", "f", "F", "1-4", "d", "H", "[/]", "O", "P",
    ]);
  });

  it("Level 2 keys match project detail handler", () => {
    const keys = extractKeys("Level 2: Project Detail");
    expect(keys).toEqual([
      "j/k", "Tab", "Enter", "w", "c", "C", "v", "M", "P",
    ]);
  });

  it("Level 3 Agent Focus keys match handler", () => {
    const keys = extractKeys("Level 3: Agent Focus");
    expect(keys).toEqual(["j/k", "G", "g", "p", "S", "n/N"]);
  });

  it("Level 3 Ticket Focus keys match handler", () => {
    const keys = extractKeys("Level 3: Ticket Focus");
    expect(keys).toEqual(["j/k", "G", "g", "w", "C", "e"]);
  });

  it("Level 3 Cloud Service Detail keys match handler", () => {
    const keys = extractKeys("Level 3: Cloud Service Detail");
    expect(keys).toEqual(["j/k", "G", "g", "M", "D", "o"]);
  });

  it("Level 3 Plan Step Focus keys match handler", () => {
    const keys = extractKeys("Level 3: Plan Step Focus");
    expect(keys).toEqual(["j/k", "G", "g", "w", "a", "t", "o", "y/n"]);
  });

  it("Level 3 Plan Overview keys match handler", () => {
    const keys = extractKeys("Level 3: Plan Overview");
    expect(keys).toEqual([
      "j/k", "G", "g", "e", "+/-", "t", "o", "w", "Space", "Esc",
    ]);
  });

  it("Level 3 Settings keys match handler", () => {
    const keys = extractKeys("Level 3: Settings");
    expect(keys).toEqual(["j/k", "Enter", "Space", "Esc"]);
  });

  // --- No ghost keys (keys documented but not implemented) ---

  it("does not reference unimplemented U key", () => {
    // U (use cases view) was never bound — use cases are in health view (H)
    const l1Keys = extractKeys("Level 1: Dashboard");
    expect(l1Keys).not.toContain("U");
  });

  it("ticket focus does not reference unimplemented c key", () => {
    // c (chat) is not wired in ticket focus handler
    const keys = extractKeys("Level 3: Ticket Focus");
    expect(keys).not.toContain("c");
  });
});
