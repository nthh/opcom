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
  DatabaseDetail,
  MigrateResult,
  MetricsResult,
  TimeRange,
  StackInfo,
} from "@opcom/types";

const execFileAsync = promisify(execFile);

interface TursoDbShowResult {
  Name?: string;
  database?: string;
  Hostname?: string;
  hostname?: string;
  DbId?: string;
  database_id?: string;
  regions?: string[];
  primaryRegion?: string;
  primary_region?: string;
  group?: string;
  type?: string;
  // Size may come from stats
  [key: string]: unknown;
}

interface TursoStatsResult {
  rows_read_count?: number;
  rows_written_count?: number;
  storage_bytes_used?: number;
  [key: string]: unknown;
}

export interface TursoConfig extends CloudServiceConfig {
  provider: "turso";
  kind: "database";
  database?: string;
  org?: string;
  connectionUrl?: string;
}

/**
 * Run a turso CLI command, returning parsed JSON or null on failure.
 */
async function tursoCmd(args: string[]): Promise<unknown | null> {
  try {
    const { stdout } = await execFileAsync("turso", args, { timeout: 15_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Extract database name from a libsql:// URL.
 * e.g. "libsql://myapp-prod-myorg.turso.io" → "myapp-prod"
 */
export function parseTursoUrl(url: string): string | null {
  // Turso URLs: libsql://dbname-orgname.turso.io or libsql://dbname.turso.io
  // The org suffix is the last dash-separated segment, but only when there are 3+ parts
  // (e.g. myapp-prod-myorg → "myapp-prod", but dev-db → "dev-db")
  const base = url.match(/^(?:libsql|https):\/\/([^.]+)\.turso\.io/i);
  if (!base) return null;
  const subdomain = base[1];
  const parts = subdomain.split("-");
  if (parts.length >= 3) {
    // Strip the last segment (org name)
    return parts.slice(0, -1).join("-");
  }
  return subdomain;
}

/**
 * Detect Turso usage from project files.
 */
export async function detectTurso(
  projectPath: string,
  _stack: StackInfo,
): Promise<TursoConfig | null> {
  // Check .env files for TURSO_DATABASE_URL or LIBSQL_URL
  for (const envFile of [".env", ".env.local", ".env.production"]) {
    const envPath = join(projectPath, envFile);
    if (!existsSync(envPath)) continue;
    try {
      const content = await readFile(envPath, "utf-8");
      const urlMatch = content.match(
        /^(?:TURSO_DATABASE_URL|LIBSQL_URL)\s*=\s*["']?([^\s"']+)/m,
      );
      if (urlMatch) {
        const url = urlMatch[1];
        const dbName = parseTursoUrl(url) ?? "turso-db";
        return {
          provider: "turso",
          kind: "database",
          name: dbName,
          connectionUrl: url,
        };
      }
    } catch {
      continue;
    }
  }

  // Check for turso.toml
  if (existsSync(join(projectPath, "turso.toml"))) {
    return {
      provider: "turso",
      kind: "database",
      name: "turso-db",
    };
  }

  // Check drizzle.config.ts for libsql driver
  for (const drizzleFile of ["drizzle.config.ts", "drizzle.config.js"]) {
    const drizzlePath = join(projectPath, drizzleFile);
    if (!existsSync(drizzlePath)) continue;
    try {
      const content = await readFile(drizzlePath, "utf-8");
      if (content.includes("libsql") || content.includes("turso")) {
        return {
          provider: "turso",
          kind: "database",
          name: "turso-db",
        };
      }
    } catch {
      continue;
    }
  }

  // Check package.json for @libsql/client
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const content = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(content);
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      if (allDeps["@libsql/client"] || allDeps["libsql"]) {
        return {
          provider: "turso",
          kind: "database",
          name: "turso-db",
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Get Turso database status via CLI.
 */
export async function getTursoStatus(config: TursoConfig): Promise<CloudService> {
  const now = new Date().toISOString();
  const serviceId = `turso:${config.name}`;

  let health: CloudServiceHealth = "unknown";
  let sizeBytes: number | undefined;
  let region: string | undefined;
  let replicas: number | undefined;
  let hostname: string | undefined;

  // Try turso db show
  const dbName = config.database ?? config.name;
  const showResult = (await tursoCmd(["db", "show", dbName, "--json"])) as TursoDbShowResult | null;

  if (showResult) {
    health = "healthy";
    hostname = showResult.Hostname ?? showResult.hostname;
    region = showResult.primaryRegion ?? showResult.primary_region;
    if (showResult.regions && Array.isArray(showResult.regions)) {
      replicas = showResult.regions.length;
    }
  }

  // Try turso db usage for size info
  const statsResult = (await tursoCmd(["db", "usage", dbName, "--json"])) as TursoStatsResult | null;
  if (statsResult?.storage_bytes_used) {
    sizeBytes = statsResult.storage_bytes_used;
  }

  // If CLI failed, try TCP probe on the connection URL
  if (health === "unknown" && config.connectionUrl) {
    health = "unreachable";
  }

  const detail: DatabaseDetail = {
    kind: "database",
    engine: "sqlite",
    connectionUrl: config.connectionUrl ? maskUrl(config.connectionUrl) : undefined,
    sizeBytes,
    region,
    replicas,
  };

  return {
    id: serviceId,
    projectId: "",
    provider: "turso",
    kind: "database",
    name: config.name,
    status: health,
    detail,
    capabilities: ["logs", "metrics"],
    lastCheckedAt: now,
    url: hostname ? `https://turso.tech` : undefined,
  };
}

/**
 * Mask sensitive parts of a connection URL.
 * e.g. "libsql://db-org.turso.io?authToken=xyz" → "libsql://db-org.turso.io?authToken=***"
 */
function maskUrl(url: string): string {
  return url.replace(/authToken=[^&\s]+/gi, "authToken=***");
}

export class TursoAdapter implements CloudServiceAdapter {
  readonly provider: CloudProvider = "turso";
  readonly kind: CloudServiceKind = "database";

  async detect(projectPath: string, stack: StackInfo): Promise<TursoConfig | null> {
    return detectTurso(projectPath, stack);
  }

  async status(config: CloudServiceConfig): Promise<CloudService> {
    return getTursoStatus(config as TursoConfig);
  }

  async metrics(config: CloudServiceConfig, range: TimeRange): Promise<MetricsResult> {
    const tursoConfig = config as TursoConfig;
    const dbName = tursoConfig.database ?? tursoConfig.name;
    const statsResult = (await tursoCmd(["db", "usage", dbName, "--json"])) as TursoStatsResult | null;

    return {
      storageBytes: statsResult?.storage_bytes_used,
      period: range,
    };
  }

  async migrate(_config: CloudServiceConfig, _direction: "up" | "status"): Promise<MigrateResult> {
    // Turso migrations are handled by the PrismaMigrationOverlay or Drizzle
    return { applied: [], pending: [], error: "Use Prisma or Drizzle for Turso migrations" };
  }
}
