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

export interface R2Config extends CloudServiceConfig {
  provider: "cloudflare-r2";
  kind: "storage";
  bucket?: string;
  accountId?: string;
  /** Multiple buckets when detected from wrangler.toml [[r2_buckets]] */
  buckets?: string[];
}

interface WranglerR2BucketBinding {
  binding?: string;
  bucket_name?: string;
  preview_bucket_name?: string;
}

/**
 * Parse wrangler.toml to extract [[r2_buckets]] bindings.
 */
export function parseR2Buckets(content: string): string[] {
  const buckets: string[] = [];
  // Match [[r2_buckets]] sections and extract bucket_name
  // TOML array-of-tables: [[r2_buckets]] followed by key=value pairs
  const sectionRegex = /\[\[r2_buckets\]\]([\s\S]*?)(?=\[\[|\[(?!\[)|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(content)) !== null) {
    const section = match[1];
    const nameMatch = section.match(/^\s*bucket_name\s*=\s*["']([^"']+)["']/m);
    if (nameMatch) {
      buckets.push(nameMatch[1]);
    }
  }
  return buckets;
}

/**
 * Run a wrangler CLI command, returning parsed JSON or null on failure.
 */
async function wranglerCmd(args: string[]): Promise<unknown | null> {
  try {
    const { stdout } = await execFileAsync("wrangler", args, { timeout: 15_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Resolve Cloudflare auth — check wrangler login or env var.
 */
function resolveApiToken(): string | null {
  return process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN ?? null;
}

function resolveAccountId(): string | null {
  return process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID ?? null;
}

/**
 * Call the Cloudflare API.
 */
async function cfApi<T>(path: string, token: string): Promise<T | null> {
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { success: boolean; result: T };
    if (!body.success) return null;
    return body.result;
  } catch {
    return null;
  }
}

/**
 * Detect Cloudflare R2 usage from project files.
 */
export async function detectR2(
  projectPath: string,
  _stack: StackInfo,
): Promise<R2Config | null> {
  // Check wrangler.toml for [[r2_buckets]]
  for (const wranglerFile of ["wrangler.toml", "wrangler.jsonc", "wrangler.json"]) {
    const wranglerPath = join(projectPath, wranglerFile);
    if (!existsSync(wranglerPath)) continue;
    try {
      const content = await readFile(wranglerPath, "utf-8");

      if (wranglerFile === "wrangler.toml") {
        const buckets = parseR2Buckets(content);
        if (buckets.length > 0) {
          // Also try to extract account_id from wrangler.toml
          const accountMatch = content.match(/account_id\s*=\s*["']([^"']+)["']/);
          return {
            provider: "cloudflare-r2",
            kind: "storage",
            name: buckets[0],
            bucket: buckets[0],
            buckets,
            accountId: accountMatch?.[1],
          };
        }
      } else {
        // JSON/JSONC format
        const cleaned = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
        const parsed = JSON.parse(cleaned) as {
          r2_buckets?: WranglerR2BucketBinding[];
          account_id?: string;
        };
        if (parsed.r2_buckets && parsed.r2_buckets.length > 0) {
          const buckets = parsed.r2_buckets
            .map((b) => b.bucket_name)
            .filter((n): n is string => !!n);
          if (buckets.length > 0) {
            return {
              provider: "cloudflare-r2",
              kind: "storage",
              name: buckets[0],
              bucket: buckets[0],
              buckets,
              accountId: parsed.account_id,
            };
          }
        }
      }
    } catch {
      continue;
    }
  }

  // Check .env files for R2_ prefixed variables
  for (const envFile of [".env", ".env.local", ".env.production"]) {
    const envPath = join(projectPath, envFile);
    if (!existsSync(envPath)) continue;
    try {
      const content = await readFile(envPath, "utf-8");
      const bucketMatch = content.match(
        /^R2_BUCKET(?:_NAME)?\s*=\s*["']?([^\s"']+)/m,
      );
      if (bucketMatch) {
        const accountMatch = content.match(
          /^(?:CLOUDFLARE_ACCOUNT_ID|CF_ACCOUNT_ID)\s*=\s*["']?([^\s"']+)/m,
        );
        return {
          provider: "cloudflare-r2",
          kind: "storage",
          name: bucketMatch[1],
          bucket: bucketMatch[1],
          accountId: accountMatch?.[1],
        };
      }
    } catch {
      continue;
    }
  }

  // Check package.json scripts for wrangler r2 commands
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const content = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(content);
      const scripts = pkg.scripts ?? {};
      const hasR2Script = Object.values(scripts).some(
        (cmd) => typeof cmd === "string" && cmd.includes("wrangler r2"),
      );
      if (hasR2Script) {
        return {
          provider: "cloudflare-r2",
          kind: "storage",
          name: "r2-bucket",
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

interface CfR2Bucket {
  name: string;
  creation_date?: string;
  location?: { hint?: string };
}

/**
 * Get Cloudflare R2 status.
 */
export async function getR2Status(config: R2Config): Promise<CloudService> {
  const now = new Date().toISOString();
  const serviceId = `cloudflare-r2:${config.name}`;

  let health: CloudServiceHealth = "unknown";
  const bucketInfos: BucketInfo[] = [];

  const token = resolveApiToken();
  const accountId = config.accountId ?? resolveAccountId();

  if (token && accountId) {
    // Use Cloudflare API to list/check buckets
    const result = await cfApi<{ buckets: CfR2Bucket[] }>(
      `/accounts/${accountId}/r2/buckets`,
      token,
    );

    if (result?.buckets) {
      health = "healthy";
      const targetBuckets = config.buckets ?? (config.bucket ? [config.bucket] : []);

      for (const targetName of targetBuckets) {
        const found = result.buckets.find((b) => b.name === targetName);
        bucketInfos.push({
          name: targetName,
          region: found?.location?.hint,
          publicAccess: false, // R2 buckets are private by default
        });
      }

      // If no specific buckets configured, report all
      if (targetBuckets.length === 0) {
        for (const b of result.buckets) {
          bucketInfos.push({
            name: b.name,
            region: b.location?.hint,
            publicAccess: false,
          });
        }
      }
    }
  }

  // If API failed, try wrangler CLI
  if (health === "unknown") {
    const targetBuckets = config.buckets ?? (config.bucket ? [config.bucket] : []);
    for (const bucketName of targetBuckets) {
      // Try listing objects to verify bucket exists
      const result = await wranglerCmd(["r2", "bucket", "list", "--json"]);
      if (result && Array.isArray(result)) {
        health = "healthy";
        const found = (result as CfR2Bucket[]).find((b) => b.name === bucketName);
        bucketInfos.push({
          name: bucketName,
          region: found?.location?.hint,
          publicAccess: false,
        });
      }
    }
  }

  // If we have configured buckets but no API access, still list them as unknown
  if (bucketInfos.length === 0) {
    const targetBuckets = config.buckets ?? (config.bucket ? [config.bucket] : []);
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
    provider: "cloudflare-r2",
    kind: "storage",
    name: config.name,
    status: health,
    detail,
    capabilities: ["metrics"],
    lastCheckedAt: now,
    url: accountId
      ? `https://dash.cloudflare.com/${accountId}/r2/overview`
      : "https://dash.cloudflare.com",
  };
}

export class R2Adapter implements CloudServiceAdapter {
  readonly provider: CloudProvider = "cloudflare-r2";
  readonly kind: CloudServiceKind = "storage";

  async detect(projectPath: string, stack: StackInfo): Promise<R2Config | null> {
    return detectR2(projectPath, stack);
  }

  async status(config: CloudServiceConfig): Promise<CloudService> {
    return getR2Status(config as R2Config);
  }

  async metrics(config: CloudServiceConfig, range: TimeRange): Promise<MetricsResult> {
    const r2Config = config as R2Config;
    const token = resolveApiToken();
    const accountId = r2Config.accountId ?? resolveAccountId();

    if (token && accountId) {
      // Cloudflare Analytics API — R2 storage metrics
      const result = await cfApi<{ storageBytes?: number }>(
        `/accounts/${accountId}/r2/buckets/${r2Config.bucket}/usage`,
        token,
      );
      return {
        storageBytes: result?.storageBytes,
        period: range,
      };
    }

    return { period: range };
  }
}
