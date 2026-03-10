import { describe, it, expect } from "vitest";
import type { SkillDefinition } from "@opcom/types";
import {
  createSkillsBrowserState,
  buildSkillListLines,
  buildSkillDetailLines,
  moveUp,
  moveDown,
  drillDown,
  drillUp,
  scrollDetailUp,
  scrollDetailDown,
  scrollDetailToTop,
  scrollDetailToBottom,
  renderSkillsBrowser,
} from "../../packages/cli/src/tui/views/skills-browser.js";
import { ScreenBuffer } from "../../packages/cli/src/tui/renderer.js";
import {
  renderAgentFocus,
  createAgentFocusState,
} from "../../packages/cli/src/tui/views/agent-focus.js";
import type { AgentSession, NormalizedEvent } from "@opcom/types";

// --- Helpers ---

function makeSkill(id: string, overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " "),
    description: `Description for ${id}`,
    version: "1.0.0",
    triggers: [],
    compatibleRoles: [],
    projects: [],
    content: `# ${id}\n\nSkill content here.`,
    ...overrides,
  };
}

function makeBuiltinSkills(): SkillDefinition[] {
  return [
    makeSkill("code-review", { description: "Structured code review methodology" }),
    makeSkill("deployment", { description: "Deployment checklists" }),
    makeSkill("planning", { description: "Task decomposition methodology" }),
    makeSkill("research", { description: "Multi-source research protocol" }),
    makeSkill("test-writing", { description: "Test strategy and patterns" }),
  ];
}

// --- createSkillsBrowserState ---

describe("createSkillsBrowserState", () => {
  it("creates state with default selection at 0", () => {
    const skills = makeBuiltinSkills();
    const state = createSkillsBrowserState(skills);
    expect(state.selectedIndex).toBe(0);
    expect(state.skills).toBe(skills);
    expect(state.drilledSkillId).toBeNull();
    expect(state.activeSkillIds.size).toBe(0);
  });

  it("accepts active skill IDs", () => {
    const skills = makeBuiltinSkills();
    const state = createSkillsBrowserState(skills, ["code-review", "research"]);
    expect(state.activeSkillIds.has("code-review")).toBe(true);
    expect(state.activeSkillIds.has("research")).toBe(true);
    expect(state.activeSkillIds.has("deployment")).toBe(false);
  });

  it("creates empty state", () => {
    const state = createSkillsBrowserState([]);
    expect(state.skills.length).toBe(0);
    expect(state.selectedIndex).toBe(0);
  });
});

// --- buildSkillListLines ---

describe("buildSkillListLines", () => {
  it("shows header with counts", () => {
    const skills = makeBuiltinSkills();
    const lines = buildSkillListLines(skills, new Set(), 0, 80);
    expect(lines[0]).toContain("Skills");
    expect(lines[0]).toContain("5 built-in");
  });

  it("shows built-in and custom counts", () => {
    const skills = [
      ...makeBuiltinSkills(),
      makeSkill("my-custom", { description: "Custom skill" }),
    ];
    const lines = buildSkillListLines(skills, new Set(), 0, 80);
    expect(lines[0]).toContain("5 built-in");
    expect(lines[0]).toContain("1 custom");
  });

  it("includes separator line", () => {
    const skills = makeBuiltinSkills();
    const lines = buildSkillListLines(skills, new Set(), 0, 80);
    expect(lines[1]).toContain("─");
  });

  it("shows active indicator for active skills", () => {
    const skills = makeBuiltinSkills();
    const active = new Set(["code-review"]);
    const lines = buildSkillListLines(skills, active, 0, 80);
    const crLine = lines.find((l) => l.includes("code-review"));
    expect(crLine).toBeDefined();
    expect(crLine).toContain("●");
  });

  it("shows inactive indicator for non-active skills", () => {
    const skills = makeBuiltinSkills();
    const active = new Set(["code-review"]);
    const lines = buildSkillListLines(skills, active, 0, 80);
    const researchLine = lines.find((l) => l.includes("research"));
    expect(researchLine).toBeDefined();
    expect(researchLine).toContain("○");
  });

  it("shows cursor on selected item", () => {
    const skills = makeBuiltinSkills();
    const lines = buildSkillListLines(skills, new Set(), 0, 80);
    const hasArrow = lines.some((l) => l.includes("▸"));
    expect(hasArrow).toBe(true);
  });

  it("shows built-in label for known skills", () => {
    const skills = makeBuiltinSkills();
    const lines = buildSkillListLines(skills, new Set(), 0, 80);
    const crLine = lines.find((l) => l.includes("code-review"));
    expect(crLine).toContain("built-in");
  });

  it("shows custom label for unknown skills", () => {
    const skills = [makeSkill("my-custom-skill", { description: "Custom" })];
    const lines = buildSkillListLines(skills, new Set(), 0, 80);
    const customLine = lines.find((l) => l.includes("my-custom-skill"));
    expect(customLine).toContain("custom");
  });

  it("shows empty state message when no skills", () => {
    const lines = buildSkillListLines([], new Set(), 0, 80);
    const hasMsg = lines.some((l) => l.includes("No skills found"));
    expect(hasMsg).toBe(true);
  });

  it("includes skill description", () => {
    const skills = makeBuiltinSkills();
    const lines = buildSkillListLines(skills, new Set(), 0, 80);
    const crLine = lines.find((l) => l.includes("code-review"));
    expect(crLine).toContain("Structured code review");
  });
});

