import { describe, it, expect } from "vitest";
import { buildHelpLines } from "../../packages/cli/src/tui/app.js";
import { stripAnsi } from "../../packages/cli/src/tui/renderer.js";

describe("buildHelpLines", () => {
  const lines = buildHelpLines();
  const plain = lines.map(stripAnsi);

  it("includes Workflow section header", () => {
    expect(plain.some((l) => l.includes("Workflow"))).toBe(true);
  });

  it("shows all 5 workflow steps in order", () => {
    const stepLines = plain.filter((l) => /^\s+\d\.\s/.test(l));
    expect(stepLines).toHaveLength(5);
    expect(stepLines[0]).toContain("Write spec");
    expect(stepLines[1]).toContain("Scaffold tickets");
    expect(stepLines[2]).toContain("Check health");
    expect(stepLines[3]).toContain("Assign agents");
    expect(stepLines[4]).toContain("Track use cases");
  });

  it("includes H keybinding in health step", () => {
    const healthLine = plain.find((l) => l.includes("Check health"));
    expect(healthLine).toContain("H");
  });

  it("includes U keybinding in use cases step", () => {
    const ucLine = plain.find((l) => l.includes("Track use cases"));
    expect(ucLine).toContain("U");
  });

  it("includes w keybinding in assign step", () => {
    const assignLine = plain.find((l) => l.includes("Assign agents"));
    expect(assignLine).toContain("w");
  });

  it("mentions spec-driven process", () => {
    expect(plain.some((l) => l.includes("Spec-driven"))).toBe(true);
  });

  it("still includes Global and Level sections", () => {
    expect(plain.some((l) => l.includes("Global"))).toBe(true);
    expect(plain.some((l) => l.includes("Level 1: Dashboard"))).toBe(true);
    expect(plain.some((l) => l.includes("Level 2: Project Detail"))).toBe(true);
    expect(plain.some((l) => l.includes("Level 3: Agent Focus"))).toBe(true);
  });

  it("workflow section appears before Global section", () => {
    const workflowIdx = plain.findIndex((l) => l.includes("Workflow"));
    const globalIdx = plain.findIndex((l) => l === "Global");
    expect(workflowIdx).toBeLessThan(globalIdx);
  });
});
