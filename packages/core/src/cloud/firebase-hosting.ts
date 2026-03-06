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
  HostingDetail,
  DomainInfo,
  DeployOptions,
  DeployResult,
  StackInfo,
} from "@opcom/types";
import { readFirebaseProject } from "./firebase-functions.js";

const execFileAsync = promisify(execFile);

export interface FirebaseHostingConfig extends CloudServiceConfig {
  provider: "firebase-hosting";
  kind: "hosting";
  firebaseProject?: string;
  site?: string;           // multi-site target name
  publicDir?: string;      // e.g. "dist", "build", "public"
  framework?: string;      // detected framework: "react", "vue", "vite", etc.
}

interface FirebaseHostingRelease {
  version?: {
    status?: string;
    config?: { headers?: unknown[] };
    labels?: Record<string, string>;
    createTime?: string;
  };
  type?: string;
  releaseTime?: string;
  releaseUser?: { email?: string };
  message?: string;
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
async function firebaseCmdRaw(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("firebase", args, {
      timeout: 15_000,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Parse firebase.json to extract hosting configuration.
 * Handles single-site and multi-site (array) configs.
 */
export function parseFirebaseHosting(content: string): {
  detected: boolean;
  site?: string;
  publicDir?: string;
  rewrites?: boolean;
} {
  try {
    const config = JSON.parse(content);

    if (config.hosting) {
      if (Array.isArray(config.hosting)) {
        // Multi-site: [{ target: "app", public: "dist" }, ...]
        const first = config.hosting[0];
        return {
          detected: true,
          site: first?.target,
          publicDir: first?.public,
          rewrites: Array.isArray(first?.rewrites) && first.rewrites.length > 0,
        };
      }
      // Single hosting config: { public: "dist", ... }
      return {
        detected: true,
        site: config.hosting.target,
        publicDir: config.hosting.public,
        rewrites: Array.isArray(config.hosting.rewrites) && config.hosting.rewrites.length > 0,
      };
    }

    return { detected: false };
  } catch {
    return { detected: false };
  }
}

/**
 * Detect the frontend framework from package.json dependencies and build output dir.
 */
export function detectHostingFramework(
  packageJson: string,
  publicDir?: string,
): string | undefined {
  try {
    const pkg = JSON.parse(packageJson);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps["next"]) return "next";
    if (allDeps["nuxt"] || allDeps["nuxt3"]) return "nuxt";
    if (allDeps["@sveltejs/kit"]) return "sveltekit";
    if (allDeps["vite"]) return "vite";
    if (allDeps["react-scripts"]) return "create-react-app";
    if (allDeps["react"]) return "react";
    if (allDeps["vue"]) return "vue";
    if (allDeps["@angular/core"]) return "angular";

    // Infer from public dir name
    if (publicDir === "build") return "react";
    if (publicDir === ".next") return "next";

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detect Firebase Hosting usage from project files.
 */
export async function detectFirebaseHosting(
  projectPath: string,
  _stack: StackInfo,
): Promise<FirebaseHostingConfig | null> {
  // Check firebase.json for hosting config
  const firebaseJsonPath = join(projectPath, "firebase.json");
  if (!existsSync(firebaseJsonPath)) return null;

  try {
    const content = await readFile(firebaseJsonPath, "utf-8");
    const parsed = parseFirebaseHosting(content);

    if (!parsed.detected) return null;

    const firebaseProject = await readFirebaseProject(projectPath);

    // Try to detect framework from package.json
    let framework: string | undefined;
    const pkgPath = join(projectPath, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkgContent = await readFile(pkgPath, "utf-8");
        framework = detectHostingFramework(pkgContent, parsed.publicDir);
      } catch {
        // ignore
      }
    }

    return {
      provider: "firebase-hosting",
      kind: "hosting",
      name: parsed.site ?? "hosting",
      firebaseProject: firebaseProject ?? undefined,
      site: parsed.site,
      publicDir: parsed.publicDir,
      framework,
    };
  } catch {
    return null;
  }
}

/**
 * Get Firebase Hosting status via CLI.
 */
export async function getFirebaseHostingStatus(
  config: FirebaseHostingConfig,
): Promise<CloudService> {
  const now = new Date().toISOString();
  const serviceId = `firebase-hosting:${config.name}`;

  let health: CloudServiceHealth = "unknown";
  const domains: DomainInfo[] = [];
  let lastDeployedAt: string | undefined;
  let deployedRef: string | undefined;

  // Try to get release history
  const projectArg = config.firebaseProject ? [`--project=${config.firebaseProject}`] : [];
  const releases = (await firebaseCmd([
    "hosting:channel:list", "--json", ...projectArg,
  ])) as { result?: Array<{ url?: string; expireTime?: string }> } | null;

  if (releases && releases.result) {
    health = "healthy";
    // Live channel is the production deployment
    for (const channel of releases.result) {
      if (channel.url) {
        const hostname = channel.url.replace(/^https?:\/\//, "");
        domains.push({
          hostname,
          ssl: channel.url.startsWith("https"),
          primary: true,
        });
      }
    }
  }

  // Try to extract last deployment info from hosting releases API
  if (health === "unknown" && config.firebaseProject) {
    const releaseList = (await firebaseCmd([
      "hosting:releases:list", "--json", ...projectArg,
    ])) as { result?: FirebaseHostingRelease[] } | FirebaseHostingRelease[] | null;

    if (releaseList) {
      const entries = Array.isArray(releaseList)
        ? releaseList
        : releaseList?.result ?? [];

      if (entries.length > 0) {
        health = "healthy";
        const latest = entries[0];
        lastDeployedAt = latest.releaseTime;
        deployedRef = latest.message ?? latest.version?.labels?.["deployment-tool"];
      }
    }
  }

  // If still unknown, check if firebase CLI is available at all
  if (health === "unknown") {
    const version = await firebaseCmdRaw(["--version"]);
    health = version ? "unknown" : "unreachable";
  }

  // If no domains discovered, add the default Firebase Hosting domain
  if (domains.length === 0 && config.firebaseProject) {
    domains.push({
      hostname: `${config.firebaseProject}.web.app`,
      ssl: true,
      primary: true,
    });
    if (health === "unknown") health = "healthy";
  }

  const detail: HostingDetail = {
    kind: "hosting",
    domains,
    lastDeployedAt,
    deployedRef,
    framework: config.framework,
  };

  return {
    id: serviceId,
    projectId: "",
    provider: "firebase-hosting",
    kind: "hosting",
    name: config.name,
    status: health,
    detail,
    capabilities: ["deploy"],
    lastCheckedAt: now,
    url: config.firebaseProject
      ? `https://console.firebase.google.com/project/${config.firebaseProject}/hosting`
      : "https://console.firebase.google.com",
  };
}

export class FirebaseHostingAdapter implements CloudServiceAdapter {
  readonly provider: CloudProvider = "firebase-hosting";
  readonly kind: CloudServiceKind = "hosting";

  async detect(projectPath: string, stack: StackInfo): Promise<FirebaseHostingConfig | null> {
    return detectFirebaseHosting(projectPath, stack);
  }

  async status(config: CloudServiceConfig): Promise<CloudService> {
    return getFirebaseHostingStatus(config as FirebaseHostingConfig);
  }

  async deploy(config: CloudServiceConfig, _opts?: DeployOptions): Promise<DeployResult> {
    const fbConfig = config as FirebaseHostingConfig;
    const args = ["deploy", "--only", "hosting"];

    if (fbConfig.site) {
      args[2] = `hosting:${fbConfig.site}`;
    }
    if (fbConfig.firebaseProject) {
      args.push(`--project=${fbConfig.firebaseProject}`);
    }

    try {
      await execFileAsync("firebase", args, {
        timeout: 300_000, // 5 min
      });

      const url = fbConfig.firebaseProject
        ? `https://${fbConfig.firebaseProject}.web.app`
        : undefined;

      return {
        success: true,
        url,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "firebase deploy failed",
      };
    }
  }
}
