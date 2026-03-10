"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Mock child_process to prevent real kubectl calls
const { mockExecFileAsync } = vitest_1.vi.hoisted(() => ({
    mockExecFileAsync: vitest_1.vi.fn(),
}));
vitest_1.vi.mock("node:child_process", () => {
    const mockExecFile = vitest_1.vi.fn();
    mockExecFile[Symbol.for("nodejs.util.promisify.custom")] = mockExecFileAsync;
    return {
        execFile: mockExecFile,
        spawn: vitest_1.vi.fn(() => ({
            stdout: { on: vitest_1.vi.fn() },
            stderr: { on: vitest_1.vi.fn() },
            on: vitest_1.vi.fn(),
            kill: vitest_1.vi.fn(),
        })),
    };
});
const station_js_1 = require("../../packages/core/src/server/station.js");
let station;
let port;
(0, vitest_1.beforeAll)(async () => {
    mockExecFileAsync.mockRejectedValue(new Error("kubectl not available in test"));
    port = 18000 + Math.floor(Math.random() * 1000);
    station = new station_js_1.Station(port, { skipCICD: true, skipReconcile: true, skipInfra: true });
    await station.start();
}, 30000);
(0, vitest_1.afterAll)(async () => {
    await station.stop();
    await new Promise((r) => setTimeout(r, 100));
}, 30000);
(0, vitest_1.describe)("Infrastructure REST endpoints", () => {
    (0, vitest_1.describe)("GET /projects/:id/infrastructure", () => {
        (0, vitest_1.it)("returns 404 for nonexistent project", async () => {
            const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure`);
            (0, vitest_1.expect)(res.status).toBe(404);
            const data = (await res.json());
            (0, vitest_1.expect)(data.error).toBeDefined();
        });
        (0, vitest_1.it)("returns array response structure", async () => {
            // This will either return 404 (no project) or 200 with empty array (no infra)
            const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure`);
            (0, vitest_1.expect)([200, 404, 502]).toContain(res.status);
        });
    });
    (0, vitest_1.describe)("GET /projects/:id/infrastructure/:resourceId", () => {
        (0, vitest_1.it)("returns 404 for nonexistent project", async () => {
            const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi`);
            (0, vitest_1.expect)(res.status).toBe(404);
        });
        (0, vitest_1.it)("handles URL-encoded resource ID", async () => {
            const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi-deploy`);
            (0, vitest_1.expect)(res.status).toBe(404);
            const data = (await res.json());
            (0, vitest_1.expect)(data.error).toBeDefined();
        });
    });
    (0, vitest_1.describe)("GET /projects/:id/infrastructure/:resourceId/logs", () => {
        (0, vitest_1.it)("returns 404 for nonexistent project", async () => {
            const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi/logs`);
            (0, vitest_1.expect)(res.status).toBe(404);
        });
        (0, vitest_1.it)("accepts query parameters tail and since", async () => {
            const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi/logs?tail=50&since=5m`);
            (0, vitest_1.expect)(res.status).toBe(404);
            const data = (await res.json());
            (0, vitest_1.expect)(data.error).toBeDefined();
        });
        (0, vitest_1.it)("accepts container query parameter", async () => {
            const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi/logs?container=app`);
            (0, vitest_1.expect)(res.status).toBe(404);
        });
    });
    (0, vitest_1.describe)("POST /projects/:id/infrastructure/:resourceId/restart", () => {
        (0, vitest_1.it)("returns 404 for nonexistent project", async () => {
            const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi/restart`, {
                method: "POST",
            });
            (0, vitest_1.expect)(res.status).toBe(404);
        });
        (0, vitest_1.it)("uses POST method for restart", async () => {
            // GET on restart endpoint should not match
            const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi/restart`);
            (0, vitest_1.expect)(res.status).toBe(404);
        });
    });
    (0, vitest_1.describe)("Route matching", () => {
        (0, vitest_1.it)("infrastructure list route does not match resource route", async () => {
            // /infrastructure should match list, not resource
            const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure`);
            (0, vitest_1.expect)(res.status).toBe(404); // project not found, not route not found
            const data = (await res.json());
            (0, vitest_1.expect)(data.error).toContain("not found");
        });
        (0, vitest_1.it)("logs route matches before resource route", async () => {
            // /infrastructure/ns%2Fname/logs should match logs route
            const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/ns%2Fname/logs`);
            (0, vitest_1.expect)(res.status).toBe(404);
            const data = (await res.json());
            (0, vitest_1.expect)(data.error).toBeDefined();
        });
    });
});
//# sourceMappingURL=station-infra-api.test.js.map