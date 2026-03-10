"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const core_1 = require("@opcom/core");
function emptyRegistry() {
    return {
        allocations: [],
        reservedRanges: [{ start: 1, end: 1023, reason: "system" }],
    };
}
(0, vitest_1.describe)("Port Registry — pure functions", () => {
    (0, vitest_1.it)("finds no conflict when registry is empty", () => {
        const reg = emptyRegistry();
        (0, vitest_1.expect)((0, core_1.findConflict)(3000, "proj-a", "web", reg)).toBeNull();
    });
    (0, vitest_1.it)("finds a conflict when another project uses the port", () => {
        const reg = {
            allocations: [
                { port: 3000, projectId: "proj-a", serviceName: "web", allocatedAt: "2026-01-01T00:00:00Z" },
            ],
            reservedRanges: [],
        };
        const conflict = (0, core_1.findConflict)(3000, "proj-b", "web", reg);
        (0, vitest_1.expect)(conflict).not.toBeNull();
        (0, vitest_1.expect)(conflict.projectId).toBe("proj-a");
    });
    (0, vitest_1.it)("does not conflict with the same project/service", () => {
        const reg = {
            allocations: [
                { port: 3000, projectId: "proj-a", serviceName: "web", allocatedAt: "2026-01-01T00:00:00Z" },
            ],
            reservedRanges: [],
        };
        (0, vitest_1.expect)((0, core_1.findConflict)(3000, "proj-a", "web", reg)).toBeNull();
    });
    (0, vitest_1.it)("allocates a port and replaces stale allocations", () => {
        const reg = emptyRegistry();
        const updated = (0, core_1.allocatePort)(reg, 3000, "proj-a", "web");
        (0, vitest_1.expect)(updated.allocations).toHaveLength(1);
        (0, vitest_1.expect)(updated.allocations[0].port).toBe(3000);
        // Re-allocate same service to a different port
        const updated2 = (0, core_1.allocatePort)(updated, 3001, "proj-a", "web");
        (0, vitest_1.expect)(updated2.allocations).toHaveLength(1);
        (0, vitest_1.expect)(updated2.allocations[0].port).toBe(3001);
    });
    (0, vitest_1.it)("releases a port", () => {
        const reg = (0, core_1.allocatePort)(emptyRegistry(), 3000, "proj-a", "web");
        const released = (0, core_1.releasePort)(reg, "proj-a", "web");
        (0, vitest_1.expect)(released.allocations).toHaveLength(0);
    });
    (0, vitest_1.it)("detects reserved port ranges", () => {
        const ranges = [{ start: 1, end: 1023, reason: "system" }];
        (0, vitest_1.expect)((0, core_1.isPortInReservedRange)(80, ranges)).toBe(true);
        (0, vitest_1.expect)((0, core_1.isPortInReservedRange)(1023, ranges)).toBe(true);
        (0, vitest_1.expect)((0, core_1.isPortInReservedRange)(1024, ranges)).toBe(false);
        (0, vitest_1.expect)((0, core_1.isPortInReservedRange)(3000, ranges)).toBe(false);
    });
    (0, vitest_1.it)("finds next available port with offset", () => {
        const reg = {
            allocations: [
                { port: 3000, projectId: "proj-a", serviceName: "web", allocatedAt: "2026-01-01T00:00:00Z" },
            ],
            reservedRanges: [],
        };
        const next = (0, core_1.findNextAvailablePort)(3000, reg, 100);
        (0, vitest_1.expect)(next).toBe(3100);
    });
    (0, vitest_1.it)("skips multiple taken ports", () => {
        const reg = {
            allocations: [
                { port: 3000, projectId: "proj-a", serviceName: "web", allocatedAt: "2026-01-01T00:00:00Z" },
                { port: 3100, projectId: "proj-b", serviceName: "web", allocatedAt: "2026-01-01T00:00:00Z" },
            ],
            reservedRanges: [],
        };
        const next = (0, core_1.findNextAvailablePort)(3000, reg, 100);
        (0, vitest_1.expect)(next).toBe(3200);
    });
    (0, vitest_1.it)("skips reserved ranges when finding next available", () => {
        const reg = {
            allocations: [],
            reservedRanges: [{ start: 1, end: 1023, reason: "system" }],
        };
        const next = (0, core_1.findNextAvailablePort)(80, reg, 100);
        // 80 is reserved, 180, 280... all reserved up to 1023. Next offset: 80+11*100=1180
        (0, vitest_1.expect)(next).toBeGreaterThan(1023);
    });
});
(0, vitest_1.describe)("Port Registry — persistence", () => {
    let tempDir;
    let origHome;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-ports-"));
        origHome = process.env.HOME;
        process.env.HOME = tempDir;
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.HOME = origHome;
        await (0, promises_1.rm)(tempDir, { recursive: true });
    });
    (0, vitest_1.it)("loads empty registry when no file exists", async () => {
        const reg = await (0, core_1.loadPortRegistry)();
        (0, vitest_1.expect)(reg.allocations).toHaveLength(0);
        (0, vitest_1.expect)(reg.reservedRanges.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("round-trips a registry through save/load", async () => {
        const reg = {
            allocations: [
                { port: 3000, projectId: "proj-a", serviceName: "web", allocatedAt: "2026-01-01T00:00:00Z" },
                { port: 5432, projectId: "proj-a", serviceName: "postgres", pid: 1234, allocatedAt: "2026-01-01T00:00:00Z" },
            ],
            reservedRanges: [
                { start: 1, end: 1023, reason: "system" },
                { start: 9000, end: 9100, reason: "user-reserved" },
            ],
        };
        await (0, core_1.savePortRegistry)(reg);
        const loaded = await (0, core_1.loadPortRegistry)();
        (0, vitest_1.expect)(loaded.allocations).toHaveLength(2);
        (0, vitest_1.expect)(loaded.allocations[0].port).toBe(3000);
        (0, vitest_1.expect)(loaded.allocations[1].pid).toBe(1234);
        (0, vitest_1.expect)(loaded.reservedRanges).toHaveLength(2);
    });
});
//# sourceMappingURL=port-registry.test.js.map