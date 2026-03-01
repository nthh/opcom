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
  DatabaseDetail,
  MigrateResult,
  MetricsResult,
  TimeRange,
  StackInfo,
} from "@opcom/types";

export interface NeonConfig extends CloudServiceConfig {
  provider: "neon";
  kind: "database";
  connectionUrl?: string;
  projectId?: string;
  branchId?: string;
}

interface NeonApiProject {
  id: string;
  name: string;
  region_id?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

interface NeonApiBranch {
  id: string;
  name: string;
  current_state?: string;
  logical_size?: number;
  [key: string]: unknown;
}

/**
 * Extract database name from a Neon connection URL.
 * e.g. "postgres://user:pw@ep-cool-bar-123.us-east-2.aws.neon.tech/mydb" → "mydb"
 */
export function parseNeonUrl(url: string): { name: string; host: string } | null {
  const match = url.match(
    /(?:postgres(?:ql)?):\/\/[^@]+@([^/]+\.neon\.tech)\/([^?\s]+)/i,
  );
  if (match) {
    return { host: match[1], name: match[2] };
  }
  return null;
}

/**
 * Check if a connection URL points to Neon.
 */
export function isNeonUrl(url: string): boolean {
  return /\.neon\.tech/i.test(url);
}

/**
 * Resolve Neon API key from environment or credentials file.
 */
function resolveApiKey(): string | null {
  if (process.env.NEON_API_KEY) return process.env.NEON_API_KEY;
  // Could also check ~/.neon/credentials.json but env is simpler
  return null;
}

/**
 * Call the Neon API.
 */
async function neonApi<T>(path: string, apiKey: string): Promise<T | null> {
  try {
    const response = await fetch(`https://console.neon.tech/api/v2${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Detect Neon usage from project files.
 */
export async function detectNeon(
  projectPath: string,
  _stack: StackInfo,
): Promise<NeonConfig | null> {
  // Check .env files for DATABASE_URL pointing to neon.tech
  for (const envFile of [".env", ".env.local", ".env.production"]) {
    const envPath = join(projectPath, envFile);
    if (!existsSync(envPath)) continue;
    try {
      const content = await readFile(envPath, "utf-8");
      // Look for any URL containing neon.tech
      const urlMatch = content.match(
        /^(?:DATABASE_URL|POSTGRES_URL|NEON_DATABASE_URL)\s*=\s*["']?([^\s"']+neon\.tech[^\s"']*)/m,
      );
      if (urlMatch) {
        const url = urlMatch[1];
        const parsed = parseNeonUrl(url);
        return {
          provider: "neon",
          kind: "database",
          name: parsed?.name ?? "neon-db",
          connectionUrl: url,
        };
      }
    } catch {
      continue;
    }
  }

  // Check prisma/schema.prisma for neon connection
  const schemaPath = join(projectPath, "prisma", "schema.prisma");
  if (existsSync(schemaPath)) {
    try {
      const content = await readFile(schemaPath, "utf-8");
      if (
        content.includes('provider = "postgresql"') ||
        content.includes("provider = \"postgres\"")
      ) {
        // Check if the env reference points to neon
        const envUrlMatch = content.match(/env\("([^"]+)"\)/);
        if (envUrlMatch) {
          const envVar = envUrlMatch[1];
          // Check actual env for neon URL
          for (const envFile of [".env", ".env.local"]) {
            const envPath = join(projectPath, envFile);
            if (!existsSync(envPath)) continue;
            try {
              const envContent = await readFile(envPath, "utf-8");
              const re = new RegExp(
                `^${envVar}\\s*=\\s*["']?([^\\s"']+neon\\.tech[^\\s"']*)`,
                "m",
              );
              const match = envContent.match(re);
              if (match) {
                const parsed = parseNeonUrl(match[1]);
                return {
                  provider: "neon",
                  kind: "database",
                  name: parsed?.name ?? "neon-db",
                  connectionUrl: match[1],
                };
              }
            } catch {
              continue;
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Check drizzle.config.ts for neon connection
  for (const drizzleFile of ["drizzle.config.ts", "drizzle.config.js"]) {
    const drizzlePath = join(projectPath, drizzleFile);
    if (!existsSync(drizzlePath)) continue;
    try {
      const content = await readFile(drizzlePath, "utf-8");
      if (content.includes("neon") || content.includes("@neondatabase")) {
        return {
          provider: "neon",
          kind: "database",
          name: "neon-db",
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Mask sensitive parts of a Postgres connection URL.
 */
function maskUrl(url: string): string {
  return url.replace(
    /(postgres(?:ql)?:\/\/)([^:]+):([^@]+)@/,
    "$1$2:***@",
  );
}

/**
 * Get Neon database status.
 */
export async function getNeonStatus(config: NeonConfig): Promise<CloudService> {
  const now = new Date().toISOString();
  const serviceId = `neon:${config.name}`;

  let health: CloudServiceHealth = "unknown";
  let sizeBytes: number | undefined;
  let region: string | undefined;

  const apiKey = resolveApiKey();

  if (apiKey && config.projectId) {
    // Try Neon API for detailed info
    const branches = await neonApi<{ branches: NeonApiBranch[] }>(
      `/projects/${config.projectId}/branches`,
      apiKey,
    );
    if (branches?.branches) {
      health = "healthy";
      const mainBranch = branches.branches.find((b) => b.name === "main") ?? branches.branches[0];
      if (mainBranch?.logical_size) {
        sizeBytes = mainBranch.logical_size;
      }
    }

    const project = await neonApi<{ project: NeonApiProject }>(
      `/projects/${config.projectId}`,
      apiKey,
    );
    if (project?.project?.region_id) {
      region = project.project.region_id;
    }
  } else if (config.connectionUrl) {
    // TCP probe — try connecting to verify reachability
    try {
      const parsed = parseNeonUrl(config.connectionUrl);
      if (parsed) {
        // Simple DNS-level check by attempting a fetch to the host
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          await fetch(`https://${parsed.host}`, {
            signal: controller.signal,
            method: "HEAD",
          });
          health = "healthy";
        } catch {
          // Even a rejected connection means the host is reachable
          health = "unreachable";
        } finally {
          clearTimeout(timeout);
        }
      }
    } catch {
      health = "unreachable";
    }
  }

  const detail: DatabaseDetail = {
    kind: "database",
    engine: "postgres",
    connectionUrl: config.connectionUrl ? maskUrl(config.connectionUrl) : undefined,
    sizeBytes,
    region,
  };

  return {
    id: serviceId,
    projectId: "",
    provider: "neon",
    kind: "database",
    name: config.name,
    status: health,
    detail,
    capabilities: ["migrate", "metrics"],
    lastCheckedAt: now,
    url: "https://console.neon.tech",
  };
}

