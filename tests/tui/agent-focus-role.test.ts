import { describe, it, expect } from "vitest";
import type { AgentSession, NormalizedEvent, RoleDefinition } from "@opcom/types";
import {
  createAgentFocusState,
  buildRoleSummary,
  buildRoleDetailLines,
  type AgentFocusState,
} from "../../packages/cli/src/tui/views/agent-focus.js";

function makeAgent(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "agent-abc123def456",
    backend: "claude-code",
    projectId: "my-project",
    state: "streaming",
    startedAt: new Date().toISOString(),
    workItemId: "ticket-1",
    ...overrides,
  } as AgentSession;
}

function makeRole(overrides: Partial<RoleDefinition> = {}): RoleDefinition {
  return {
    id: "engineer",
    name: "Engineer",
    permissionMode: "acceptEdits",
    disallowedTools: ["EnterPlanMode", "ExitPlanMode", "EnterWorktree"],
    instructions: "- All changes MUST include tests.\n- Commit completed work.",
    doneCriteria: "Code committed. Relevant tests passing.",
    runTests: true,
    runOracle: null,
    ...overrides,
  };
}

describe("agent-focus role display", () => {
  describe("createAgentFocusState", () => {
    it("initializes with null role when none provided", () => {
      const state = createAgentFocusState(makeAgent(), []);
      expect(state.role).toBeNull();
      expect(state.showRoleDetail).toBe(false);
    });

    it("stores role when provided", () => {
      const role = makeRole();
      const state = createAgentFocusState(makeAgent(), [], role);
      expect(state.role).toBe(role);
      expect(state.role!.id).toBe("engineer");
      expect(state.showRoleDetail).toBe(false);
    });

    it("stores null role when explicitly passed null", () => {
      const state = createAgentFocusState(makeAgent(), [], null);
      expect(state.role).toBeNull();
    });
  });

  describe("buildRoleSummary", () => {
    it("includes permission mode and done criteria", () => {
      const role = makeRole();
      const summary = buildRoleSummary(role);
      expect(summary).toContain("acceptEdits");
      expect(summary).toContain("Code committed. Relevant tests passing.");
    });

    it("truncates long done criteria", () => {
      const role = makeRole({
        doneCriteria: "A".repeat(60),
      });
      const summary = buildRoleSummary(role);
      expect(summary).toContain("...");
      // The truncated part should be 50 chars max (47 + "...")
      expect(summary.length).toBeLessThan(70);
    });

    it("shows only permission mode when no done criteria", () => {
      const role = makeRole({ doneCriteria: undefined });
      const summary = buildRoleSummary(role);
      expect(summary).toBe("acceptEdits");
    });

    it("uses default permission mode when not set", () => {
      const role = makeRole({ permissionMode: undefined });
      const summary = buildRoleSummary(role);
      expect(summary).toContain("acceptEdits");
    });
  });

  describe("buildRoleDetailLines", () => {
    it("includes role name as title", () => {
      const role = makeRole();
      const lines = buildRoleDetailLines(role);
      expect(lines[0]).toBe("Role: Engineer");
    });

    it("includes separator line", () => {
      const role = makeRole();
      const lines = buildRoleDetailLines(role);
      expect(lines[1]).toMatch(/^─+$/);
    });

    it("includes permission mode", () => {
      const role = makeRole();
      const lines = buildRoleDetailLines(role);
      const permLine = lines.find((l) => l.includes("Permission mode:"));
      expect(permLine).toBeDefined();
      expect(permLine).toContain("acceptEdits");
    });

    it("includes disallowed tools", () => {
      const role = makeRole();
      const lines = buildRoleDetailLines(role);
      const toolsLine = lines.find((l) => l.includes("Disallowed tools:"));
      expect(toolsLine).toBeDefined();
      expect(toolsLine).toContain("EnterPlanMode");
    });

    it("includes done criteria", () => {
      const role = makeRole();
      const lines = buildRoleDetailLines(role);
      const doneLine = lines.find((l) => l.includes("Done criteria:"));
      expect(doneLine).toBeDefined();
      expect(doneLine).toContain("Code committed");
    });

    it("includes instructions", () => {
      const role = makeRole();
      const lines = buildRoleDetailLines(role);
      const instrIdx = lines.findIndex((l) => l.includes("Instructions:"));
      expect(instrIdx).toBeGreaterThan(-1);
      // Instructions should be indented below
      expect(lines[instrIdx + 1]).toContain("All changes MUST include tests");
    });

    it("includes run tests and run oracle", () => {
      const role = makeRole();
      const lines = buildRoleDetailLines(role);
      const testLine = lines.find((l) => l.includes("Run tests:"));
      expect(testLine).toContain("true");
      const oracleLine = lines.find((l) => l.includes("Run oracle:"));
      expect(oracleLine).toContain("inherit");
    });

    it("omits allowed tools when empty", () => {
      const role = makeRole({ allowedTools: [] });
      const lines = buildRoleDetailLines(role);
      const allowedLine = lines.find((l) => l.includes("Allowed tools:"));
      expect(allowedLine).toBeUndefined();
    });

    it("shows allowed tools when present", () => {
      const role = makeRole({ allowedTools: ["Read", "Grep"] });
      const lines = buildRoleDetailLines(role);
      const allowedLine = lines.find((l) => l.includes("Allowed tools:"));
      expect(allowedLine).toBeDefined();
      expect(allowedLine).toContain("Read, Grep");
    });

    it("shows bash patterns when present", () => {
      const role = makeRole({
        allowedBashPatterns: ["git log*", "git diff*"],
      });
      const lines = buildRoleDetailLines(role);
      const bashLine = lines.find((l) => l.includes("Bash patterns:"));
      expect(bashLine).toBeDefined();
      expect(bashLine).toContain("git log*");
    });

    it("omits bash patterns when empty", () => {
      const role = makeRole({ allowedBashPatterns: [] });
      const lines = buildRoleDetailLines(role);
      const bashLine = lines.find((l) => l.includes("Bash patterns:"));
      expect(bashLine).toBeUndefined();
    });

    it("shows skills when present", () => {
      const role = makeRole({ skills: ["code-review", "test-writing"] });
      const lines = buildRoleDetailLines(role);
      const skillsLine = lines.find((l) => l.includes("Skills:"));
      expect(skillsLine).toBeDefined();
      expect(skillsLine).toContain("code-review, test-writing");
    });

    it("uses id as title when name is missing", () => {
      const role = makeRole({ name: undefined });
      const lines = buildRoleDetailLines(role);
      expect(lines[0]).toBe("Role: engineer");
    });

    it("ends with empty line", () => {
      const role = makeRole();
      const lines = buildRoleDetailLines(role);
      expect(lines[lines.length - 1]).toBe("");
    });

    it("handles reviewer role with read-only config", () => {
      const role: RoleDefinition = {
        id: "reviewer",
        name: "Reviewer",
        permissionMode: "default",
        disallowedTools: ["Edit", "Write", "NotebookEdit"],
        allowedBashPatterns: ["git log*", "git diff*", "git show*"],
        instructions: "- Review the code changes.\n- Do NOT modify any files.",
        doneCriteria: "Review report written to stdout.",
        runTests: false,
        runOracle: false,
      };
      const lines = buildRoleDetailLines(role);
      expect(lines.find((l) => l.includes("Permission mode:"))).toContain("default");
      expect(lines.find((l) => l.includes("Run tests:"))).toContain("false");
      expect(lines.find((l) => l.includes("Run oracle:"))).toContain("false");
      expect(lines.find((l) => l.includes("Bash patterns:"))).toContain("git log*");
    });
  });

  describe("showRoleDetail toggle", () => {
    it("toggles showRoleDetail state", () => {
      const role = makeRole();
      const state = createAgentFocusState(makeAgent(), [], role);
      expect(state.showRoleDetail).toBe(false);
      state.showRoleDetail = true;
      expect(state.showRoleDetail).toBe(true);
      state.showRoleDetail = false;
      expect(state.showRoleDetail).toBe(false);
    });
  });
});
