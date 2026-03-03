import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPortRegistry,
  savePortRegistry,
  findConflict,
  allocatePort,
  releasePort,
  findNextAvailablePort,
  isPortInReservedRange,
} from "@opcom/core";
import type { PortRegistry } from "@opcom/types";

function emptyRegistry(): PortRegistry {
  return {
    allocations: [],
    reservedRanges: [{ start: 1, end: 1023, reason: "system" }],
  };
}

describe("Port Registry — pure functions", () => {
  it("finds no conflict when registry is empty", () => {
    const reg = emptyRegistry();
    expect(findConflict(3000, "proj-a", "web", reg)).toBeNull();
  });

  it("finds a conflict when another project uses the port", () => {
    const reg: PortRegistry = {
      allocations: [
        { port: 3000, projectId: "proj-a", serviceName: "web", allocatedAt: "2026-01-01T00:00:00Z" },
      ],
      reservedRanges: [],
    };
    const conflict = findConflict(3000, "proj-b", "web", reg);
    expect(conflict).not.toBeNull();
    expect(conflict!.projectId).toBe("proj-a");
  });

  it("does not conflict with the same project/service", () => {
    const reg: PortRegistry = {
      allocations: [
        { port: 3000, projectId: "proj-a", serviceName: "web", allocatedAt: "2026-01-01T00:00:00Z" },
      ],
      reservedRanges: [],
    };
    expect(findConflict(3000, "proj-a", "web", reg)).toBeNull();
  });

  it("allocates a port and replaces stale allocations", () => {
    const reg = emptyRegistry();
    const updated = allocatePort(reg, 3000, "proj-a", "web");
    expect(updated.allocations).toHaveLength(1);
    expect(updated.allocations[0].port).toBe(3000);

    // Re-allocate same service to a different port
    const updated2 = allocatePort(updated, 3001, "proj-a", "web");
    expect(updated2.allocations).toHaveLength(1);
    expect(updated2.allocations[0].port).toBe(3001);
  });

  it("releases a port", () => {
    const reg = allocatePort(emptyRegistry(), 3000, "proj-a", "web");
    const released = releasePort(reg, "proj-a", "web");
    expect(released.allocations).toHaveLength(0);
  });

  it("detects reserved port ranges", () => {
    const ranges = [{ start: 1, end: 1023, reason: "system" }];
    expect(isPortInReservedRange(80, ranges)).toBe(true);
    expect(isPortInReservedRange(1023, ranges)).toBe(true);
    expect(isPortInReservedRange(1024, ranges)).toBe(false);
    expect(isPortInReservedRange(3000, ranges)).toBe(false);
  });

  it("finds next available port with offset", () => {
    const reg: PortRegistry = {
      allocations: [
        { port: 3000, projectId: "proj-a", serviceName: "web", allocatedAt: "2026-01-01T00:00:00Z" },
      ],
      reservedRanges: [],
    };
    const next = findNextAvailablePort(3000, reg, 100);
    expect(next).toBe(3100);
  });

  it("skips multiple taken ports", () => {
    const reg: PortRegistry = {
      allocations: [
        { port: 3000, projectId: "proj-a", serviceName: "web", allocatedAt: "2026-01-01T00:00:00Z" },
        { port: 3100, projectId: "proj-b", serviceName: "web", allocatedAt: "2026-01-01T00:00:00Z" },
      ],
      reservedRanges: [],
    };
    const next = findNextAvailablePort(3000, reg, 100);
    expect(next).toBe(3200);
  });

  it("skips reserved ranges when finding next available", () => {
    const reg: PortRegistry = {
      allocations: [],
      reservedRanges: [{ start: 1, end: 1023, reason: "system" }],
    };
    const next = findNextAvailablePort(80, reg, 100);
    // 80 is reserved, 180, 280... all reserved up to 1023. Next offset: 80+11*100=1180
    expect(next).toBeGreaterThan(1023);
  });
});

describe("Port Registry — persistence", () => {
  let tempDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-ports-"));
    origHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = origHome;
    await rm(tempDir, { recursive: true });
  });

  it("loads empty registry when no file exists", async () => {
    const reg = await loadPortRegistry();
    expect(reg.allocations).toHaveLength(0);
    expect(reg.reservedRanges.length).toBeGreaterThan(0);
  });

  it("round-trips a registry through save/load", async () => {
    const reg: PortRegistry = {
      allocations: [
        { port: 3000, projectId: "proj-a", serviceName: "web", allocatedAt: "2026-01-01T00:00:00Z" },
        { port: 5432, projectId: "proj-a", serviceName: "postgres", pid: 1234, allocatedAt: "2026-01-01T00:00:00Z" },
      ],
      reservedRanges: [
        { start: 1, end: 1023, reason: "system" },
        { start: 9000, end: 9100, reason: "user-reserved" },
      ],
    };

    await savePortRegistry(reg);
    const loaded = await loadPortRegistry();

    expect(loaded.allocations).toHaveLength(2);
    expect(loaded.allocations[0].port).toBe(3000);
    expect(loaded.allocations[1].pid).toBe(1234);
    expect(loaded.reservedRanges).toHaveLength(2);
  });
});
