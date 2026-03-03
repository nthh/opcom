import type { HealthCheckConfig, HealthCheckResult } from "@opcom/types";
import { exec } from "node:child_process";

export function defaultHealthCheck(port?: number): HealthCheckConfig | null {
  if (!port) return null;
  return {
    strategy: "tcp",
    intervalMs: 5000,
    timeoutMs: 3000,
    retries: 3,
    startupGraceMs: 10000,
  };
}

export async function runHealthCheck(config: HealthCheckConfig, port?: number): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    switch (config.strategy) {
      case "tcp":
        return await checkTcp(port ?? 0, config.timeoutMs, start);
      case "http":
        return await checkHttp(port ?? 0, config.httpPath ?? "/", config.timeoutMs, start);
      case "command":
        return await checkCommand(config.command ?? "true", config.timeoutMs, start);
    }
  } catch (err) {
    return {
      healthy: false,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkTcp(port: number, timeoutMs: number, start: number): Promise<HealthCheckResult> {
  const { createConnection } = await import("node:net");
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "localhost" });
    socket.on("connect", () => {
      socket.destroy();
      resolve({
        healthy: true,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
      });
    });
    socket.on("error", (err) => {
      socket.destroy();
      resolve({
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        error: err.message,
      });
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        error: "Connection timed out",
      });
    });
  });
}

async function checkHttp(
  port: number,
  path: string,
  timeoutMs: number,
  start: number,
): Promise<HealthCheckResult> {
  const url = `http://localhost:${port}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const healthy = res.status >= 200 && res.status < 300;
    return {
      healthy,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      error: healthy ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      healthy: false,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkCommand(command: string, timeoutMs: number, start: number): Promise<HealthCheckResult> {
  return new Promise((resolve) => {
    const proc = exec(command, { timeout: timeoutMs }, (err) => {
      resolve({
        healthy: !err,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
        error: err ? err.message : undefined,
      });
    });
    proc.stdin?.end();
  });
}
