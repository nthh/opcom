import { describe, it, expect } from "vitest";
import { issueToWorkItem, mapLabelToPriority, mapLabelToType } from "@opcom/core";
import type { GitHubIssue } from "@opcom/core";

describe("mapLabelToPriority", () => {
  it("maps P0 to priority 0", () => {
    expect(mapLabelToPriority(["P0"])).toBe(0);
  });

  it("maps P1 to priority 1", () => {
    expect(mapLabelToPriority(["P1"])).toBe(1);
  });

  it("maps P2 to priority 2", () => {
    expect(mapLabelToPriority(["P2"])).toBe(2);
  });

  it("maps P3 to priority 3", () => {
    expect(mapLabelToPriority(["P3"])).toBe(3);
  });

  it("maps critical to priority 0", () => {
    expect(mapLabelToPriority(["critical"])).toBe(0);
  });

  it("maps urgent to priority 1", () => {
    expect(mapLabelToPriority(["urgent"])).toBe(1);
  });

  it("returns default priority 2 for unknown labels", () => {
    expect(mapLabelToPriority(["random-label"])).toBe(2);
  });

  it("returns default priority 2 for empty labels", () => {
    expect(mapLabelToPriority([])).toBe(2);
  });

  it("picks first matching label when multiple are present", () => {
    expect(mapLabelToPriority(["P0", "P3"])).toBe(0);
  });
});

describe("mapLabelToType", () => {
  it("maps bug label", () => {
    expect(mapLabelToType(["bug"])).toBe("bug");
  });

  it("maps enhancement to feature", () => {
    expect(mapLabelToType(["enhancement"])).toBe("feature");
  });

  it("maps feature label", () => {
    expect(mapLabelToType(["feature"])).toBe("feature");
  });

  it("maps documentation to docs", () => {
    expect(mapLabelToType(["documentation"])).toBe("docs");
  });

  it("maps docs to docs", () => {
    expect(mapLabelToType(["docs"])).toBe("docs");
  });

  it("maps chore label", () => {
    expect(mapLabelToType(["chore"])).toBe("chore");
  });

  it("maps maintenance to chore", () => {
    expect(mapLabelToType(["maintenance"])).toBe("chore");
  });

  it("returns default task for unknown labels", () => {
    expect(mapLabelToType(["unknown"])).toBe("task");
  });

  it("returns default task for empty labels", () => {
    expect(mapLabelToType([])).toBe("task");
  });
});

describe("issueToWorkItem", () => {
  function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
    return {
      number: 42,
      title: "Fix the widget",
      state: "open",
      labels: [{ name: "bug" }, { name: "P1" }],
      body: "The widget is broken",
      html_url: "https://github.com/test-owner/test-repo/issues/42",
      ...overrides,
    };
  }

  it("converts a GitHub issue to a WorkItem", () => {
    const issue = makeIssue();
    const workItem = issueToWorkItem(issue, "test-owner", "test-repo");

    expect(workItem.id).toBe("github-test-owner-test-repo-42");
    expect(workItem.title).toBe("Fix the widget");
    expect(workItem.status).toBe("open");
    expect(workItem.priority).toBe(1); // P1 label
    expect(workItem.type).toBe("bug"); // bug label
    expect(workItem.filePath).toBe("https://github.com/test-owner/test-repo/issues/42");
    expect(workItem.deps).toEqual([]);
    expect(workItem.links).toContain("https://github.com/test-owner/test-repo/issues/42");
  });

  it("maps closed state correctly", () => {
    const issue = makeIssue({ state: "closed" });
    const workItem = issueToWorkItem(issue, "owner", "repo");
    expect(workItem.status).toBe("closed");
  });

  it("includes label names in tags", () => {
    const issue = makeIssue({ labels: [{ name: "bug" }, { name: "P0" }, { name: "frontend" }] });
    const workItem = issueToWorkItem(issue, "owner", "repo");
    expect(workItem.tags.labels).toEqual(["bug", "P0", "frontend"]);
    expect(workItem.tags.source).toEqual(["github"]);
  });

  it("handles issue with no labels", () => {
    const issue = makeIssue({ labels: [] });
    const workItem = issueToWorkItem(issue, "owner", "repo");

    expect(workItem.priority).toBe(2); // default
    expect(workItem.type).toBe("task"); // default
    expect(workItem.tags.labels).toEqual([]);
  });

  it("uses owner and repo in the WorkItem ID", () => {
    const issue = makeIssue({ number: 100 });
    const workItem = issueToWorkItem(issue, "myorg", "myrepo");
    expect(workItem.id).toBe("github-myorg-myrepo-100");
  });
});
