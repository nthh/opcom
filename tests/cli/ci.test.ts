import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubActionsAdapter, mapRunStatus, mapDeploymentState, parseOwnerRepo } from "@opcom/core";
import type { Pipeline, PipelineStatus, DeploymentStatus } from "@opcom/types";

// Test the formatting helpers and adapter detection logic used by opcom ci

describe("CI CLI helpers", () => {
  describe("status icon mapping", () => {
    const STATUS_ICONS: Record<PipelineStatus, string> = {
      success: "\u2714",
      failure: "\u2716",
      in_progress: "\u25CC",
      queued: "\u25CB",
      cancelled: "\u2013",
      timed_out: "\u2716",
      skipped: "\u2013",
    };

    it("maps all pipeline statuses to icons", () => {
      expect(STATUS_ICONS.success).toBe("\u2714");
      expect(STATUS_ICONS.failure).toBe("\u2716");
      expect(STATUS_ICONS.in_progress).toBe("\u25CC");
      expect(STATUS_ICONS.queued).toBe("\u25CB");
      expect(STATUS_ICONS.cancelled).toBe("\u2013");
      expect(STATUS_ICONS.timed_out).toBe("\u2716");
      expect(STATUS_ICONS.skipped).toBe("\u2013");
    });
  });

  describe("duration formatting", () => {
    function formatDuration(ms?: number): string {
      if (!ms) return "-";
      if (ms < 1000) return `${ms}ms`;
      const secs = Math.floor(ms / 1000);
      if (secs < 60) return `${secs}s`;
      const mins = Math.floor(secs / 60);
      const remSecs = secs % 60;
      return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
    }

    it("formats undefined as dash", () => {
      expect(formatDuration(undefined)).toBe("-");
    });

    it("formats milliseconds", () => {
      expect(formatDuration(500)).toBe("500ms");
    });

    it("formats seconds", () => {
      expect(formatDuration(45_000)).toBe("45s");
    });

    it("formats minutes and seconds", () => {
      expect(formatDuration(132_000)).toBe("2m 12s");
    });

    it("formats exact minutes", () => {
      expect(formatDuration(120_000)).toBe("2m");
    });
  });

  describe("relative time formatting", () => {
    function formatRelativeTime(dateStr?: string): string {
      if (!dateStr) return "-";
      const diffMs = Date.now() - new Date(dateStr).getTime();
      if (diffMs < 0) return "just now";
      const secs = Math.floor(diffMs / 1000);
      if (secs < 60) return `${secs}s ago`;
      const mins = Math.floor(secs / 60);
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    }

    it("formats undefined as dash", () => {
      expect(formatRelativeTime(undefined)).toBe("-");
    });

    it("formats recent time as seconds ago", () => {
      const recent = new Date(Date.now() - 30_000).toISOString();
      expect(formatRelativeTime(recent)).toBe("30s ago");
    });

    it("formats minutes ago", () => {
      const mins = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatRelativeTime(mins)).toBe("5m ago");
    });

    it("formats hours ago", () => {
      const hrs = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
      expect(formatRelativeTime(hrs)).toBe("3h ago");
    });

    it("formats days ago", () => {
      const days = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
      expect(formatRelativeTime(days)).toBe("2d ago");
    });

    it("formats future time as just now", () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      expect(formatRelativeTime(future)).toBe("just now");
    });
  });
});

describe("GitHubActionsAdapter detection", () => {
  it("parseOwnerRepo handles SSH remotes", () => {
    const result = parseOwnerRepo("git@github.com:org/repo.git");
    expect(result).toEqual({ owner: "org", repo: "repo" });
  });

  it("parseOwnerRepo handles HTTPS remotes", () => {
    const result = parseOwnerRepo("https://github.com/org/repo.git");
    expect(result).toEqual({ owner: "org", repo: "repo" });
  });

  it("parseOwnerRepo returns null for non-GitHub remotes", () => {
    expect(parseOwnerRepo("git@gitlab.com:org/repo.git")).toBeNull();
  });

  it("mapRunStatus maps completed+success to success", () => {
    expect(mapRunStatus("completed", "success")).toBe("success");
  });

  it("mapRunStatus maps completed+failure to failure", () => {
    expect(mapRunStatus("completed", "failure")).toBe("failure");
  });

  it("mapRunStatus maps in_progress to in_progress", () => {
    expect(mapRunStatus("in_progress", null)).toBe("in_progress");
  });

  it("mapDeploymentState maps success to active", () => {
    expect(mapDeploymentState("success")).toBe("active");
  });

  it("mapDeploymentState maps failure to failed", () => {
    expect(mapDeploymentState("failure")).toBe("failed");
  });
});
