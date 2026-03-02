import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CloudServiceAdapter,
  CloudProvider,
  CloudServiceKind,
  CloudServiceConfig,
  CloudService,
  CloudServiceHealth,
  StorageDetail,
  BucketInfo,
  MetricsResult,
  TimeRange,
  StackInfo,
} from "@opcom/types";

const execFileAsync = promisify(execFile);

export interface GCSConfig extends CloudServiceConfig {
  provider: "gcs";
  kind: "storage";
  bucket?: string;
  projectId?: string;
  /** Multiple buckets when detected from config */
  buckets?: string[];
}

/**
 * Run a gsutil command, returning stdout or null on failure.
 */
async function gsutilCmd(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gsutil", args, { timeout: 15_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Run a gcloud command, returning parsed JSON or null on failure.
 */
async function gcloudCmd(args: string[]): Promise<unknown | null> {
  try {
    const { stdout } = await execFileAsync("gcloud", args, { timeout: 15_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Parse a gsutil du -s output to extract size in bytes.
 * Format: "12345  gs://bucket-name"
 */
export function parseGsutilSize(output: string): number | null {
  const match = output.match(/^\s*(\d+)\s+gs:\/\//m);
  if (match) return parseInt(match[1], 10);
  return null;
}

/**
 * Extract GCS bucket names from firebase.json storage config.
 */
export function parseFirebaseStorageBucket(content: string): string | null {
  try {
    const config = JSON.parse(content) as {
      storage?: { bucket?: string; rules?: string };
    };
    if (config.storage?.bucket) {
      return config.storage.bucket;
    }
    // If storage rules exist but no explicit bucket, Firebase uses default bucket
    if (config.storage?.rules) {
      return null; // bucket name derived from project ID at runtime
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/**
 * Detect Google Cloud Storage usage from project files.
 */
export async function detectGCS(
  projectPath: string,
  _stack: StackInfo,
): Promise<GCSConfig | null> {
  // Check .env files for GCS-related variables
  for (const envFile of [".env", ".env.local", ".env.production"]) {
    const envPath = join(projectPath, envFile);
    if (!existsSync(envPath)) continue;
    try {
      const content = await readFile(envPath, "utf-8");

      // Check for explicit GCS_BUCKET
      const bucketMatch = content.match(
        /^GCS_BUCKET(?:_NAME)?\s*=\s*["']?([^\s"']+)/m,
      );
      if (bucketMatch) {
        const projectMatch = content.match(
          /^(?:GOOGLE_CLOUD_PROJECT|GCLOUD_PROJECT|GCP_PROJECT)\s*=\s*["']?([^\s"']+)/m,
        );
        return {
          provider: "gcs",
          kind: "storage",
          name: bucketMatch[1],
          bucket: bucketMatch[1],
          projectId: projectMatch?.[1],
        };
      }

      // Check for GOOGLE_CLOUD_PROJECT with storage context
      const gcpProjectMatch = content.match(
        /^(?:GOOGLE_CLOUD_PROJECT|GCLOUD_PROJECT|GCP_PROJECT)\s*=\s*["']?([^\s"']+)/m,
      );
      if (gcpProjectMatch) {
        // Only treat as GCS if there are also storage-related env vars
        const hasStorageVars =
          /^(?:GOOGLE_CLOUD_STORAGE|GCS_|STORAGE_BUCKET)/m.test(content);
        if (hasStorageVars) {
          return {
            provider: "gcs",
            kind: "storage",
            name: `${gcpProjectMatch[1]}-storage`,
            projectId: gcpProjectMatch[1],
          };
        }
      }
    } catch {
      continue;
    }
  }

  // Check firebase.json for storage rules (Firebase Storage uses GCS)
  const firebasePath = join(projectPath, "firebase.json");
  if (existsSync(firebasePath)) {
    try {
      const content = await readFile(firebasePath, "utf-8");
      const config = JSON.parse(content) as {
        storage?: { bucket?: string; rules?: string };
      };
      if (config.storage) {
        const bucketName = config.storage.bucket;
        // Check .firebaserc for project ID
        let projectId: string | undefined;
        const firebasercPath = join(projectPath, ".firebaserc");
        if (existsSync(firebasercPath)) {
          try {
            const rcContent = await readFile(firebasercPath, "utf-8");
            const rc = JSON.parse(rcContent) as {
              projects?: { default?: string };
            };
            projectId = rc.projects?.default;
          } catch {
            // ignore
          }
        }

        return {
          provider: "gcs",
          kind: "storage",
          name: bucketName ?? (projectId ? `${projectId}.appspot.com` : "firebase-storage"),
          bucket: bucketName ?? (projectId ? `${projectId}.appspot.com` : undefined),
          projectId,
        };
      }
    } catch {
      // ignore
    }
  }

  // Check for gsutil references in package.json scripts
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const content = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(content);
      const scripts = pkg.scripts ?? {};
      for (const [, cmd] of Object.entries(scripts)) {
        if (typeof cmd !== "string") continue;
        // Look for gsutil cp, gsutil rsync, etc.
        const gsutilMatch = cmd.match(/gsutil\s+(?:cp|rsync|ls|du)\s+.*gs:\/\/([^\s/]+)/);
        if (gsutilMatch) {
          return {
            provider: "gcs",
            kind: "storage",
            name: gsutilMatch[1],
            bucket: gsutilMatch[1],
          };
        }
      }
    } catch {
      // ignore
    }
  }

  // Check for GOOGLE_APPLICATION_CREDENTIALS pointing to a service account
  for (const envFile of [".env", ".env.local"]) {
    const envPath = join(projectPath, envFile);
    if (!existsSync(envPath)) continue;
    try {
      const content = await readFile(envPath, "utf-8");
      const credMatch = content.match(
        /^GOOGLE_APPLICATION_CREDENTIALS\s*=\s*["']?([^\s"']+)/m,
      );
      if (credMatch) {
        // Check if the referenced file contains storage-related config
        const credPath = join(projectPath, credMatch[1]);
        if (existsSync(credPath)) {
          try {
            const credContent = await readFile(credPath, "utf-8");
            const cred = JSON.parse(credContent) as { project_id?: string };
            if (cred.project_id) {
              // Only return if there's also evidence of storage usage
              // (env var alone isn't enough — many services use service accounts)
              const hasStorageEvidence =
                content.includes("GCS_") ||
                content.includes("STORAGE_BUCKET") ||
                existsSync(join(projectPath, "firebase.json"));
              if (hasStorageEvidence) {
                return {
                  provider: "gcs",
                  kind: "storage",
                  name: `${cred.project_id}-storage`,
                  projectId: cred.project_id,
                };
              }
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

interface GcloudBucketDescribe {
  name?: string;
  location?: string;
  storageClass?: string;
  iamConfiguration?: {
    publicAccessPrevention?: string;
  };
  [key: string]: unknown;
}

/**
 * Get Google Cloud Storage status.
 */
export async function getGCSStatus(config: GCSConfig): Promise<CloudService> {
  const now = new Date().toISOString();
  const serviceId = `gcs:${config.name}`;

  let health: CloudServiceHealth = "unknown";
  const bucketInfos: BucketInfo[] = [];

  const targetBuckets = config.buckets ?? (config.bucket ? [config.bucket] : []);

  for (const bucketName of targetBuckets) {
    let sizeBytes: number | undefined;
    let region: string | undefined;
    let publicAccess = false;

    // Try gcloud storage buckets describe for metadata
    const describeResult = (await gcloudCmd([
      "storage",
      "buckets",
      "describe",
      `gs://${bucketName}`,
      "--format=json",
    ])) as GcloudBucketDescribe | null;

    if (describeResult) {
      health = "healthy";
      region = describeResult.location;
      publicAccess =
        describeResult.iamConfiguration?.publicAccessPrevention !== "enforced";
    }

    // Try gsutil du for size
    const duOutput = await gsutilCmd(["du", "-s", `gs://${bucketName}`]);
    if (duOutput) {
      health = "healthy";
      sizeBytes = parseGsutilSize(duOutput) ?? undefined;
    }

    bucketInfos.push({
      name: bucketName,
      sizeBytes,
      region,
      publicAccess,
    });
  }

  // If no specific buckets, try listing all buckets in the project
  if (targetBuckets.length === 0 && config.projectId) {
    const listResult = await gsutilCmd(["ls", "-p", config.projectId]);
    if (listResult) {
      health = "healthy";
      const bucketNames = listResult
        .split("\n")
        .filter((line) => line.startsWith("gs://"))
        .map((line) => line.replace(/^gs:\/\//, "").replace(/\/$/, ""));
      for (const name of bucketNames) {
        bucketInfos.push({ name, publicAccess: false });
      }
    }
  }

  // If we have configured buckets but no CLI access, still list them
  if (bucketInfos.length === 0 && targetBuckets.length > 0) {
    for (const name of targetBuckets) {
      bucketInfos.push({ name, publicAccess: false });
    }
  }

  const detail: StorageDetail = {
    kind: "storage",
    buckets: bucketInfos,
  };

  return {
    id: serviceId,
    projectId: "",
    provider: "gcs",
    kind: "storage",
    name: config.name,
    status: health,
    detail,
    capabilities: ["metrics"],
    lastCheckedAt: now,
    url: config.bucket
      ? `https://console.cloud.google.com/storage/browser/${config.bucket}`
      : "https://console.cloud.google.com/storage",
  };
}

export class GCSAdapter implements CloudServiceAdapter {
  readonly provider: CloudProvider = "gcs";
  readonly kind: CloudServiceKind = "storage";

  async detect(projectPath: string, stack: StackInfo): Promise<GCSConfig | null> {
    return detectGCS(projectPath, stack);
  }

  async status(config: CloudServiceConfig): Promise<CloudService> {
    return getGCSStatus(config as GCSConfig);
  }

  async metrics(config: CloudServiceConfig, range: TimeRange): Promise<MetricsResult> {
    const gcsConfig = config as GCSConfig;
    if (gcsConfig.bucket) {
      const duOutput = await gsutilCmd(["du", "-s", `gs://${gcsConfig.bucket}`]);
      if (duOutput) {
        const sizeBytes = parseGsutilSize(duOutput);
        return {
          storageBytes: sizeBytes ?? undefined,
          period: range,
        };
      }
    }
    return { period: range };
  }
}
