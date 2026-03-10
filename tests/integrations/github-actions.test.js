"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
// --- mapRunStatus ---
(0, vitest_1.describe)("mapRunStatus", () => {
    (0, vitest_1.it)("maps queued status", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("queued", null)).toBe("queued");
    });
    (0, vitest_1.it)("maps in_progress status", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("in_progress", null)).toBe("in_progress");
    });
    (0, vitest_1.it)("maps completed + success", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("completed", "success")).toBe("success");
    });
    (0, vitest_1.it)("maps completed + failure", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("completed", "failure")).toBe("failure");
    });
    (0, vitest_1.it)("maps completed + cancelled", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("completed", "cancelled")).toBe("cancelled");
    });
    (0, vitest_1.it)("maps completed + timed_out", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("completed", "timed_out")).toBe("timed_out");
    });
    (0, vitest_1.it)("maps completed + skipped", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("completed", "skipped")).toBe("skipped");
    });
    (0, vitest_1.it)("maps completed + unknown conclusion to failure", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("completed", "action_required")).toBe("failure");
    });
    (0, vitest_1.it)("maps completed + null conclusion to failure", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("completed", null)).toBe("failure");
    });
    (0, vitest_1.it)("maps unknown status to queued", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("waiting", null)).toBe("queued");
    });
});
// --- mapDeploymentState ---
(0, vitest_1.describe)("mapDeploymentState", () => {
    (0, vitest_1.it)("maps pending", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentState)("pending")).toBe("pending");
    });
    (0, vitest_1.it)("maps in_progress", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentState)("in_progress")).toBe("in_progress");
    });
    (0, vitest_1.it)("maps success to active", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentState)("success")).toBe("active");
    });
    (0, vitest_1.it)("maps active to active", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentState)("active")).toBe("active");
    });
    (0, vitest_1.it)("maps inactive", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentState)("inactive")).toBe("inactive");
    });
    (0, vitest_1.it)("maps failure to failed", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentState)("failure")).toBe("failed");
    });
    (0, vitest_1.it)("maps error", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentState)("error")).toBe("error");
    });
    (0, vitest_1.it)("maps unknown state to pending", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentState)("unknown")).toBe("pending");
    });
});
// --- parseOwnerRepo ---
(0, vitest_1.describe)("parseOwnerRepo", () => {
    (0, vitest_1.it)("parses SSH remote", () => {
        const result = (0, core_1.parseOwnerRepo)("git@github.com:nathansmith/opcom.git");
        (0, vitest_1.expect)(result).toEqual({ owner: "nathansmith", repo: "opcom" });
    });
    (0, vitest_1.it)("parses HTTPS remote", () => {
        const result = (0, core_1.parseOwnerRepo)("https://github.com/nathansmith/opcom.git");
        (0, vitest_1.expect)(result).toEqual({ owner: "nathansmith", repo: "opcom" });
    });
    (0, vitest_1.it)("parses HTTPS remote without .git suffix", () => {
        const result = (0, core_1.parseOwnerRepo)("https://github.com/nathansmith/opcom");
        (0, vitest_1.expect)(result).toEqual({ owner: "nathansmith", repo: "opcom" });
    });
    (0, vitest_1.it)("parses SSH remote without .git suffix", () => {
        const result = (0, core_1.parseOwnerRepo)("git@github.com:myorg/my-repo");
        (0, vitest_1.expect)(result).toEqual({ owner: "myorg", repo: "my-repo" });
    });
    (0, vitest_1.it)("returns null for non-GitHub remote", () => {
        (0, vitest_1.expect)((0, core_1.parseOwnerRepo)("git@gitlab.com:org/repo.git")).toBeNull();
    });
    (0, vitest_1.it)("returns null for empty string", () => {
        (0, vitest_1.expect)((0, core_1.parseOwnerRepo)("")).toBeNull();
    });
    (0, vitest_1.it)("returns null for random string", () => {
        (0, vitest_1.expect)((0, core_1.parseOwnerRepo)("not-a-remote")).toBeNull();
    });
});
// --- computeDurationMs ---
(0, vitest_1.describe)("computeDurationMs", () => {
    (0, vitest_1.it)("returns undefined if start is undefined", () => {
        (0, vitest_1.expect)((0, core_1.computeDurationMs)(undefined, undefined)).toBeUndefined();
    });
    (0, vitest_1.it)("computes duration between start and end", () => {
        const start = "2026-01-15T10:00:00Z";
        const end = "2026-01-15T10:02:30Z";
        (0, vitest_1.expect)((0, core_1.computeDurationMs)(start, end)).toBe(150_000); // 2m 30s
    });
    (0, vitest_1.it)("returns undefined for zero or negative duration", () => {
        const time = "2026-01-15T10:00:00Z";
        (0, vitest_1.expect)((0, core_1.computeDurationMs)(time, time)).toBeUndefined();
    });
});
// --- mapGHStep ---
(0, vitest_1.describe)("mapGHStep", () => {
    (0, vitest_1.it)("maps a successful step", () => {
        const step = { name: "Checkout", status: "completed", conclusion: "success", number: 1 };
        const result = (0, core_1.mapGHStep)(step);
        (0, vitest_1.expect)(result).toEqual({
            name: "Checkout",
            status: "success",
            durationMs: undefined,
        });
    });
    (0, vitest_1.it)("maps a failed step", () => {
        const step = { name: "Run tests", status: "completed", conclusion: "failure", number: 3 };
        const result = (0, core_1.mapGHStep)(step);
        (0, vitest_1.expect)(result.status).toBe("failure");
    });
    (0, vitest_1.it)("maps an in-progress step", () => {
        const step = { name: "Build", status: "in_progress", conclusion: null, number: 2 };
        const result = (0, core_1.mapGHStep)(step);
        (0, vitest_1.expect)(result.status).toBe("in_progress");
    });
});
// --- mapGHJob ---
(0, vitest_1.describe)("mapGHJob", () => {
    function makeJob(overrides = {}) {
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
    (0, vitest_1.it)("maps a completed job with steps", () => {
        const result = (0, core_1.mapGHJob)(makeJob());
        (0, vitest_1.expect)(result.id).toBe("12345");
        (0, vitest_1.expect)(result.name).toBe("build");
        (0, vitest_1.expect)(result.status).toBe("success");
        (0, vitest_1.expect)(result.durationMs).toBe(60_000);
        (0, vitest_1.expect)(result.runner).toBe("ubuntu-latest");
        (0, vitest_1.expect)(result.steps).toHaveLength(2);
        (0, vitest_1.expect)(result.steps[0].name).toBe("Checkout");
    });
    (0, vitest_1.it)("maps a job without steps", () => {
        const result = (0, core_1.mapGHJob)(makeJob({ steps: undefined }));
        (0, vitest_1.expect)(result.steps).toBeUndefined();
    });
    (0, vitest_1.it)("maps a failed job", () => {
        const result = (0, core_1.mapGHJob)(makeJob({ conclusion: "failure" }));
        (0, vitest_1.expect)(result.status).toBe("failure");
    });
    (0, vitest_1.it)("maps a job without timestamps", () => {
        const result = (0, core_1.mapGHJob)(makeJob({ started_at: undefined, completed_at: undefined }));
        (0, vitest_1.expect)(result.durationMs).toBeUndefined();
    });
});
// --- mapGHRun ---
(0, vitest_1.describe)("mapGHRun", () => {
    function makeRun(overrides = {}) {
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
    (0, vitest_1.it)("maps a completed successful run", () => {
        const result = (0, core_1.mapGHRun)(makeRun(), "proj-1");
        (0, vitest_1.expect)(result.id).toBe("9999");
        (0, vitest_1.expect)(result.projectId).toBe("proj-1");
        (0, vitest_1.expect)(result.provider).toBe("github-actions");
        (0, vitest_1.expect)(result.name).toBe("CI");
        (0, vitest_1.expect)(result.ref).toBe("main");
        (0, vitest_1.expect)(result.commitSha).toBe("abc123def456");
        (0, vitest_1.expect)(result.commitMessage).toBe("Fix the thing");
        (0, vitest_1.expect)(result.status).toBe("success");
        (0, vitest_1.expect)(result.url).toBe("https://github.com/org/repo/actions/runs/9999");
        (0, vitest_1.expect)(result.jobs).toEqual([]);
    });
    (0, vitest_1.it)("sets triggeredBy from event for push", () => {
        const result = (0, core_1.mapGHRun)(makeRun({ event: "push" }), "proj-1");
        (0, vitest_1.expect)(result.triggeredBy).toBe("push");
    });
    (0, vitest_1.it)("sets triggeredBy from event for schedule", () => {
        const result = (0, core_1.mapGHRun)(makeRun({ event: "schedule" }), "proj-1");
        (0, vitest_1.expect)(result.triggeredBy).toBe("schedule");
    });
    (0, vitest_1.it)("sets triggeredBy from actor login for pull_request", () => {
        const result = (0, core_1.mapGHRun)(makeRun({ event: "pull_request", actor: { login: "bot" } }), "proj-1");
        (0, vitest_1.expect)(result.triggeredBy).toBe("bot");
    });
    (0, vitest_1.it)("uses event as triggeredBy when no actor", () => {
        const result = (0, core_1.mapGHRun)(makeRun({ event: "workflow_dispatch", actor: undefined }), "proj-1");
        (0, vitest_1.expect)(result.triggeredBy).toBe("workflow_dispatch");
    });
    (0, vitest_1.it)("computes duration for completed runs", () => {
        const result = (0, core_1.mapGHRun)(makeRun(), "proj-1");
        (0, vitest_1.expect)(result.durationMs).toBe(120_000); // 2m
        (0, vitest_1.expect)(result.completedAt).toBe("2026-01-15T10:02:00Z");
    });
    (0, vitest_1.it)("does not set completedAt for in-progress runs", () => {
        const result = (0, core_1.mapGHRun)(makeRun({ status: "in_progress", conclusion: null }), "proj-1");
        (0, vitest_1.expect)(result.status).toBe("in_progress");
        (0, vitest_1.expect)(result.completedAt).toBeUndefined();
    });
    (0, vitest_1.it)("handles missing head_commit", () => {
        const result = (0, core_1.mapGHRun)(makeRun({ head_commit: undefined }), "proj-1");
        (0, vitest_1.expect)(result.commitMessage).toBeUndefined();
    });
    (0, vitest_1.it)("handles missing run_started_at", () => {
        const result = (0, core_1.mapGHRun)(makeRun({ run_started_at: undefined }), "proj-1");
        (0, vitest_1.expect)(result.startedAt).toBeUndefined();
        (0, vitest_1.expect)(result.durationMs).toBeUndefined();
    });
});
//# sourceMappingURL=github-actions.test.js.map