export class NeonAdapter implements CloudServiceAdapter {
  readonly provider: CloudProvider = "neon";
  readonly kind: CloudServiceKind = "database";

  async detect(projectPath: string, stack: StackInfo): Promise<NeonConfig | null> {
    return detectNeon(projectPath, stack);
  }

  async status(config: CloudServiceConfig): Promise<CloudService> {
    return getNeonStatus(config as NeonConfig);
  }

  async metrics(config: CloudServiceConfig, range: TimeRange): Promise<MetricsResult> {
    const neonConfig = config as NeonConfig;
    const apiKey = resolveApiKey();

    if (apiKey && neonConfig.projectId) {
      const branches = await neonApi<{ branches: NeonApiBranch[] }>(
        `/projects/${neonConfig.projectId}/branches`,
        apiKey,
      );
      const mainBranch = branches?.branches?.find((b) => b.name === "main") ?? branches?.branches?.[0];
      return {
        storageBytes: mainBranch?.logical_size,
        period: range,
      };
    }

    return { period: range };
  }

  async migrate(_config: CloudServiceConfig, _direction: "up" | "status"): Promise<MigrateResult> {
    // Neon migrations are handled by PrismaMigrationOverlay or Drizzle
    return { applied: [], pending: [], error: "Use Prisma or Drizzle for Neon migrations" };
  }
}
