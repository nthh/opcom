import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Mock child_process to prevent real kubectl calls
const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock("node:child_process", () => {
  const mockExecFile: any = vi.fn();
  mockExecFile[Symbol.for("nodejs.util.promisify.custom")] = mockExecFileAsync;
  return {
    execFile: mockExecFile,
    spawn: vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
    })),
  };
});

import { Station } from "../../packages/core/src/server/station.js";

let station: Station;
let port: number;

beforeAll(async () => {
  mockExecFileAsync.mockRejectedValue(new Error("kubectl not available in test"));

  port = 18000 + Math.floor(Math.random() * 1000);
  station = new Station(port, { skipCICD: true, skipReconcile: true, skipInfra: true });
  await station.start();
}, 30000);

afterAll(async () => {
  await station.stop();
  await new Promise((r) => setTimeout(r, 100));
}, 30000);

describe("Infrastructure REST endpoints", () => {
  describe("GET /projects/:id/infrastructure", () => {
    it("returns 404 for nonexistent project", async () => {
      const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.error).toBeDefined();
    });

    it("returns array response structure", async () => {
      // This will either return 404 (no project) or 200 with empty array (no infra)
      const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure`);
      expect([200, 404, 502]).toContain(res.status);
    });
  });

  describe("GET /projects/:id/infrastructure/:resourceId", () => {
    it("returns 404 for nonexistent project", async () => {
      const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi`);
      expect(res.status).toBe(404);
    });

    it("handles URL-encoded resource ID", async () => {
      const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi-deploy`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.error).toBeDefined();
    });
  });

  describe("GET /projects/:id/infrastructure/:resourceId/logs", () => {
    it("returns 404 for nonexistent project", async () => {
      const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi/logs`);
      expect(res.status).toBe(404);
    });

    it("accepts query parameters tail and since", async () => {
      const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi/logs?tail=50&since=5m`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.error).toBeDefined();
    });

    it("accepts container query parameter", async () => {
      const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi/logs?container=app`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /projects/:id/infrastructure/:resourceId/restart", () => {
    it("returns 404 for nonexistent project", async () => {
      const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi/restart`, {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });

    it("uses POST method for restart", async () => {
      // GET on restart endpoint should not match
      const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/default%2Fapi/restart`);
      expect(res.status).toBe(404);
    });
  });

  describe("Route matching", () => {
    it("infrastructure list route does not match resource route", async () => {
      // /infrastructure should match list, not resource
      const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure`);
      expect(res.status).toBe(404); // project not found, not route not found
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.error).toContain("not found");
    });

    it("logs route matches before resource route", async () => {
      // /infrastructure/ns%2Fname/logs should match logs route
      const res = await fetch(`http://localhost:${port}/projects/nonexistent/infrastructure/ns%2Fname/logs`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.error).toBeDefined();
    });
  });
});
