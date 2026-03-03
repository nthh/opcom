import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { PortRegistry, PortAllocation, PortRange } from "@opcom/types";
import { portsPath } from "./paths.js";

function emptyRegistry(): PortRegistry {
  return {
    allocations: [],
    reservedRanges: [{ start: 1, end: 1023, reason: "system" }],
  };
}

export async function loadPortRegistry(): Promise<PortRegistry> {
  const path = portsPath();
  if (!existsSync(path)) return emptyRegistry();
  const raw = await readFile(path, "utf-8");
  const data = parseYaml(raw) as Partial<PortRegistry> | null;
  return {
    allocations: Array.isArray(data?.allocations) ? data.allocations : [],
    reservedRanges: Array.isArray(data?.reservedRanges)
      ? data.reservedRanges
      : [{ start: 1, end: 1023, reason: "system" }],
  };
}

export async function savePortRegistry(registry: PortRegistry): Promise<void> {
  const path = portsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml(registry, { lineWidth: 120 }), "utf-8");
}

export function isPortInReservedRange(port: number, ranges: PortRange[]): boolean {
  return ranges.some((r) => port >= r.start && port <= r.end);
}

export function findConflict(
  port: number,
  projectId: string,
  serviceName: string,
  registry: PortRegistry,
): PortAllocation | null {
  return (
    registry.allocations.find(
      (a) => a.port === port && !(a.projectId === projectId && a.serviceName === serviceName),
    ) ?? null
  );
}

export function allocatePort(
  registry: PortRegistry,
  port: number,
  projectId: string,
  serviceName: string,
  pid?: number,
): PortRegistry {
  // Remove any stale allocation for this service
  const allocations = registry.allocations.filter(
    (a) => !(a.projectId === projectId && a.serviceName === serviceName),
  );
  allocations.push({
    port,
    projectId,
    serviceName,
    pid,
    allocatedAt: new Date().toISOString(),
  });
  return { ...registry, allocations };
}

export function releasePort(
  registry: PortRegistry,
  projectId: string,
  serviceName: string,
): PortRegistry {
  return {
    ...registry,
    allocations: registry.allocations.filter(
      (a) => !(a.projectId === projectId && a.serviceName === serviceName),
    ),
  };
}

export function findNextAvailablePort(
  basePort: number,
  registry: PortRegistry,
  offsetStep: number = 100,
): number {
  let port = basePort;
  const maxAttempts = 20;
  for (let i = 0; i < maxAttempts; i++) {
    const taken = registry.allocations.some((a) => a.port === port);
    const reserved = isPortInReservedRange(port, registry.reservedRanges);
    if (!taken && !reserved) return port;
    port = basePort + (i + 1) * offsetStep;
  }
  return port;
}
