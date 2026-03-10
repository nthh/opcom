/**
 * Tests for Station workspace health endpoint.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Station } from "@opcom/core";

describe("Station Workspace Health API", () => {
  let station: Station;
  let port: number;

  beforeAll(async () => {
    port = 17000 + Math.floor(Math.random() * 1000);
    station = new Station(port, { skipCICD: true, skipReconcile: true, skipInfra: true });
    await station.start();
  }, 30000);

  afterAll(async () => {
    await station.stop();
    await new Promise((r) => setTimeout(r, 100));
  }, 30000);

  it("GET /workspace/health returns valid response", async () => {
    const res = await fetch(`http://localhost:${port}/workspace/health`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty("projects");
    expect(data).toHaveProperty("totalSignals");
    expect(data).toHaveProperty("sharedPatterns");
    expect(Array.isArray(data.projects)).toBe(true);
    expect(Array.isArray(data.sharedPatterns)).toBe(true);
    expect(typeof data.totalSignals).toBe("number");

    // Validate structure of any returned projects
    for (const project of data.projects) {
      expect(typeof project.projectName).toBe("string");
      expect(typeof project.totalNodes).toBe("number");
      expect(typeof project.totalEdges).toBe("number");
      expect(typeof project.driftSignalCount).toBe("number");
      expect(project.testHealth).toBeDefined();
    }
  });
});