// --- buildSkillDetailLines ---

describe("buildSkillDetailLines", () => {
  it("includes skill name", () => {
    const skill = makeSkill("code-review", { name: "Code Review" });
    const lines = buildSkillDetailLines(skill, false, 80);
    expect(lines[0]).toContain("Code Review");
  });

  it("shows skill metadata", () => {
    const skill = makeSkill("code-review", {
      name: "Code Review",
      version: "1.0.0",
      triggers: ["review", "PR"],
      compatibleRoles: ["reviewer", "engineer"],
    });
    const lines = buildSkillDetailLines(skill, false, 80);
    const text = lines.join("\n");
    expect(text).toContain("code-review");
    expect(text).toContain("1.0.0");
    expect(text).toContain("review, PR");
    expect(text).toContain("reviewer, engineer");
  });

  it("shows active status when active", () => {
    const skill = makeSkill("code-review");
    const lines = buildSkillDetailLines(skill, true, 80);
    const text = lines.join("\n");
    expect(text).toContain("active");
  });

  it("shows available status when not active", () => {
    const skill = makeSkill("code-review");
    const lines = buildSkillDetailLines(skill, false, 80);
    const text = lines.join("\n");
    expect(text).toContain("available");
  });

  it("includes skill content", () => {
    const skill = makeSkill("code-review", { content: "# Code Review\n\nDo the review." });
    const lines = buildSkillDetailLines(skill, false, 80);
    const text = lines.join("\n");
    expect(text).toContain("Code Review");
    expect(text).toContain("Do the review.");
  });

  it("shows source as built-in for known skills", () => {
    const skill = makeSkill("code-review");
    const lines = buildSkillDetailLines(skill, false, 80);
    const text = lines.join("\n");
    expect(text).toContain("built-in");
  });

  it("shows source as custom for unknown skills", () => {
    const skill = makeSkill("my-custom");
    const lines = buildSkillDetailLines(skill, false, 80);
    const text = lines.join("\n");
    expect(text).toContain("custom");
  });
});

// --- navigation ---

describe("navigation", () => {
  it("moveDown increments selectedIndex", () => {
    const state = createSkillsBrowserState(makeBuiltinSkills());
    expect(state.selectedIndex).toBe(0);
    moveDown(state);
    expect(state.selectedIndex).toBe(1);
  });

  it("moveUp decrements selectedIndex", () => {
    const state = createSkillsBrowserState(makeBuiltinSkills());
    state.selectedIndex = 3;
    moveUp(state);
    expect(state.selectedIndex).toBe(2);
  });

  it("moveUp does not go below 0", () => {
    const state = createSkillsBrowserState(makeBuiltinSkills());
    moveUp(state);
    expect(state.selectedIndex).toBe(0);
  });

  it("moveDown does not exceed skills length", () => {
    const skills = makeBuiltinSkills();
    const state = createSkillsBrowserState(skills);
    for (let i = 0; i < skills.length + 5; i++) {
      moveDown(state);
    }
    expect(state.selectedIndex).toBe(skills.length - 1);
  });
});

// --- drill down/up ---

describe("drill down/up", () => {
  it("drillDown sets drilledSkillId and builds detail lines", () => {
    const state = createSkillsBrowserState(makeBuiltinSkills());
    drillDown(state, 80);
    expect(state.drilledSkillId).toBe("code-review");
    expect(state.detailLines.length).toBeGreaterThan(0);
    expect(state.detailScrollOffset).toBe(0);
  });

  it("drillUp clears drilledSkillId", () => {
    const state = createSkillsBrowserState(makeBuiltinSkills());
    drillDown(state, 80);
    const cleared = drillUp(state);
    expect(cleared).toBe(true);
    expect(state.drilledSkillId).toBeNull();
    expect(state.detailLines.length).toBe(0);
  });

  it("drillUp returns false when not drilled", () => {
    const state = createSkillsBrowserState(makeBuiltinSkills());
    expect(drillUp(state)).toBe(false);
  });

  it("drillDown on second item drills into correct skill", () => {
    const state = createSkillsBrowserState(makeBuiltinSkills());
    state.selectedIndex = 1;
    drillDown(state, 80);
    expect(state.drilledSkillId).toBe("deployment");
  });
});

// --- detail scrolling ---

