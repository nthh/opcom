"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
// Test the formatting helpers and adapter detection logic used by opcom ci
(0, vitest_1.describe)("CI CLI helpers", () => {
    (0, vitest_1.describe)("status icon mapping", () => {
        const STATUS_ICONS = {
            success: "\u2714",
            failure: "\u2716",
            in_progress: "\u25CC",
            queued: "\u25CB",
            cancelled: "\u2013",
            timed_out: "\u2716",
            skipped: "\u2013",
        };
        (0, vitest_1.it)("maps all pipeline statuses to icons", () => {
            (0, vitest_1.expect)(STATUS_ICONS.success).toBe("\u2714");
            (0, vitest_1.expect)(STATUS_ICONS.failure).toBe("\u2716");
            (0, vitest_1.expect)(STATUS_ICONS.in_progress).toBe("\u25CC");
            (0, vitest_1.expect)(STATUS_ICONS.queued).toBe("\u25CB");
            (0, vitest_1.expect)(STATUS_ICONS.cancelled).toBe("\u2013");
            (0, vitest_1.expect)(STATUS_ICONS.timed_out).toBe("\u2716");
            (0, vitest_1.expect)(STATUS_ICONS.skipped).toBe("\u2013");
        });
    });
    (0, vitest_1.describe)("duration formatting", () => {
        function formatDuration(ms) {
            if (!ms)
                return "-";
            if (ms < 1000)
                return `${ms}ms`;
            const secs = Math.floor(ms / 1000);
            if (secs < 60)
                return `${secs}s`;
            const mins = Math.floor(secs / 60);
            const remSecs = secs % 60;
            return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
        }
        (0, vitest_1.it)("formats undefined as dash", () => {
            (0, vitest_1.expect)(formatDuration(undefined)).toBe("-");
        });
        (0, vitest_1.it)("formats milliseconds", () => {
            (0, vitest_1.expect)(formatDuration(500)).toBe("500ms");
        });
        (0, vitest_1.it)("formats seconds", () => {
            (0, vitest_1.expect)(formatDuration(45_000)).toBe("45s");
        });
        (0, vitest_1.it)("formats minutes and seconds", () => {
            (0, vitest_1.expect)(formatDuration(132_000)).toBe("2m 12s");
        });
        (0, vitest_1.it)("formats exact minutes", () => {
            (0, vitest_1.expect)(formatDuration(120_000)).toBe("2m");
        });
    });
    (0, vitest_1.describe)("relative time formatting", () => {
        function formatRelativeTime(dateStr) {
            if (!dateStr)
                return "-";
            const diffMs = Date.now() - new Date(dateStr).getTime();
            if (diffMs < 0)
                return "just now";
            const secs = Math.floor(diffMs / 1000);
            if (secs < 60)
                return `${secs}s ago`;
            const mins = Math.floor(secs / 60);
            if (mins < 60)
                return `${mins}m ago`;
            const hours = Math.floor(mins / 60);
            if (hours < 24)
                return `${hours}h ago`;
            const days = Math.floor(hours / 24);
            return `${days}d ago`;
        }
        (0, vitest_1.it)("formats undefined as dash", () => {
            (0, vitest_1.expect)(formatRelativeTime(undefined)).toBe("-");
        });
        (0, vitest_1.it)("formats recent time as seconds ago", () => {
            const recent = new Date(Date.now() - 30_000).toISOString();
            (0, vitest_1.expect)(formatRelativeTime(recent)).toBe("30s ago");
        });
        (0, vitest_1.it)("formats minutes ago", () => {
            const mins = new Date(Date.now() - 5 * 60_000).toISOString();
            (0, vitest_1.expect)(formatRelativeTime(mins)).toBe("5m ago");
        });
        (0, vitest_1.it)("formats hours ago", () => {
            const hrs = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
            (0, vitest_1.expect)(formatRelativeTime(hrs)).toBe("3h ago");
        });
        (0, vitest_1.it)("formats days ago", () => {
            const days = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
            (0, vitest_1.expect)(formatRelativeTime(days)).toBe("2d ago");
        });
        (0, vitest_1.it)("formats future time as just now", () => {
            const future = new Date(Date.now() + 60_000).toISOString();
            (0, vitest_1.expect)(formatRelativeTime(future)).toBe("just now");
        });
    });
});
(0, vitest_1.describe)("GitHubActionsAdapter detection", () => {
    (0, vitest_1.it)("parseOwnerRepo handles SSH remotes", () => {
        const result = (0, core_1.parseOwnerRepo)("git@github.com:org/repo.git");
        (0, vitest_1.expect)(result).toEqual({ owner: "org", repo: "repo" });
    });
    (0, vitest_1.it)("parseOwnerRepo handles HTTPS remotes", () => {
        const result = (0, core_1.parseOwnerRepo)("https://github.com/org/repo.git");
        (0, vitest_1.expect)(result).toEqual({ owner: "org", repo: "repo" });
    });
    (0, vitest_1.it)("parseOwnerRepo returns null for non-GitHub remotes", () => {
        (0, vitest_1.expect)((0, core_1.parseOwnerRepo)("git@gitlab.com:org/repo.git")).toBeNull();
    });
    (0, vitest_1.it)("mapRunStatus maps completed+success to success", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("completed", "success")).toBe("success");
    });
    (0, vitest_1.it)("mapRunStatus maps completed+failure to failure", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("completed", "failure")).toBe("failure");
    });
    (0, vitest_1.it)("mapRunStatus maps in_progress to in_progress", () => {
        (0, vitest_1.expect)((0, core_1.mapRunStatus)("in_progress", null)).toBe("in_progress");
    });
    (0, vitest_1.it)("mapDeploymentState maps success to active", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentState)("success")).toBe("active");
    });
    (0, vitest_1.it)("mapDeploymentState maps failure to failed", () => {
        (0, vitest_1.expect)((0, core_1.mapDeploymentState)("failure")).toBe("failed");
    });
});
//# sourceMappingURL=ci.test.js.map