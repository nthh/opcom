import { describe, it, expect } from "vitest";
import {
  mapRunStatus,
  mapDeploymentState,
  parseOwnerRepo,
  computeDurationMs,
  mapGHRun,
  mapGHJob,
  mapGHStep,
} from "@opcom/core";
import type {
  GHWorkflowRun,
  GHJob,
  GHStep,
} from "@opcom/core";

// --- mapRunStatus ---

describe("mapRunStatus", () => {
  it("maps queued status", () => {
    expect(mapRunStatus("queued", null)).toBe("queued");
  });

  it("maps in_progress status", () => {
    expect(mapRunStatus("in_progress", null)).toBe("in_progress");
  });

  it("maps completed + success", () => {
    expect(mapRunStatus("completed", "success")).toBe("success");
  });

  it("maps completed + failure", () => {
    expect(mapRunStatus("completed", "failure")).toBe("failure");
  });

  it("maps completed + cancelled", () => {
    expect(mapRunStatus("completed", "cancelled")).toBe("cancelled");
  });

  it("maps completed + timed_out", () => {
    expect(mapRunStatus("completed", "timed_out")).toBe("timed_out");
  });

  it("maps completed + skipped", () => {
    expect(mapRunStatus("completed", "skipped")).toBe("skipped");
  });

  it("maps completed + unknown conclusion to failure", () => {
    expect(mapRunStatus("completed", "action_required")).toBe("failure");
  });

  it("maps completed + null conclusion to failure", () => {
    expect(mapRunStatus("completed", null)).toBe("failure");
  });

  it("maps unknown status to queued", () => {
    expect(mapRunStatus("waiting", null)).toBe("queued");
  });
});

// --- mapDeploymentState ---

describe("mapDeploymentState", () => {
  it("maps pending", () => {
    expect(mapDeploymentState("pending")).toBe("pending");
  });

  it("maps in_progress", () => {
    expect(mapDeploymentState("in_progress")).toBe("in_progress");
  });

  it("maps success to active", () => {
    expect(mapDeploymentState("success")).toBe("active");
  });

  it("maps active to active", () => {
    expect(mapDeploymentState("active")).toBe("active");
  });

  it("maps inactive", () => {
    expect(mapDeploymentState("inactive")).toBe("inactive");
  });

  it("maps failure to failed", () => {
    expect(mapDeploymentState("failure")).toBe("failed");
  });

  it("maps error", () => {
    expect(mapDeploymentState("error")).toBe("error");
  });

  it("maps unknown state to pending", () => {
    expect(mapDeploymentState("unknown")).toBe("pending");
  });
});

// --- parseOwnerRepo ---

describe("parseOwnerRepo", () => {
  it("parses SSH remote", () => {
    const result = parseOwnerRepo("git@github.com:nathansmith/opcom.git");
    expect(result).toEqual({ owner: "nathansmith", repo: "opcom" });
  });

  it("parses HTTPS remote", () => {
    const result = parseOwnerRepo("https://github.com/nathansmith/opcom.git");
    expect(result).toEqual({ owner: "nathansmith", repo: "opcom" });
  });

  it("parses HTTPS remote without .git suffix", () => {
    const result = parseOwnerRepo("https://github.com/nathansmith/opcom");
    expect(result).toEqual({ owner: "nathansmith", repo: "opcom" });
  });

  it("parses SSH remote without .git suffix", () => {
    const result = parseOwnerRepo("git@github.com:myorg/my-repo");
    expect(result).toEqual({ owner: "myorg", repo: "my-repo" });
  });

  it("returns null for non-GitHub remote", () => {
    expect(parseOwnerRepo("git@gitlab.com:org/repo.git")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseOwnerRepo("")).toBeNull();
  });

  it("returns null for random string", () => {
    expect(parseOwnerRepo("not-a-remote")).toBeNull();
  });
});

// --- computeDurationMs ---

describe("computeDurationMs", () => {
  it("returns undefined if start is undefined", () => {
    expect(computeDurationMs(undefined, undefined)).toBeUndefined();
  });

  it("computes duration between start and end", () => {
    const start = "2026-01-15T10:00:00Z";
    const end = "2026-01-15T10:02:30Z";
    expect(computeDurationMs(start, end)).toBe(150_000); // 2m 30s
  });

  it("returns undefined for zero or negative duration", () => {
    const time = "2026-01-15T10:00:00Z";
    expect(computeDurationMs(time, time)).toBeUndefined();
  });
});

// --- mapGHStep ---

describe("mapGHStep", () => {
  it("maps a successful step", () => {
    const step: GHStep = { name: "Checkout", status: "completed", conclusion: "success", number: 1 };
    const result = mapGHStep(step);
    expect(result).toEqual({
      name: "Checkout",
      status: "success",
      durationMs: undefined,
    });
  });

  it("maps a failed step", () => {
    const step: GHStep = { name: "Run tests", status: "completed", conclusion: "failure", number: 3 };
    const result = mapGHStep(step);
    expect(result.status).toBe("failure");
  });

  it("maps an in-progress step", () => {
    const step: GHStep = { name: "Build", status: "in_progress", conclusion: null, number: 2 };
    const result = mapGHStep(step);
    expect(result.status).toBe("in_progress");
  });
});

