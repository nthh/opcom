import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Station } from "@opcom/core";

describe("Station", () => {
  it("creates a station instance", () => {
    const station = new Station(0);
    expect(station).toBeDefined();
    expect(station.sessionManager).toBeDefined();
    expect(station.messageRouter).toBeDefined();
  });

  it("reports running status", async () => {
    const status = await Station.isRunning();
    expect(typeof status.running).toBe("boolean");
  });
});

describe("Station HTTP API", () => {
  let station: Station;
  let port: number;

  beforeAll(async () => {
    port = 14700 + Math.floor(Math.random() * 1000);
    station = new Station(port, { skipCICD: true, skipReconcile: true });
    await station.start();
  }, 10000);

  afterAll(async () => {
    await station.stop();
    // Give a moment for cleanup
    await new Promise((r) => setTimeout(r, 100));
  }, 10000);

  it("responds to GET /health", async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("ok");
    expect(typeof data.uptime).toBe("number");
  });

  it("responds to GET /agents with empty list", async () => {
    const res = await fetch(`http://localhost:${port}/agents`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });

  it("responds to GET /projects", async () => {
    const res = await fetch(`http://localhost:${port}/projects`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`http://localhost:${port}/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown project", async () => {
    const res = await fetch(`http://localhost:${port}/projects/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("handles CORS preflight", async () => {
    const res = await fetch(`http://localhost:${port}/health`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
  });
});
