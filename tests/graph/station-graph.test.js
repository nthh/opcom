"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("Station Graph API", () => {
    let station;
    let port;
    (0, vitest_1.beforeAll)(async () => {
        port = 16000 + Math.floor(Math.random() * 1000);
        station = new core_1.Station(port, { skipCICD: true, skipReconcile: true, skipInfra: true });
        await station.start();
    }, 30000);
    (0, vitest_1.afterAll)(async () => {
        await station.stop();
        await new Promise((r) => setTimeout(r, 100));
    }, 30000);
    (0, vitest_1.it)("returns 404 for graph stats of unknown project", async () => {
        const res = await fetch(`http://localhost:${port}/projects/nonexistent/graph/stats`);
        (0, vitest_1.expect)(res.status).toBe(404);
    });
    (0, vitest_1.it)("returns 404 for graph drift of unknown project", async () => {
        const res = await fetch(`http://localhost:${port}/projects/nonexistent/graph/drift`);
        (0, vitest_1.expect)(res.status).toBe(404);
    });
    (0, vitest_1.it)("returns 404 for graph build of unknown project", async () => {
        const res = await fetch(`http://localhost:${port}/projects/nonexistent/graph/build`, {
            method: "POST",
        });
        (0, vitest_1.expect)(res.status).toBe(404);
    });
});
//# sourceMappingURL=station-graph.test.js.map