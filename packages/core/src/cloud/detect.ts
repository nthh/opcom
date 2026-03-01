import type {
  CloudServiceConfig,
  CloudServiceAdapter,
  DetectionEvidence,
  StackInfo,
} from "@opcom/types";
import { TursoAdapter } from "./turso.js";
import { NeonAdapter } from "./neon.js";
import { detectPrisma } from "./prisma.js";

/** All registered database adapters. */
const DATABASE_ADAPTERS: CloudServiceAdapter[] = [
  new TursoAdapter(),
  new NeonAdapter(),
];

export interface CloudDetectionResult {
  configs: CloudServiceConfig[];
  evidence: DetectionEvidence[];
}

/**
 * Tier 4 cloud service detection.
 * Scans for cloud database configs (Turso, Neon) and migration tools (Prisma).
 * Additive to existing Tier 1-3 detection.
 */
export async function detectCloudServices(
  projectPath: string,
  stack: StackInfo,
): Promise<CloudDetectionResult> {
  const configs: CloudServiceConfig[] = [];
  const evidence: DetectionEvidence[] = [];

  // Run all database adapter detections in parallel
  const detections = await Promise.all(
    DATABASE_ADAPTERS.map(async (adapter) => {
      const config = await adapter.detect(projectPath, stack);
      return { adapter, config };
    }),
  );

  for (const { adapter, config } of detections) {
    if (config) {
      configs.push(config);
      evidence.push({
        file: getDetectionSource(adapter.provider),
        detectedAs: `cloud:${adapter.provider}`,
        details: `${adapter.kind}: ${config.name}`,
      });
    }
  }

  // Detect Prisma overlay (not a standalone adapter, augments DB adapters)
  const prismaConfig = await detectPrisma(projectPath, stack);
  if (prismaConfig) {
    evidence.push({
      file: prismaConfig.schemaPath,
      detectedAs: "cloud:prisma-migrations",
      details: `provider: ${prismaConfig.provider}`,
    });
  }

  return { configs, evidence };
}

function getDetectionSource(provider: string): string {
  switch (provider) {
    case "turso":
      return ".env (TURSO_DATABASE_URL)";
    case "neon":
      return ".env (DATABASE_URL → neon.tech)";
    default:
      return ".env";
  }
}

/**
 * Get all registered database adapters.
 */
export function getDatabaseAdapters(): CloudServiceAdapter[] {
  return [...DATABASE_ADAPTERS];
}