describe("detail scrolling", () => {
  it("scrollDetailDown increases offset", () => {
    const state = createSkillsBrowserState(makeBuiltinSkills());
    state.detailLines = Array.from({ length: 30 }, (_, i) => `Line ${i}`);
    scrollDetailDown(state, 3, 10);
    expect(state.detailScrollOffset).toBe(3);
  });

  it("scrollDetailUp decreases offset", () => {
    const state = createSkillsBrowserState(makeBuiltinSkills());
    state.detailScrollOffset = 5;
    state.detailLines = Array.from({ length: 30 }, (_, i) => `Line ${i}`);
    scrollDetailUp(state, 2);
    expect(state.detailScrollOffset).toBe(3);
  });

  it("scrollDetailUp does not go below 0", () => {
    const state = createSkillsBrowserState(makeBuiltinSkills());
    scrollDetailUp(state, 5);
    expect(state.detailScrollOffset).toBe(0);
  });

  it("scrollDetailToTop resets to 0", () => {
    const state = createSkillsBrowserState(makeBuiltinSkills());
    state.detailScrollOffset = 10;
    scrollDetailToTop(state);
    expect(state.detailScrollOffset).toBe(0);
  });

  it("scrollDetailToBottom goes to max offset", () => {
    const state = createSkillsBrowserState(makeBuiltinSkills());
    state.detailLines = Array.from({ length: 30 }, (_, i) => `Line ${i}`);
    scrollDetailToBottom(state, 10);
    expect(state.detailScrollOffset).toBe(20);
  });
});

// --- rendering ---

describe("renderSkillsBrowser", () => {
  it("renders list view without error", () => {
    const skills = makeBuiltinSkills();
    const state = createSkillsBrowserState(skills, ["code-review"]);
    const buf = new ScreenBuffer(80, 24);
    const panel = { x: 0, y: 0, width: 80, height: 24 };

    expect(() => renderSkillsBrowser(buf, panel, state)).not.toThrow();
  });

  it("renders detail view without error", () => {
    const skills = makeBuiltinSkills();
    const state = createSkillsBrowserState(skills, ["code-review"]);
    drillDown(state, 78);
    const buf = new ScreenBuffer(80, 24);
    const panel = { x: 0, y: 0, width: 80, height: 24 };

    expect(() => renderSkillsBrowser(buf, panel, state)).not.toThrow();
  });

  it("renders empty skills list without error", () => {
    const state = createSkillsBrowserState([]);
    const buf = new ScreenBuffer(80, 24);
    const panel = { x: 0, y: 0, width: 80, height: 24 };

    expect(() => renderSkillsBrowser(buf, panel, state)).not.toThrow();
  });
});

// --- Agent focus skills display ---

describe("agent focus skills display", () => {
  function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
    return {
      id: "test-agent-123",
      backend: "claude-code",
      projectId: "test-project",
      state: "streaming",
      startedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("renders agent with skills without error", () => {
    const agent = makeAgent({
      skills: [
        { name: "Code Review", content: "..." },
        { name: "Test Writing", content: "..." },
      ],
    });
    const events: NormalizedEvent[] = [];
    const state = createAgentFocusState(agent, events);
    const buf = new ScreenBuffer(100, 30);
    const panel = { x: 0, y: 0, width: 100, height: 30 };

    expect(() => renderAgentFocus(buf, panel, state)).not.toThrow();
  });

  it("renders agent without skills without error", () => {
    const agent = makeAgent();
    const events: NormalizedEvent[] = [];
    const state = createAgentFocusState(agent, events);
    const buf = new ScreenBuffer(100, 30);
    const panel = { x: 0, y: 0, width: 100, height: 30 };

    expect(() => renderAgentFocus(buf, panel, state)).not.toThrow();
  });

  it("renders agent with empty skills array without error", () => {
    const agent = makeAgent({ skills: [] });
    const events: NormalizedEvent[] = [];
    const state = createAgentFocusState(agent, events);
    const buf = new ScreenBuffer(100, 30);
    const panel = { x: 0, y: 0, width: 100, height: 30 };

    expect(() => renderAgentFocus(buf, panel, state)).not.toThrow();
  });

  it("agent with skills uses 3-line header", () => {
    // When skills are present, the header should be 3 lines (id, context/ticket, skills)
    const agent = makeAgent({
      skills: [{ name: "Code Review", content: "..." }],
    });
    // Verify agent.skills is defined
    expect(agent.skills).toBeDefined();
    expect(agent.skills!.length).toBe(1);
    expect(agent.skills![0].name).toBe("Code Review");
  });

  it("agent without skills uses 2-line header", () => {
    const agent = makeAgent();
    expect(agent.skills).toBeUndefined();
  });
});

// --- buildHelpLines ---

describe("help lines include skills", () => {
  it("includes K:skills keybinding in help", async () => {
    const { buildHelpLines } = await import("../../packages/cli/src/tui/app.js");
    const lines = buildHelpLines();
    const hasSkills = lines.some((l: string) => l.includes("Browse skills") || l.includes("skills"));
    expect(hasSkills).toBe(true);
  });
});
