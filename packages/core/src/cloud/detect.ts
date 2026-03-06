import type {
  CloudServiceConfig,
  CloudServiceAdapter,
  DetectionEvidence,
  StackInfo,
} from "@opcom/types";
import { TursoAdapter } from "./turso.js";
import { NeonAdapter } from "./neon.js";
import { R2Adapter } from "./r2.js";
import { GCSAdapter } from "./gcs.js";
import { CloudflareWorkersAdapter } from "./workers.js";
import { FirebaseFunctionsAdapter } from "./firebase-functions.js";
import { FirebaseHostingAdapter } from "./firebase-hosting.js";
import { ExpoEASAdapter } from "./expo-eas.js";
import { detectPrisma } from "./prisma.js";

/** All registered database adapters. */
const DATABASE_ADAPTERS: CloudServiceAdapter[] = [
  new TursoAdapter(),
  new NeonAdapter(),
];

/** All registered storage adapters. */
const STORAGE_ADAPTERS: CloudServiceAdapter[] = [
  new R2Adapter(),
  new GCSAdapter(),
];

/** All registered serverless adapters. */
const SERVERLESS_ADAPTERS: CloudServiceAdapter[] = [
  new CloudflareWorkersAdapter(),
  new FirebaseFunctionsAdapter(),
];

/** All registered hosting adapters. */
const HOSTING_ADAPTERS: CloudServiceAdapter[] = [
  new FirebaseHostingAdapter(),
];

/** All registered mobile adapters. */
const MOBILE_ADAPTERS: CloudServiceAdapter[] = [
  new ExpoEASAdapter(),
];

export interface CloudDetectionResult {
  configs: CloudServiceConfig[];
  evidence: DetectionEvidence[];
}

/**
 * Tier 4 cloud service detection.
 * Scans for cloud database configs (Turso, Neon), storage (R2, GCS),
 * and migration tools (Prisma). Additive to existing Tier 1-3 detection.
 */
export async function detectCloudServices(
  projectPath: string,
  stack: StackInfo,
): Promise<CloudDetectionResult> {
  const configs: CloudServiceConfig[] = [];
  const evidence: DetectionEvidence[] = [];

  const allAdapters = [
    ...DATABASE_ADAPTERS,
    ...STORAGE_ADAPTERS,
    ...SERVERLESS_ADAPTERS,
    ...HOSTING_ADAPTERS,
    ...MOBILE_ADAPTERS,
  ];

  // Run all adapter detections in parallel
  const detections = await Promise.all(
    allAdapters.map(async (adapter) => {
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
    case "cloudflare-r2":
      return "wrangler.toml or .env (R2_*)";
    case "gcs":
      return ".env (GCS_BUCKET) or firebase.json";
    case "cloudflare-workers":
      return "wrangler.toml or wrangler.json";
    case "firebase-functions":
      return "firebase.json (functions)";
    case "firebase-hosting":
      return "firebase.json (hosting)";
    case "expo-eas":
      return "app.json or eas.json";
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

/**
 * Get all registered storage adapters.
 */
export function getStorageAdapters(): CloudServiceAdapter[] {
  return [...STORAGE_ADAPTERS];
}

/**
 * Get all registered serverless adapters.
 */
export function getServerlessAdapters(): CloudServiceAdapter[] {
  return [...SERVERLESS_ADAPTERS];
}

/**
 * Get all registered hosting adapters.
 */
export function getHostingAdapters(): CloudServiceAdapter[] {
  return [...HOSTING_ADAPTERS];
}

/**
 * Get all registered mobile adapters.
 */
export function getMobileAdapters(): CloudServiceAdapter[] {
  return [...MOBILE_ADAPTERS];
}
