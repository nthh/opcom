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

export interface FirebaseFunctionsConfig extends CloudServiceConfig {
  provider: "firebase-functions";
  kind: "serverless";
  firebaseProject?: string;
  functionsDir?: string;     // e.g. "functions" or "functions/src"
  runtime?: string;          // e.g. "nodejs20"
  codebase?: string;         // firebase.json functions codebase name
}

interface FirebaseFunctionEntry {
  name?: string;
  httpsTrigger?: { url?: string };
  scheduleTrigger?: { schedule?: string };
  eventTrigger?: { eventType?: string; resource?: string };
  status?: string;
  updateTime?: string;
  [key: string]: unknown;
}

/**
 * Run a firebase CLI command, returning parsed JSON or null on failure.
 */
async function firebaseCmd(args: string[], cwd?: string): Promise<unknown | null> {
  try {
    const { stdout } = await execFileAsync("firebase", args, {
      timeout: 30_000,
      cwd,
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Run a firebase CLI command, returning raw stdout or null on failure.
 */
async function firebaseCmdRaw(args: string[], cwd?: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("firebase", args, {
      timeout: 15_000,
      cwd,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Parse firebase.json to extract functions configuration.
 */
export function parseFirebaseFunctions(content: string): {
  detected: boolean;
  functionsDir?: string;
  codebase?: string;
  runtime?: string;
} {
  try {
    const config = JSON.parse(content);

    // Functions can be a single object or an array of objects
    if (config.functions) {
      if (Array.isArray(config.functions)) {
        // Multiple codebases: [{ source: "functions", codebase: "default" }, ...]
        const first = config.functions[0];
        return {
          detected: true,
          functionsDir: first?.source,
          codebase: first?.codebase,
          runtime: first?.runtime,
        };
      }
      // Single functions config: { source: "functions", ... }
      return {
        detected: true,
        functionsDir: config.functions.source,
        codebase: config.functions.codebase,
        runtime: config.functions.runtime,
      };
    }

    return { detected: false };
  } catch {
    return { detected: false };
  }
}

/**
 * Read .firebaserc to get the project ID.
 */
export async function readFirebaseProject(projectPath: string): Promise<string | null> {
  const rcPath = join(projectPath, ".firebaserc");
  if (!existsSync(rcPath)) return null;
  try {
    const content = await readFile(rcPath, "utf-8");
    const rc = JSON.parse(content);
    // Default project alias
    return rc.projects?.default ?? null;
  } catch {
    return null;
  }
}

/**
 * Scan functions source code for scheduled function annotations.
 * Detects patterns like:
 *   onSchedule("every 5 minutes", ...)
 *   functions.pubsub.schedule("every 1 hours")
 *   exports.myFunc = functions.pubsub.schedule("...")
 */
export function detectScheduledFunctions(source: string): Array<{ name: string; schedule: string }> {
  const scheduled: Array<{ name: string; schedule: string }> = [];

  // v2 Firebase Functions: onSchedule("...", async (event) => { ... })
  // Often: export const myFunc = onSchedule("every 5 minutes", ...
  const v2Matches = source.matchAll(
    /(?:export\s+(?:const|let|var)\s+)?(\w+)\s*=\s*onSchedule\s*\(\s*["']([^"']+)["']/g,
  );
  for (const m of v2Matches) {
    scheduled.push({ name: m[1], schedule: m[2] });
  }

  // v1 Firebase Functions: exports.myFunc = functions.pubsub.schedule("...")
  const v1Matches = source.matchAll(
    /exports\.(\w+)\s*=\s*functions\.pubsub\.schedule\s*\(\s*["']([^"']+)["']/g,
  );
  for (const m of v1Matches) {
    scheduled.push({ name: m[1], schedule: m[2] });
  }

  return scheduled;
}

/**
 * Detect Firebase Functions usage from project files.
 */
export async function detectFirebaseFunctions(
  projectPath: string,
  _stack: StackInfo,
): Promise<FirebaseFunctionsConfig | null> {
  // Check firebase.json for functions config
  const firebaseJsonPath = join(projectPath, "firebase.json");
  if (existsSync(firebaseJsonPath)) {
    try {
      const content = await readFile(firebaseJsonPath, "utf-8");
      const parsed = parseFirebaseFunctions(content);

      if (parsed.detected) {
        const firebaseProject = await readFirebaseProject(projectPath);
        return {
          provider: "firebase-functions",
          kind: "serverless",
          name: parsed.codebase ?? "functions",
          firebaseProject: firebaseProject ?? undefined,
          functionsDir: parsed.functionsDir,
          runtime: parsed.runtime,
          codebase: parsed.codebase,
        };
      }
    } catch {
      // Fall through
    }
  }

  // Check for functions/ directory with its own package.json
  const functionsDir = join(projectPath, "functions");
  if (existsSync(join(functionsDir, "package.json"))) {
    try {
      const content = await readFile(join(functionsDir, "package.json"), "utf-8");
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (allDeps["firebase-functions"] || allDeps["firebase-admin"]) {
        const firebaseProject = await readFirebaseProject(projectPath);
        return {
          provider: "firebase-functions",
          kind: "serverless",
          name: "functions",
          firebaseProject: firebaseProject ?? undefined,
          functionsDir: "functions",
        };
      }
    } catch {
      // ignore
    }
  }

  // Check root package.json for firebase-functions dependency
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const content = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (allDeps["firebase-functions"]) {
        const firebaseProject = await readFirebaseProject(projectPath);
        return {
          provider: "firebase-functions",
          kind: "serverless",
          name: "functions",
          firebaseProject: firebaseProject ?? undefined,
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Map Firebase/GCloud function status to FunctionInfo trigger type.
 */
function mapTriggerType(entry: FirebaseFunctionEntry): FunctionInfo["trigger"] {
  if (entry.scheduleTrigger) return "schedule";
  if (entry.httpsTrigger) return "http";
  if (entry.eventTrigger) {
    const eventType = entry.eventTrigger.eventType ?? "";
    if (eventType.includes("pubsub")) return "queue";
    return "event";
  }
  return "http";
}

/**
 * Map Firebase function status string.
 */
function mapFunctionStatus(status: string | undefined): FunctionInfo["status"] {
  if (!status) return "deployed";
  const s = status.toUpperCase();
  if (s === "ACTIVE" || s === "READY" || s === "DEPLOYED") return "deployed";
  if (s.includes("FAIL") || s.includes("ERROR")) return "failed";
  return "draft";
}

/**
 * Get Firebase Functions status via CLI.
 */
export async function getFirebaseFunctionsStatus(
  config: FirebaseFunctionsConfig,
): Promise<CloudService> {
  const now = new Date().toISOString();
  const serviceId = `firebase-functions:${config.name}`;

  let health: CloudServiceHealth = "unknown";
  const functions: FunctionInfo[] = [];

  // Try firebase functions:list
  const projectArg = config.firebaseProject ? [`--project=${config.firebaseProject}`] : [];
  const listResult = (await firebaseCmd([
    "functions:list", "--json", ...projectArg,
  ])) as { result?: FirebaseFunctionEntry[] } | FirebaseFunctionEntry[] | null;

  if (listResult) {
    health = "healthy";
    const entries = Array.isArray(listResult)
      ? listResult
      : listResult?.result ?? [];

    for (const entry of entries) {
      const name = entry.name?.split("/").pop() ?? "unknown";
      const trigger = mapTriggerType(entry);
      functions.push({
        name,
        status: mapFunctionStatus(entry.status),
        trigger,
        route: entry.httpsTrigger?.url ?? entry.scheduleTrigger?.schedule,
        lastDeployedAt: entry.updateTime,
      });
    }
  }

  // If CLI failed, check if firebase CLI is available at all
  if (health === "unknown") {
    const version = await firebaseCmdRaw(["--version"]);
    if (version) {
      // CLI works but no project access — still "unknown"
      health = "unreachable";
    } else {
      health = "unreachable";
    }
  }

  // If no functions discovered from CLI, create a placeholder entry
  if (functions.length === 0 && health !== "unreachable") {
    functions.push({
      name: config.name,
      status: "deployed",
      trigger: "http",
    });
  }

  const detail: ServerlessDetail = {
    kind: "serverless",
    functions,
    runtime: config.runtime ?? "nodejs",
  };

  return {
    id: serviceId,
    projectId: "",
    provider: "firebase-functions",
    kind: "serverless",
    name: config.name,
    status: health,
    detail,
    capabilities: ["logs", "deploy"],
    lastCheckedAt: now,
    url: config.firebaseProject
      ? `https://console.firebase.google.com/project/${config.firebaseProject}/functions`
      : "https://console.firebase.google.com",
  };
}

export class FirebaseFunctionsAdapter implements CloudServiceAdapter {
  readonly provider: CloudProvider = "firebase-functions";
  readonly kind: CloudServiceKind = "serverless";

  async detect(projectPath: string, stack: StackInfo): Promise<FirebaseFunctionsConfig | null> {
    return detectFirebaseFunctions(projectPath, stack);
  }

  async status(config: CloudServiceConfig): Promise<CloudService> {
    return getFirebaseFunctionsStatus(config as FirebaseFunctionsConfig);
  }

  async *logs(config: CloudServiceConfig, opts: LogOptions): AsyncIterable<LogLine> {
    const fbConfig = config as FirebaseFunctionsConfig;
    const args = ["functions:log"];

    if (opts.functionName) {
      args.push(`--only=${opts.functionName}`);
    }
    if (opts.tailLines) {
      args.push(`--lines=${opts.tailLines}`);
    }
    if (fbConfig.firebaseProject) {
      args.push(`--project=${fbConfig.firebaseProject}`);
    }

    const child = spawn("firebase", args, { stdio: ["ignore", "pipe", "ignore"] });

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
          const logLine = parseFirebaseLogLine(line, opts.functionName);
          yield logLine;
          lineCount++;
          if (lineCount >= maxLines) {
            child.kill();
            return;
          }
        }
      }
    } finally {
      if (!child.killed) child.kill();
    }
  }

  async deploy(config: CloudServiceConfig, _opts?: DeployOptions): Promise<DeployResult> {
    const fbConfig = config as FirebaseFunctionsConfig;
    const args = ["deploy", "--only", "functions"];

    if (fbConfig.firebaseProject) {
      args.push(`--project=${fbConfig.firebaseProject}`);
    }

    try {
      const { stdout } = await execFileAsync("firebase", args, {
        timeout: 300_000, // 5 min — function deployments can be slow
      });

      return {
        success: true,
        url: fbConfig.firebaseProject
          ? `https://console.firebase.google.com/project/${fbConfig.firebaseProject}/functions`
          : undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "firebase deploy failed",
      };
    }
  }

  async metrics(_config: CloudServiceConfig, range: TimeRange): Promise<MetricsResult> {
    // Firebase metrics require the Firebase console API — return empty for CLI-only
    return { period: range };
  }
}

/**
 * Parse a firebase functions:log line into a LogLine.
 * Format: "2026-02-28T14:23:01.123Z I myFunction: some message"
 * or:     "2026-02-28T14:23:01.123Z ERROR myFunction: error message"
 */
function parseFirebaseLogLine(line: string, defaultSource?: string): LogLine {
  // Try to parse structured format: timestamp level function: message
  const match = line.match(
    /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+(DEBUG|INFO|WARNING|ERROR|I|W|E|D)\s+(\w+):\s*(.*)/,
  );

  if (match) {
    return {
      timestamp: match[1],
      level: mapFirebaseLogLevel(match[2]),
      message: match[4],
      source: match[3],
    };
  }

  // Fallback: treat entire line as message
  return {
    timestamp: new Date().toISOString(),
    level: "info",
    message: line,
    source: defaultSource,
  };
}

function mapFirebaseLogLevel(level: string): LogLine["level"] {
  switch (level.toUpperCase()) {
    case "ERROR":
    case "E":
      return "error";
    case "WARNING":
    case "W":
      return "warn";
    case "DEBUG":
    case "D":
      return "debug";
    default:
      return "info";
  }
}
