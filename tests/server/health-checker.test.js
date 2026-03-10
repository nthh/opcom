"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_net_1 = require("node:net");
const node_http_1 = require("node:http");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("defaultHealthCheck", () => {
    (0, vitest_1.it)("returns tcp config for services with a port", () => {
        const config = (0, core_1.defaultHealthCheck)(3000);
        (0, vitest_1.expect)(config).not.toBeNull();
        (0, vitest_1.expect)(config.strategy).toBe("tcp");
        (0, vitest_1.expect)(config.intervalMs).toBe(5000);
    });
    (0, vitest_1.it)("returns null for services without a port", () => {
        (0, vitest_1.expect)((0, core_1.defaultHealthCheck)(undefined)).toBeNull();
        (0, vitest_1.expect)((0, core_1.defaultHealthCheck)()).toBeNull();
    });
});
(0, vitest_1.describe)("runHealthCheck — TCP", () => {
    let server;
    (0, vitest_1.afterEach)(() => {
        if (server)
            server.close();
    });
    (0, vitest_1.it)("reports healthy when port is listening", async () => {
        const port = 19876;
        server = (0, node_net_1.createServer)();
        await new Promise((resolve) => server.listen(port, resolve));
        const config = {
            strategy: "tcp",
            intervalMs: 1000,
            timeoutMs: 2000,
            retries: 1,
            startupGraceMs: 0,
        };
        const result = await (0, core_1.runHealthCheck)(config, port);
        (0, vitest_1.expect)(result.healthy).toBe(true);
        (0, vitest_1.expect)(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
    (0, vitest_1.it)("reports unhealthy when port is not listening", async () => {
        const config = {
            strategy: "tcp",
            intervalMs: 1000,
            timeoutMs: 1000,
            retries: 1,
            startupGraceMs: 0,
        };
        const result = await (0, core_1.runHealthCheck)(config, 19877);
        (0, vitest_1.expect)(result.healthy).toBe(false);
        (0, vitest_1.expect)(result.error).toBeDefined();
    });
});
(0, vitest_1.describe)("runHealthCheck — HTTP", () => {
    let server;
    (0, vitest_1.afterEach)(() => {
        if (server)
            server.close();
    });
    (0, vitest_1.it)("reports healthy for 200 response", async () => {
        const port = 19878;
        server = (0, node_http_1.createServer)((_, res) => {
            res.writeHead(200);
            res.end("ok");
        });
        await new Promise((resolve) => server.listen(port, resolve));
        const config = {
            strategy: "http",
            httpPath: "/health",
            intervalMs: 1000,
            timeoutMs: 2000,
            retries: 1,
            startupGraceMs: 0,
        };
        const result = await (0, core_1.runHealthCheck)(config, port);
        (0, vitest_1.expect)(result.healthy).toBe(true);
    });
    (0, vitest_1.it)("reports unhealthy for 500 response", async () => {
        const port = 19879;
        server = (0, node_http_1.createServer)((_, res) => {
            res.writeHead(500);
            res.end("error");
        });
        await new Promise((resolve) => server.listen(port, resolve));
        const config = {
            strategy: "http",
            httpPath: "/",
            intervalMs: 1000,
            timeoutMs: 2000,
            retries: 1,
            startupGraceMs: 0,
        };
        const result = await (0, core_1.runHealthCheck)(config, port);
        (0, vitest_1.expect)(result.healthy).toBe(false);
        (0, vitest_1.expect)(result.error).toContain("500");
    });
});
(0, vitest_1.describe)("runHealthCheck — command", () => {
    (0, vitest_1.it)("reports healthy for exit code 0", async () => {
        const config = {
            strategy: "command",
            command: "true",
            intervalMs: 1000,
            timeoutMs: 2000,
            retries: 1,
            startupGraceMs: 0,
        };
        const result = await (0, core_1.runHealthCheck)(config);
        (0, vitest_1.expect)(result.healthy).toBe(true);
    });
    (0, vitest_1.it)("reports unhealthy for exit code 1", async () => {
        const config = {
            strategy: "command",
            command: "false",
            intervalMs: 1000,
            timeoutMs: 2000,
            retries: 1,
            startupGraceMs: 0,
        };
        const result = await (0, core_1.runHealthCheck)(config);
        (0, vitest_1.expect)(result.healthy).toBe(false);
    });
});
//# sourceMappingURL=health-checker.test.js.map