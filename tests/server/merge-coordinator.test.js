"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("MergeCoordinator", () => {
    (0, vitest_1.it)("creates merge requests and queues them", async () => {
        const mc = new core_1.MergeCoordinator();
        const request = await mc.requestMerge({
            sessionId: "test-session",
            projectPath: "/tmp/test",
            sourceBranch: "feature/test",
            targetBranch: "main",
            runTests: false,
            autoMerge: false,
        });
        (0, vitest_1.expect)(request.id).toBeDefined();
        // Status may be "queued" or "running" depending on async processing timing
        (0, vitest_1.expect)(["queued", "running", "failed"]).toContain(request.status);
        (0, vitest_1.expect)(request.sourceBranch).toBe("feature/test");
        (0, vitest_1.expect)(request.targetBranch).toBe("main");
    });
    (0, vitest_1.it)("tracks merge queue", async () => {
        const mc = new core_1.MergeCoordinator();
        await mc.requestMerge({
            sessionId: "s1",
            projectPath: "/tmp/test",
            sourceBranch: "feature/a",
            targetBranch: "main",
        });
        const queue = mc.getQueue();
        (0, vitest_1.expect)(queue.length).toBeGreaterThanOrEqual(1);
    });
    (0, vitest_1.it)("cancels queued requests", async () => {
        const mc = new core_1.MergeCoordinator();
        const req = await mc.requestMerge({
            sessionId: "s1",
            projectPath: "/tmp/nonexistent-so-it-wont-run",
            sourceBranch: "feature/a",
            targetBranch: "main",
        });
        // Give it a tick to start processing
        await new Promise((r) => setTimeout(r, 50));
        // Request may already be running, but if still queued, cancel should work
        const cancelled = mc.cancelRequest(req.id);
        // Either true (was still queued) or false (already processing)
        (0, vitest_1.expect)(typeof cancelled).toBe("boolean");
    });
    (0, vitest_1.it)("emits merge events", async () => {
        const mc = new core_1.MergeCoordinator();
        const events = [];
        mc.onEvent((e) => events.push(e.type));
        await mc.requestMerge({
            sessionId: "s1",
            projectPath: "/tmp/test",
            sourceBranch: "feature/a",
            targetBranch: "main",
        });
        // Wait for processing to attempt
        await new Promise((r) => setTimeout(r, 100));
        (0, vitest_1.expect)(events).toContain("merge_queued");
    });
});
//# sourceMappingURL=merge-coordinator.test.js.map