// --- mapGHJob ---

describe("mapGHJob", () => {
  function makeJob(overrides: Partial<GHJob> = {}): GHJob {
    return {
      id: 12345,
      name: "build",
      status: "completed",
      conclusion: "success",
      started_at: "2026-01-15T10:00:00Z",
      completed_at: "2026-01-15T10:01:00Z",
      html_url: "https://github.com/org/repo/actions/runs/1/jobs/12345",
      runner_name: "ubuntu-latest",
      steps: [
        { name: "Checkout", status: "completed", conclusion: "success", number: 1 },
        { name: "Build", status: "completed", conclusion: "success", number: 2 },
      ],
      ...overrides,
    };
  }

  it("maps a completed job with steps", () => {
    const result = mapGHJob(makeJob());
    expect(result.id).toBe("12345");
    expect(result.name).toBe("build");
    expect(result.status).toBe("success");
    expect(result.durationMs).toBe(60_000);
    expect(result.runner).toBe("ubuntu-latest");
    expect(result.steps).toHaveLength(2);
    expect(result.steps![0].name).toBe("Checkout");
  });

  it("maps a job without steps", () => {
    const result = mapGHJob(makeJob({ steps: undefined }));
    expect(result.steps).toBeUndefined();
  });

  it("maps a failed job", () => {
    const result = mapGHJob(makeJob({ conclusion: "failure" }));
    expect(result.status).toBe("failure");
  });

  it("maps a job without timestamps", () => {
    const result = mapGHJob(makeJob({ started_at: undefined, completed_at: undefined }));
    expect(result.durationMs).toBeUndefined();
  });
});

// --- mapGHRun ---

describe("mapGHRun", () => {
  function makeRun(overrides: Partial<GHWorkflowRun> = {}): GHWorkflowRun {
    return {
      id: 9999,
      name: "CI",
      head_branch: "main",
      head_sha: "abc123def456",
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/org/repo/actions/runs/9999",
      run_started_at: "2026-01-15T10:00:00Z",
      updated_at: "2026-01-15T10:02:00Z",
      actor: { login: "nathan" },
      event: "push",
      head_commit: { message: "Fix the thing" },
      ...overrides,
    };
  }

  it("maps a completed successful run", () => {
    const result = mapGHRun(makeRun(), "proj-1");
    expect(result.id).toBe("9999");
    expect(result.projectId).toBe("proj-1");
    expect(result.provider).toBe("github-actions");
    expect(result.name).toBe("CI");
    expect(result.ref).toBe("main");
    expect(result.commitSha).toBe("abc123def456");
    expect(result.commitMessage).toBe("Fix the thing");
    expect(result.status).toBe("success");
    expect(result.url).toBe("https://github.com/org/repo/actions/runs/9999");
    expect(result.jobs).toEqual([]);
  });

  it("sets triggeredBy from event for push", () => {
    const result = mapGHRun(makeRun({ event: "push" }), "proj-1");
    expect(result.triggeredBy).toBe("push");
  });

  it("sets triggeredBy from event for schedule", () => {
    const result = mapGHRun(makeRun({ event: "schedule" }), "proj-1");
    expect(result.triggeredBy).toBe("schedule");
  });

  it("sets triggeredBy from actor login for pull_request", () => {
    const result = mapGHRun(makeRun({ event: "pull_request", actor: { login: "bot" } }), "proj-1");
    expect(result.triggeredBy).toBe("bot");
  });

  it("uses event as triggeredBy when no actor", () => {
    const result = mapGHRun(makeRun({ event: "workflow_dispatch", actor: undefined }), "proj-1");
    expect(result.triggeredBy).toBe("workflow_dispatch");
  });

  it("computes duration for completed runs", () => {
    const result = mapGHRun(makeRun(), "proj-1");
    expect(result.durationMs).toBe(120_000); // 2m
    expect(result.completedAt).toBe("2026-01-15T10:02:00Z");
  });

  it("does not set completedAt for in-progress runs", () => {
    const result = mapGHRun(makeRun({ status: "in_progress", conclusion: null }), "proj-1");
    expect(result.status).toBe("in_progress");
    expect(result.completedAt).toBeUndefined();
  });

  it("handles missing head_commit", () => {
    const result = mapGHRun(makeRun({ head_commit: undefined }), "proj-1");
    expect(result.commitMessage).toBeUndefined();
  });

  it("handles missing run_started_at", () => {
    const result = mapGHRun(makeRun({ run_started_at: undefined }), "proj-1");
    expect(result.startedAt).toBeUndefined();
    expect(result.durationMs).toBeUndefined();
  });
});
