import { describe, it, expect } from "vitest";
import {
  formatBriefingPrompt,
  parseBriefingResponse,
  generateBriefing,
} from "@opcom/core";
import type { BriefingInput } from "@opcom/core";

function makeBriefingInput(
  overrides?: Partial<BriefingInput>,
): BriefingInput {
  return {
    projects: [
      {
        name: "my-app",
        gitLog: [
          "abc1234 Fix login bug",
          "def5678 Add user dashboard",
          "ghi9012 Update dependencies",
        ],
        ticketChanges: [
          {
            id: "ticket-1",
            title: "Login bug",
            oldStatus: "open",
            newStatus: "closed",
          },
          {
            id: "ticket-2",
            title: "Dashboard feature",
            oldStatus: "open",
            newStatus: "in-progress",
          },
        ],
        agentSessions: [
          {
            workItemId: "ticket-1",
            duration: "12m",
            outcome: "completed",
          },
        ],
      },
    ],
    since: "2026-02-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatBriefingPrompt", () => {
  it("includes project name and git log", () => {
    const input = makeBriefingInput();
    const prompt = formatBriefingPrompt(input);

    expect(prompt).toContain("## Project: my-app");
    expect(prompt).toContain("Fix login bug");
    expect(prompt).toContain("Add user dashboard");
    expect(prompt).toContain("Update dependencies");
  });

  it("includes ticket changes", () => {
    const input = makeBriefingInput();
    const prompt = formatBriefingPrompt(input);

    expect(prompt).toContain("ticket-1");
    expect(prompt).toContain("Login bug");
    expect(prompt).toContain("changed from open to closed");
  });

  it("includes agent sessions", () => {
    const input = makeBriefingInput();
    const prompt = formatBriefingPrompt(input);

    expect(prompt).toContain("completed");
    expect(prompt).toContain("ticket-1");
    expect(prompt).toContain("12m");
  });

  it("includes since date", () => {
    const input = makeBriefingInput();
    const prompt = formatBriefingPrompt(input);

    expect(prompt).toContain("2026-02-26");
  });

  it("handles project with no commits", () => {
    const input = makeBriefingInput({
      projects: [
        {
          name: "idle-project",
          gitLog: [],
          ticketChanges: [],
          agentSessions: [],
        },
      ],
    });
    const prompt = formatBriefingPrompt(input);

    expect(prompt).toContain("idle-project");
    expect(prompt).toContain("No commits in this period");
  });

  it("includes formatting instructions", () => {
    const input = makeBriefingInput();
    const prompt = formatBriefingPrompt(input);

    expect(prompt).toContain("## Summary");
    expect(prompt).toContain("## Highlights");
    expect(prompt).toContain("## Concerns");
  });

  it("includes hygiene issues when provided", () => {
    const input = makeBriefingInput({
      hygieneIssues: [
        {
          severity: "error",
          category: "cycle",
          ticketId: "task-a",
          message: "Part of dependency cycle: task-a → task-b → task-a",
          suggestion: "Break the cycle",
        },
        {
          severity: "warning",
          category: "stale",
          ticketId: "old-task",
          message: "Open for 30 days with no progress",
          suggestion: "Work on this ticket or defer it",
        },
      ],
    });
    const prompt = formatBriefingPrompt(input);

    expect(prompt).toContain("# Ticket Hygiene");
    expect(prompt).toContain("[error] task-a");
    expect(prompt).toContain("[warning] old-task");
    expect(prompt).toContain("dependency cycle");
    expect(prompt).toContain("30 days");
  });

  it("omits hygiene section when no issues", () => {
    const input = makeBriefingInput({ hygieneIssues: [] });
    const prompt = formatBriefingPrompt(input);

    expect(prompt).not.toContain("# Ticket Hygiene");
  });

  it("handles multiple projects", () => {
    const input = makeBriefingInput({
      projects: [
        {
          name: "project-a",
          gitLog: ["aaa Fix bug"],
          ticketChanges: [],
          agentSessions: [],
        },
        {
          name: "project-b",
          gitLog: ["bbb Add feature"],
          ticketChanges: [],
          agentSessions: [],
        },
      ],
    });
    const prompt = formatBriefingPrompt(input);

    expect(prompt).toContain("## Project: project-a");
    expect(prompt).toContain("## Project: project-b");
  });
});

describe("parseBriefingResponse", () => {
  it("parses well-formed LLM response", () => {
    const response = `## Summary
The team made good progress on the login bug fix and dashboard feature.

## Highlights
- Fixed critical login bug (ticket-1)
- Dashboard feature is now in progress
- Dependencies updated to latest versions

## Concerns
- Dashboard feature has no tests yet
- Build time increased by 30%
`;

    const briefing = parseBriefingResponse(response);

    expect(briefing.summary).toContain("good progress");
    expect(briefing.highlights).toHaveLength(3);
    expect(briefing.highlights[0]).toContain("login bug");
    expect(briefing.concerns).toHaveLength(2);
    expect(briefing.concerns[0]).toContain("no tests");
    expect(briefing.generatedAt).toBeTruthy();
  });

  it("parses response with no concerns", () => {
    const response = `## Summary
Everything looks good.

## Highlights
- All tickets resolved

## Concerns
None.
`;

    const briefing = parseBriefingResponse(response);

    expect(briefing.summary).toBe("Everything looks good.");
    expect(briefing.highlights).toHaveLength(1);
    expect(briefing.concerns).toHaveLength(0);
  });

  it("handles response without section headers", () => {
    const response = "The workspace has been active with 3 commits and 2 ticket changes.";

    const briefing = parseBriefingResponse(response);

    expect(briefing.summary).toBe(response);
    expect(briefing.highlights).toHaveLength(0);
    expect(briefing.concerns).toHaveLength(0);
  });
});

describe("generateBriefing", () => {
  it("orchestrates prompt formatting and response parsing", async () => {
    const input = makeBriefingInput();

    const mockLlmCall = async (prompt: string): Promise<string> => {
      expect(prompt).toContain("my-app");
      return `## Summary
Activity summary for the workspace.

## Highlights
- Login bug fixed
- Dashboard started

## Concerns
- No test coverage for dashboard
`;
    };

    const briefing = await generateBriefing(input, mockLlmCall);

    expect(briefing.summary).toContain("Activity summary");
    expect(briefing.highlights).toHaveLength(2);
    expect(briefing.concerns).toHaveLength(1);
    expect(briefing.generatedAt).toBeTruthy();
  });

  it("handles empty project list", async () => {
    const input = makeBriefingInput({ projects: [] });

    const mockLlmCall = async (): Promise<string> => {
      return `## Summary
No activity to report.

## Highlights

## Concerns
None.
`;
    };

    const briefing = await generateBriefing(input, mockLlmCall);

    expect(briefing.summary).toContain("No activity");
    expect(briefing.highlights).toHaveLength(0);
    expect(briefing.concerns).toHaveLength(0);
  });
});
