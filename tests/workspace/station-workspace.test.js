"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Tests for Station workspace health endpoint.
 */
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("Station Workspace Health API", () => {
    let station;
    let port;
    (0, vitest_1.beforeAll)(async () => {
        port = 17000 + Math.floor(Math.random() * 1000);
        station = new core_1.Station(port, { skipCICD: true, skipReconcile: true, skipInfra: true });
        await station.start();
    }, 30000);
    (0, vitest_1.afterAll)(async () => {
        await station.stop();
        await new Promise((r) => setTimeout(r, 100));
    }, 30000);
    (0, vitest_1.it)("GET /workspace/health returns valid structure", async () => {
        const res = await fetch(`http://localhost:${port}/workspace/health`);
        (0, vitest_1.expect)(res.status).toBe(200);
        const data = await res.json();
        (0, vitest_1.expect)(data).toHaveProperty("projects");
        (0, vitest_1.expect)(data).toHaveProperty("totalSignals");
        (0, vitest_1.expect)(data).toHaveProperty("sharedPatterns");
        (0, vitest_1.expect)(Array.isArray(data.projects)).toBe(true);
        (0, vitest_1.expect)(Array.isArray(data.sharedPatterns)).toBe(true);
        (0, vitest_1.expect)(typeof data.totalSignals).toBe("number");
    });
    (0, vitest_1.it)("returns empty workspace health when no graphs exist", async () => {
        const res = await fetch(`http://localhost:${port}/workspace/health`);
        const data = await res.json();
        // No registered projects with graphs in test environment
        (0, vitest_1.expect)(data.projects).toEqual([]);
        (0, vitest_1.expect)(data.totalSignals).toBe(0);
        (0, vitest_1.expect)(data.sharedPatterns).toEqual([]);
    });
});
//# sourceMappingURL=station-workspace.test.js.map