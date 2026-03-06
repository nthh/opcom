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
  MobileDetail,
  DeployOptions,
  DeployResult,
  StackInfo,
} from "@opcom/types";

const execFileAsync = promisify(execFile);

export interface ExpoEASConfig extends CloudServiceConfig {
  provider: "expo-eas";
  kind: "mobile";
  platform?: "ios" | "android" | "both";
  updateChannel?: string;      // "production", "preview", etc.
  distribution?: "ota" | "store" | "ad-hoc";
  expoSlug?: string;           // from app.json expo.slug
  publishCommand?: string;     // custom publish command from package.json
}

interface EASUpdateEntry {
  id?: string;
  group?: string;
  message?: string;
  runtimeVersion?: string;
  platform?: string;
  createdAt?: string;
  [key: string]: unknown;
}

interface EASBuildEntry {
  id?: string;
  status?: string;
  platform?: string;
  appVersion?: string;
  runtimeVersion?: string;
  channel?: string;
  createdAt?: string;
  completedAt?: string;
  [key: string]: unknown;
}

/**
 * Run an eas CLI command, returning parsed JSON or null on failure.
 */
async function easCmd(args: string[], cwd?: string): Promise<unknown | null> {
  try {
    const { stdout } = await execFileAsync("eas", args, {
      timeout: 30_000,
      cwd,
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Run an eas CLI command, returning raw stdout or null on failure.
 */
async function easCmdRaw(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("eas", args, {
      timeout: 15_000,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Parse app.json to extract Expo configuration.
 */
export function parseAppJson(content: string): {
  detected: boolean;
  slug?: string;
  platform?: "ios" | "android" | "both";
  version?: string;
} {
  try {
    const config = JSON.parse(content);
    const expo = config.expo ?? config;

    if (!expo.slug && !expo.name) return { detected: false };

    // Determine platform support
    let platform: "ios" | "android" | "both" | undefined;
    if (expo.ios && expo.android) platform = "both";
    else if (expo.ios) platform = "ios";
    else if (expo.android) platform = "android";
    else platform = "both"; // default: both if expo detected

    return {
      detected: true,
      slug: expo.slug,
      platform,
      version: expo.version,
    };
  } catch {
    return { detected: false };
  }
}

/**
 * Parse eas.json to extract build/update profiles and channel info.
 */
export function parseEasJson(content: string): {
  detected: boolean;
  channel?: string;
  distribution?: "ota" | "store" | "ad-hoc";
  hasSubmit?: boolean;
} {
  try {
    const config = JSON.parse(content);

    if (!config.build && !config.submit) return { detected: false };

    // Look for production build profile to determine distribution
    const prodBuild = config.build?.production;
    let distribution: "ota" | "store" | "ad-hoc" | undefined;
    let channel: string | undefined;

    if (prodBuild) {
      channel = prodBuild.channel ?? "production";
      if (prodBuild.distribution === "internal") {
        distribution = "ad-hoc";
      } else if (prodBuild.distribution === "store") {
        distribution = "store";
      }
    }

    // If there's an update config or channel, assume OTA is possible
    if (!distribution) {
      distribution = "ota";
    }

    return {
      detected: true,
      channel,
      distribution,
      hasSubmit: !!config.submit,
    };
  } catch {
    return { detected: false };
  }
}

/**
 * Detect a custom publish/OTA command from package.json scripts.
 */
export function detectPublishCommand(packageJson: string): string | undefined {
  try {
    const pkg = JSON.parse(packageJson);
    const scripts = pkg.scripts ?? {};

    // Look for common OTA publish script names
    for (const key of ["publish", "ota", "ota:publish", "update", "eas:update"]) {
      if (scripts[key]) return `npm run ${key}`;
    }

    // Check script values for eas update commands
    for (const [key, value] of Object.entries(scripts)) {
      if (typeof value === "string" && value.includes("eas update")) {
        return `npm run ${key}`;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detect Expo/EAS usage from project files.
 */
export async function detectExpoEAS(
  projectPath: string,
  _stack: StackInfo,
): Promise<ExpoEASConfig | null> {
  let slug: string | undefined;
  let platform: "ios" | "android" | "both" | undefined;
  let version: string | undefined;
  let channel: string | undefined;
  let distribution: "ota" | "store" | "ad-hoc" | undefined;
  let publishCommand: string | undefined;
  let detected = false;

  // Check app.json for expo config
  const appJsonPath = join(projectPath, "app.json");
  if (existsSync(appJsonPath)) {
    try {
      const content = await readFile(appJsonPath, "utf-8");
      const parsed = parseAppJson(content);
      if (parsed.detected) {
        detected = true;
        slug = parsed.slug;
        platform = parsed.platform;
        version = parsed.version;
      }
    } catch {
      // Fall through
    }
  }

  // Check app.config.ts / app.config.js (just existence — can't parse TS easily)
  if (!detected) {
    for (const configFile of ["app.config.ts", "app.config.js"]) {
      if (existsSync(join(projectPath, configFile))) {
        // Check if package.json has expo dependency to confirm
        const pkgPath = join(projectPath, "package.json");
        if (existsSync(pkgPath)) {
          try {
            const pkgContent = await readFile(pkgPath, "utf-8");
            const pkg = JSON.parse(pkgContent);
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (allDeps["expo"]) {
              detected = true;
              slug = pkg.name;
              platform = "both";
              break;
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }

  // Check eas.json for build profiles
  const easJsonPath = join(projectPath, "eas.json");
  if (existsSync(easJsonPath)) {
    try {
      const content = await readFile(easJsonPath, "utf-8");
      const parsed = parseEasJson(content);
      if (parsed.detected) {
        detected = true;
        channel = parsed.channel ?? channel;
        distribution = parsed.distribution ?? distribution;
      }
    } catch {
      // ignore
    }
  }

  // Check package.json for expo dependency as last resort
  if (!detected) {
    const pkgPath = join(projectPath, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const content = await readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(content);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps["expo"]) {
          detected = true;
          slug = pkg.name;
          platform = "both";
        }
      } catch {
        // ignore
      }
    }
  }

  if (!detected) return null;

  // Try to detect a custom publish command
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const content = await readFile(pkgPath, "utf-8");
      publishCommand = detectPublishCommand(content);
    } catch {
      // ignore
    }
  }

  return {
    provider: "expo-eas",
    kind: "mobile",
    name: slug ?? "mobile",
    platform: platform ?? "both",
    updateChannel: channel,
    distribution: distribution ?? "ota",
    expoSlug: slug,
    publishCommand,
  };
}

/**
 * Get Expo/EAS status via CLI.
 */
export async function getExpoEASStatus(config: ExpoEASConfig): Promise<CloudService> {
  const now = new Date().toISOString();
  const serviceId = `expo-eas:${config.name}`;

  let health: CloudServiceHealth = "unknown";
  let currentVersion: string | undefined;
  let lastPublishedAt: string | undefined;
  let updateChannel: string | undefined = config.updateChannel;
  let platform = config.platform ?? "both";

  // Try eas update:list for OTA updates
  const updates = (await easCmd([
    "update:list", "--json", "--non-interactive",
  ])) as { currentPage?: EASUpdateEntry[] } | EASUpdateEntry[] | null;

  if (updates) {
    health = "healthy";
    const entries = Array.isArray(updates)
      ? updates
      : updates?.currentPage ?? [];

    if (entries.length > 0) {
      const latest = entries[0];
      lastPublishedAt = latest.createdAt;
      currentVersion = latest.runtimeVersion;
      if (latest.platform === "ios") platform = "ios";
      else if (latest.platform === "android") platform = "android";
    }
  }

  // Try eas build:list for build info
  if (health === "unknown") {
    const builds = (await easCmd([
      "build:list", "--json", "--non-interactive", "--limit=1",
    ])) as EASBuildEntry[] | null;

    if (builds && builds.length > 0) {
      health = "healthy";
      const latest = builds[0];
      currentVersion = latest.appVersion ?? latest.runtimeVersion;
      lastPublishedAt = latest.completedAt ?? latest.createdAt;
      updateChannel = latest.channel ?? updateChannel;
    }
  }

  // If CLI unavailable, check if eas is installed
  if (health === "unknown") {
    const version = await easCmdRaw(["--version"]);
    health = version ? "unreachable" : "unreachable";
  }

  const detail: MobileDetail = {
    kind: "mobile",
    platform,
    currentVersion,
    lastPublishedAt,
    updateChannel,
    distribution: config.distribution ?? "ota",
  };

  return {
    id: serviceId,
    projectId: "",
    provider: "expo-eas",
    kind: "mobile",
    name: config.name,
    status: health,
    detail,
    capabilities: ["deploy"],
    lastCheckedAt: now,
    url: config.expoSlug
      ? `https://expo.dev/projects/${config.expoSlug}`
      : "https://expo.dev",
  };
}

export class ExpoEASAdapter implements CloudServiceAdapter {
  readonly provider: CloudProvider = "expo-eas";
  readonly kind: CloudServiceKind = "mobile";

  async detect(projectPath: string, stack: StackInfo): Promise<ExpoEASConfig | null> {
    return detectExpoEAS(projectPath, stack);
  }

  async status(config: CloudServiceConfig): Promise<CloudService> {
    return getExpoEASStatus(config as ExpoEASConfig);
  }

  async deploy(config: CloudServiceConfig, _opts?: DeployOptions): Promise<DeployResult> {
    const easConfig = config as ExpoEASConfig;

    // Use custom publish command if available, otherwise eas update --auto
    if (easConfig.publishCommand) {
      const [cmd, ...args] = easConfig.publishCommand.split(" ");
      try {
        await execFileAsync(cmd, args, {
          timeout: 300_000, // 5 min
        });
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "publish command failed",
        };
      }
    }

    try {
      const { stdout } = await execFileAsync("eas", ["update", "--auto", "--non-interactive"], {
        timeout: 300_000,
      });

      // Try to parse update URL from output
      const urlMatch = stdout.match(/https:\/\/[^\s]+/);

      return {
        success: true,
        url: urlMatch ? urlMatch[0] : undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "eas update failed",
      };
    }
  }
}
