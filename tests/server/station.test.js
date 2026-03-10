"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("Station", () => {
    (0, vitest_1.it)("creates a station instance", () => {
        const station = new core_1.Station(0);
        (0, vitest_1.expect)(station).toBeDefined();
        (0, vitest_1.expect)(station.sessionManager).toBeDefined();
        (0, vitest_1.expect)(station.messageRouter).toBeDefined();
    });
    (0, vitest_1.it)("reports running status", async () => {
        const status = await core_1.Station.isRunning();
        (0, vitest_1.expect)(typeof status.running).toBe("boolean");
    });
});
(0, vitest_1.describe)("Station HTTP API", () => {
    let station;
    let port;
    (0, vitest_1.beforeAll)(async () => {
        port = 14000 + Math.floor(Math.random() * 1000);
        station = new core_1.Station(port, { skipCICD: true, skipReconcile: true, skipInfra: true });
        await station.start();
    }, 30000);
    (0, vitest_1.afterAll)(async () => {
        await station.stop();
        // Give a moment for cleanup
        await new Promise((r) => setTimeout(r, 100));
    }, 30000);
    (0, vitest_1.it)("responds to GET /health", async () => {
        const res = await fetch(`http://localhost:${port}/health`);
        (0, vitest_1.expect)(res.status).toBe(200);
        const data = (await res.json());
        (0, vitest_1.expect)(data.status).toBe("ok");
        (0, vitest_1.expect)(typeof data.uptime).toBe("number");
    });
    (0, vitest_1.it)("responds to GET /agents with empty list", async () => {
        const res = await fetch(`http://localhost:${port}/agents`);
        (0, vitest_1.expect)(res.status).toBe(200);
        const data = (await res.json());
        (0, vitest_1.expect)(Array.isArray(data)).toBe(true);
    });
    (0, vitest_1.it)("responds to GET /projects", async () => {
        const res = await fetch(`http://localhost:${port}/projects`);
        (0, vitest_1.expect)(res.status).toBe(200);
        const data = (await res.json());
        (0, vitest_1.expect)(Array.isArray(data)).toBe(true);
    });
    (0, vitest_1.it)("returns 404 for unknown routes", async () => {
        const res = await fetch(`http://localhost:${port}/nonexistent`);
        (0, vitest_1.expect)(res.status).toBe(404);
    });
    (0, vitest_1.it)("returns 404 for unknown project", async () => {
        const res = await fetch(`http://localhost:${port}/projects/nonexistent`);
        (0, vitest_1.expect)(res.status).toBe(404);
    });
    (0, vitest_1.it)("handles CORS preflight", async () => {
        const res = await fetch(`http://localhost:${port}/health`, { method: "OPTIONS" });
        (0, vitest_1.expect)(res.status).toBe(204);
    });
});
//# sourceMappingURL=station.test.js.map