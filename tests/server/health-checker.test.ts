import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:net";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { defaultHealthCheck, runHealthCheck } from "@opcom/core";
import type { HealthCheckConfig } from "@opcom/types";

describe("defaultHealthCheck", () => {
  it("returns tcp config for services with a port", () => {
    const config = defaultHealthCheck(3000);
    expect(config).not.toBeNull();
    expect(config!.strategy).toBe("tcp");
    expect(config!.intervalMs).toBe(5000);
  });

  it("returns null for services without a port", () => {
    expect(defaultHealthCheck(undefined)).toBeNull();
    expect(defaultHealthCheck()).toBeNull();
  });
});

describe("runHealthCheck — TCP", () => {
  let server: Server;

  afterEach(() => {
    if (server) server.close();
  });

  it("reports healthy when port is listening", async () => {
    const port = 19876;
    server = createServer();
    await new Promise<void>((resolve) => server.listen(port, resolve));

    const config: HealthCheckConfig = {
      strategy: "tcp",
      intervalMs: 1000,
      timeoutMs: 2000,
      retries: 1,
      startupGraceMs: 0,
    };

    const result = await runHealthCheck(config, port);
    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports unhealthy when port is not listening", async () => {
    const config: HealthCheckConfig = {
      strategy: "tcp",
      intervalMs: 1000,
      timeoutMs: 1000,
      retries: 1,
      startupGraceMs: 0,
    };

    const result = await runHealthCheck(config, 19877);
    expect(result.healthy).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("runHealthCheck — HTTP", () => {
  let server: HttpServer;

  afterEach(() => {
    if (server) server.close();
  });

  it("reports healthy for 200 response", async () => {
    const port = 19878;
    server = createHttpServer((_, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(port, resolve));

    const config: HealthCheckConfig = {
      strategy: "http",
      httpPath: "/health",
      intervalMs: 1000,
      timeoutMs: 2000,
      retries: 1,
      startupGraceMs: 0,
    };

    const result = await runHealthCheck(config, port);
    expect(result.healthy).toBe(true);
  });

  it("reports unhealthy for 500 response", async () => {
    const port = 19879;
    server = createHttpServer((_, res) => {
      res.writeHead(500);
      res.end("error");
    });
    await new Promise<void>((resolve) => server.listen(port, resolve));

    const config: HealthCheckConfig = {
      strategy: "http",
      httpPath: "/",
      intervalMs: 1000,
      timeoutMs: 2000,
      retries: 1,
      startupGraceMs: 0,
    };

    const result = await runHealthCheck(config, port);
    expect(result.healthy).toBe(false);
    expect(result.error).toContain("500");
  });
});

describe("runHealthCheck — command", () => {
  it("reports healthy for exit code 0", async () => {
    const config: HealthCheckConfig = {
      strategy: "command",
      command: "true",
      intervalMs: 1000,
      timeoutMs: 2000,
      retries: 1,
      startupGraceMs: 0,
    };

    const result = await runHealthCheck(config);
    expect(result.healthy).toBe(true);
  });

  it("reports unhealthy for exit code 1", async () => {
    const config: HealthCheckConfig = {
      strategy: "command",
      command: "false",
      intervalMs: 1000,
      timeoutMs: 2000,
      retries: 1,
      startupGraceMs: 0,
    };

    const result = await runHealthCheck(config);
    expect(result.healthy).toBe(false);
  });
});
