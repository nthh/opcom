import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Station } from "@opcom/core";

describe("Station Graph API", () => {
  let station: Station;
  let port: number;

  beforeAll(async () => {
    port = 16000 + Math.floor(Math.random() * 1000);
    station = new Station(port, { skipCICD: true, skipReconcile: true, skipInfra: true });
    await station.start();
  }, 30000);

  afterAll(async () => {
    await station.stop();
    await new Promise((r) => setTimeout(r, 100));
  }, 30000);

  it("returns 404 for graph stats of unknown project", async () => {
    const res = await fetch(`http://localhost:${port}/projects/nonexistent/graph/stats`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for graph drift of unknown project", async () => {
    const res = await fetch(`http://localhost:${port}/projects/nonexistent/graph/drift`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for graph build of unknown project", async () => {
    const res = await fetch(`http://localhost:${port}/projects/nonexistent/graph/build`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});
