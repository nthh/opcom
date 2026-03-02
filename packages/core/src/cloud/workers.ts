import { execFile, spawn } from "node:child_process";
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
  ServerlessDetail,
  FunctionInfo,
  LogOptions,
  LogLine,
  DeployOptions,
  DeployResult,
  MetricsResult,
  TimeRange,
  StackInfo,
} from "@opcom/types";

const execFileAsync = promisify(execFile);

export interface WorkersConfig extends CloudServiceConfig {
  provider: "cloudflare-workers";
  kind: "serverless";
  workerName?: string;
  routes?: string[];
  crons?: string[];
  accountId?: string;
  configFile?: string; // "wrangler.toml" or "wrangler.json" etc.
}

interface WranglerDeployment {
  id?: string;
  created_on?: string;
  source?: string;
  [key: string]: unknown;
}

/**
 * Run a wrangler CLI command, returning parsed JSON or null on failure.
 */
async function wranglerCmd(args: string[], cwd?: string): Promise<unknown | null> {
  try {
    const { stdout } = await execFileAsync("wrangler", args, {
      timeout: 15_000,
      cwd,
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Run a wrangler CLI command, returning raw stdout or null on failure.
 */
async function wranglerCmdRaw(args: string[], cwd?: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("wrangler", args, {
      timeout: 15_000,
      cwd,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Parse route patterns from wrangler.toml content.
 * Handles: route = "...", routes = [...], [[routes]] pattern = "..."
 */
export function parseWranglerRoutes(content: string): string[] {
  const routes: string[] = [];

  // Single route: route = "pattern" or route = { pattern = "..." }
  const singleRoute = content.match(/^route\s*=\s*["']([^"']+)["']/m);
  if (singleRoute) {
    routes.push(singleRoute[1]);
  }

  // Route with pattern key: route = { pattern = "..." }
  const routePattern = content.match(/^route\s*=\s*\{[^}]*pattern\s*=\s*["']([^"']+)["']/m);
  if (routePattern && !routes.includes(routePattern[1])) {
    routes.push(routePattern[1]);
  }

  // routes array: routes = [ { pattern = "..." }, ... ]
  const routesBlock = content.match(/^routes\s*=\s*\[([\s\S]*?)\]/m);
  if (routesBlock) {
    const patterns = routesBlock[1].matchAll(/pattern\s*=\s*["']([^"']+)["']/g);
    for (const m of patterns) {
      if (!routes.includes(m[1])) routes.push(m[1]);
    }
    // Simple string routes: routes = ["pattern1", "pattern2"]
    const stringRoutes = routesBlock[1].matchAll(/["']([^"'\s,]+\.[^"'\s,]+\/[^"'\s,]*)["']/g);
    for (const m of stringRoutes) {
      if (!routes.includes(m[1])) routes.push(m[1]);
    }
  }

  // [[routes]] sections
  const routeSections = content.matchAll(/\[\[routes\]\]\s*\n\s*pattern\s*=\s*["']([^"']+)["']/g);
  for (const m of routeSections) {
    if (!routes.includes(m[1])) routes.push(m[1]);
  }

  return routes;
}

/**
 * Parse cron triggers from wrangler.toml content.
 * Handles: [triggers] crons = ["* * * * *"]
 */
export function parseWranglerCrons(content: string): string[] {
  const crons: string[] = [];

  // [triggers] section with crons array
  const triggersSection = content.match(/\[triggers\]\s*\n([\s\S]*?)(?=\n\[|\n$|$)/);
  if (triggersSection) {
    const cronsMatch = triggersSection[1].match(/crons\s*=\s*\[([\s\S]*?)\]/);
    if (cronsMatch) {
      const entries = cronsMatch[1].matchAll(/["']([^"']+)["']/g);
      for (const m of entries) {
        crons.push(m[1]);
      }
    }
  }

  return crons;
}

/**
 * Parse the worker name from wrangler.toml content.
 */
export function parseWranglerName(content: string): string | null {
  const match = content.match(/^name\s*=\s*["']([^"']+)["']/m);
  return match ? match[1] : null;
}

/**
 * Detect Cloudflare Workers usage from project files.
 */
export async function detectWorkers(
  projectPath: string,
  _stack: StackInfo,
): Promise<WorkersConfig | null> {
  // Check wrangler.toml
  const wranglerTomlPath = join(projectPath, "wrangler.toml");
  if (existsSync(wranglerTomlPath)) {
    try {
      const content = await readFile(wranglerTomlPath, "utf-8");
      const name = parseWranglerName(content) ?? "worker";
      const routes = parseWranglerRoutes(content);
      const crons = parseWranglerCrons(content);

      return {
        provider: "cloudflare-workers",
        kind: "serverless",
        name,
        workerName: name,
        routes,
        crons,
        configFile: "wrangler.toml",
      };
    } catch {
      // Fall through to other checks
    }
  }

  // Check wrangler.json / wrangler.jsonc
  for (const jsonFile of ["wrangler.json", "wrangler.jsonc"]) {
    const jsonPath = join(projectPath, jsonFile);
    if (!existsSync(jsonPath)) continue;
    try {
      const content = await readFile(jsonPath, "utf-8");
      // Strip comments for jsonc
      const cleaned = content
        .replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/gm, (_, str) => str ?? "")
        .replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\//g, (_, str) => str ?? "");
      const parsed = JSON.parse(cleaned);
      const name = parsed.name ?? "worker";
      const routes: string[] = [];
      const crons: string[] = [];

      if (parsed.route) routes.push(parsed.route);
      if (Array.isArray(parsed.routes)) {
        for (const r of parsed.routes) {
          if (typeof r === "string") routes.push(r);
          else if (r?.pattern) routes.push(r.pattern);
        }
      }
      if (parsed.triggers?.crons && Array.isArray(parsed.triggers.crons)) {
        crons.push(...parsed.triggers.crons);
      }

      return {
        provider: "cloudflare-workers",
        kind: "serverless",
        name,
        workerName: name,
        routes,
        crons,
        configFile: jsonFile,
      };
    } catch {
      continue;
    }
  }

  // Check package.json scripts for wrangler deploy/dev
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const content = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(content);
      const scripts = pkg.scripts ?? {};
      const hasWrangler = Object.values(scripts).some(
        (s) => typeof s === "string" && (s.includes("wrangler deploy") || s.includes("wrangler dev")),
      );
      if (hasWrangler) {
        return {
          provider: "cloudflare-workers",
          kind: "serverless",
          name: pkg.name ?? "worker",
          workerName: pkg.name ?? "worker",
          routes: [],
          crons: [],
          configFile: "package.json",
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Build function info from detected config and CLI data.
 */
function buildFunctions(config: WorkersConfig, lastDeployedAt?: string): FunctionInfo[] {
  const functions: FunctionInfo[] = [];

  // HTTP routes
  if (config.routes && config.routes.length > 0) {
    for (const route of config.routes) {
      functions.push({
        name: config.workerName ?? config.name,
        status: "deployed",
        trigger: "http",
        route,
        lastDeployedAt,
      });
    }
  }

  // Cron triggers
  if (config.crons && config.crons.length > 0) {
    for (const cron of config.crons) {
      functions.push({
        name: `${config.workerName ?? config.name}:cron`,
        status: "deployed",
        trigger: "schedule",
        route: cron,
        lastDeployedAt,
      });
    }
  }

  // If no routes or crons detected, still list the worker itself
  if (functions.length === 0) {
    functions.push({
      name: config.workerName ?? config.name,
      status: "deployed",
      trigger: "http",
      lastDeployedAt,
    });
  }

  return functions;
}

/**
 * Get Cloudflare Workers status via CLI.
 */
export async function getWorkersStatus(config: WorkersConfig): Promise<CloudService> {
  const now = new Date().toISOString();
  const serviceId = `cloudflare-workers:${config.name}`;

  let health: CloudServiceHealth = "unknown";
  let lastDeployedAt: string | undefined;

  // Try wrangler deployments list
  const deployments = (await wranglerCmd([
    "deployments", "list", "--json",
  ])) as { items?: WranglerDeployment[] } | WranglerDeployment[] | null;

  if (deployments) {
    health = "healthy";
    const items = Array.isArray(deployments)
      ? deployments
      : deployments?.items ?? [];
    if (items.length > 0 && items[0].created_on) {
      lastDeployedAt = items[0].created_on;
    }
  }

  // If CLI unavailable, check if wrangler is installed at all
  if (health === "unknown") {
    const whoami = await wranglerCmdRaw(["whoami"]);
    if (whoami) {
      health = "healthy";
    } else {
      health = "unreachable";
    }
  }

  const functions = buildFunctions(config, lastDeployedAt);

  const detail: ServerlessDetail = {
    kind: "serverless",
    functions,
    runtime: "workers",
  };

  return {
    id: serviceId,
    projectId: "",
    provider: "cloudflare-workers",
    kind: "serverless",
    name: config.name,
    status: health,
    detail,
    capabilities: ["logs", "deploy", "metrics"],
    lastCheckedAt: now,
    url: "https://dash.cloudflare.com",
  };
}

export class CloudflareWorkersAdapter implements CloudServiceAdapter {
  readonly provider: CloudProvider = "cloudflare-workers";
  readonly kind: CloudServiceKind = "serverless";

  async detect(projectPath: string, stack: StackInfo): Promise<WorkersConfig | null> {
    return detectWorkers(projectPath, stack);
  }

  async status(config: CloudServiceConfig): Promise<CloudService> {
    return getWorkersStatus(config as WorkersConfig);
  }

  async *logs(config: CloudServiceConfig, opts: LogOptions): AsyncIterable<LogLine> {
    const workersConfig = config as WorkersConfig;
    const args = ["tail", "--format=json"];
    if (workersConfig.workerName) {
      args.push(workersConfig.workerName);
    }

    const child = spawn("wrangler", args, { stdio: ["ignore", "pipe", "ignore"] });

    let lineCount = 0;
    const maxLines = opts.tailLines ?? (opts.follow ? Infinity : 100);

    try {
      let buffer = "";
      for await (const chunk of child.stdout) {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            const logLine: LogLine = {
              timestamp: parsed.timestamp ?? new Date().toISOString(),
              level: mapLogLevel(parsed.level),
              message: parsed.message ?? parsed.log ?? line,
              source: workersConfig.workerName,
            };
            yield logLine;
            lineCount++;
            if (lineCount >= maxLines) {
              child.kill();
              return;
            }
          } catch {
            // Non-JSON line, emit as info
            yield {
              timestamp: new Date().toISOString(),
              level: "info",
              message: line,
              source: workersConfig.workerName,
            };
            lineCount++;
            if (lineCount >= maxLines) {
              child.kill();
              return;
            }
          }
        }
      }
    } finally {
      if (!child.killed) child.kill();
    }
  }

  async deploy(config: CloudServiceConfig, _opts?: DeployOptions): Promise<DeployResult> {
    try {
      const { stdout } = await execFileAsync("wrangler", ["deploy"], {
        timeout: 120_000,
      });

      // Parse deployment output for URL
      const urlMatch = stdout.match(/https:\/\/[^\s]+/);

      return {
        success: true,
        url: urlMatch ? urlMatch[0] : undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "wrangler deploy failed",
      };
    }
  }

  async metrics(config: CloudServiceConfig, range: TimeRange): Promise<MetricsResult> {
    // Metrics require Cloudflare API access — return empty for CLI-only
    return { period: range };
  }
}

function mapLogLevel(level: string | undefined): LogLine["level"] {
  if (!level) return "info";
  const l = level.toLowerCase();
  if (l === "error" || l === "fatal") return "error";
  if (l === "warn" || l === "warning") return "warn";
  if (l === "debug" || l === "trace") return "debug";
  return "info";
}
