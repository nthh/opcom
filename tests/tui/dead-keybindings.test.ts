import { describe, it, expect } from "vitest";
import { buildHelpLines } from "../../packages/cli/src/tui/app.js";
import { stripAnsi } from "../../packages/cli/src/tui/renderer.js";

describe("dead keybindings removed", () => {
  const lines = buildHelpLines();
  const plain = lines.map(stripAnsi);

  it("L2 help does not list g for git log", () => {
    // Find lines between "Level 2: Project Detail" and the next "Level 3" header
    const l2Start = plain.findIndex((l) => l.includes("Level 2: Project Detail"));
    const l3Start = plain.findIndex((l, i) => i > l2Start && l.includes("Level 3"));
    const l2Lines = plain.slice(l2Start, l3Start);
    expect(l2Lines.some((l) => /\bg\b/.test(l) && /git/i.test(l))).toBe(false);
  });

  it("L3 Agent Focus help does not list m for merge", () => {
    const l3Start = plain.findIndex((l) => l.includes("Level 3: Agent Focus"));
    const nextSection = plain.findIndex((l, i) => i > l3Start && l.startsWith("Level 3:"));
    const agentLines = plain.slice(l3Start, nextSection);
    expect(agentLines.some((l) => /\bm\b/.test(l) && /merge/i.test(l))).toBe(false);
  });

  it("L3 Agent Focus help still lists g for jump to top", () => {
    const l3Start = plain.findIndex((l) => l.includes("Level 3: Agent Focus"));
    const nextSection = plain.findIndex((l, i) => i > l3Start && l.startsWith("Level 3:"));
    const agentLines = plain.slice(l3Start, nextSection);
    expect(agentLines.some((l) => l.includes("g") && l.includes("Jump to top"))).toBe(true);
  });

  it("L2 help does not list d for dev services", () => {
    const l2Start = plain.findIndex((l) => l.includes("Level 2: Project Detail"));
    const l3Start = plain.findIndex((l, i) => i > l2Start && l.includes("Level 3"));
    const l2Lines = plain.slice(l2Start, l3Start);
    expect(l2Lines.some((l) => /\bd\b/.test(l) && /dev/i.test(l))).toBe(false);
  });

  it("L1 help still lists d for deploy history", () => {
    const l1Start = plain.findIndex((l) => l.includes("Level 1: Dashboard"));
    const l2Start = plain.findIndex((l) => l.includes("Level 2: Project Detail"));
    const l1Lines = plain.slice(l1Start, l2Start);
    expect(l1Lines.some((l) => l.includes("d") && l.includes("deploy"))).toBe(true);
  });
});
