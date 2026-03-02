import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseWranglerRoutes,
  parseWranglerCrons,
  parseWranglerName,
  detectWorkers,
  parseFirebaseFunctions,
  readFirebaseProject,
  detectScheduledFunctions,
  detectFirebaseFunctions,
  detectCloudServices,
} from "@opcom/core";
import type { StackInfo } from "@opcom/types";

const emptyStack: StackInfo = {
  languages: [],
  frameworks: [],
  packageManagers: [],
  infrastructure: [],
  versionManagers: [],
};

// =============================================================================
// Wrangler route parsing
// =============================================================================

describe("parseWranglerRoutes", () => {
  it("parses single route = string", () => {
    const toml = `name = "api"\nroute = "api.example.com/*"`;
    expect(parseWranglerRoutes(toml)).toEqual(["api.example.com/*"]);
  });

  it("parses route with pattern key", () => {
    const toml = `name = "api"\nroute = { pattern = "api.example.com/*", zone_name = "example.com" }`;
    expect(parseWranglerRoutes(toml)).toEqual(["api.example.com/*"]);
  });

  it("parses [[routes]] sections", () => {
    const toml = `name = "api"

[[routes]]
pattern = "api.example.com/v1/*"
zone_name = "example.com"

[[routes]]
pattern = "api.example.com/v2/*"
zone_name = "example.com"
`;
    const routes = parseWranglerRoutes(toml);
    expect(routes).toContain("api.example.com/v1/*");
    expect(routes).toContain("api.example.com/v2/*");
    expect(routes).toHaveLength(2);
  });

  it("returns empty for toml with no routes", () => {
    const toml = `name = "worker"\ncompatibility_date = "2024-01-01"`;
    expect(parseWranglerRoutes(toml)).toEqual([]);
  });

  it("deduplicates routes", () => {
    const toml = `route = "api.example.com/*"\n\n[[routes]]\npattern = "api.example.com/*"`;
    expect(parseWranglerRoutes(toml)).toEqual(["api.example.com/*"]);
  });
});

// =============================================================================
// Wrangler cron parsing
// =============================================================================

describe("parseWranglerCrons", () => {
  it("parses crons from [triggers] section", () => {
    const toml = `name = "cron-worker"

[triggers]
crons = ["*/5 * * * *", "0 * * * *"]
`;
    const crons = parseWranglerCrons(toml);
    expect(crons).toEqual(["*/5 * * * *", "0 * * * *"]);
  });

  it("returns empty when no triggers", () => {
    const toml = `name = "worker"\nroute = "api.example.com/*"`;
    expect(parseWranglerCrons(toml)).toEqual([]);
  });

  it("parses single cron", () => {
    const toml = `[triggers]\ncrons = ["0 0 * * *"]`;
    const crons = parseWranglerCrons(toml);
    expect(crons).toEqual(["0 0 * * *"]);
  });
});

// =============================================================================
// Wrangler name parsing
// =============================================================================

describe("parseWranglerName", () => {
  it("parses name from wrangler.toml", () => {
    expect(parseWranglerName(`name = "my-worker"`)).toBe("my-worker");
  });

  it("parses name with single quotes", () => {
    expect(parseWranglerName(`name = 'my-worker'`)).toBe("my-worker");
  });

  it("returns null when no name", () => {
    expect(parseWranglerName(`route = "example.com/*"`)).toBeNull();
  });
});

// =============================================================================
// Cloudflare Workers detection
// =============================================================================

describe("detectWorkers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-workers-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects from wrangler.toml with routes", async () => {
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `name = "mtnmap-api"
compatibility_date = "2024-01-01"

[[routes]]
pattern = "api.mtnmap.app/*"
zone_name = "mtnmap.app"
`,
    );

    const result = await detectWorkers(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("cloudflare-workers");
    expect(result!.kind).toBe("serverless");
    expect(result!.name).toBe("mtnmap-api");
    expect(result!.workerName).toBe("mtnmap-api");
    expect(result!.routes).toContain("api.mtnmap.app/*");
    expect(result!.configFile).toBe("wrangler.toml");
  });

  it("detects from wrangler.toml with cron triggers", async () => {
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `name = "cron-worker"

[triggers]
crons = ["0 * * * *", "*/15 * * * *"]
`,
    );

    const result = await detectWorkers(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("cron-worker");
    expect(result!.crons).toEqual(["0 * * * *", "*/15 * * * *"]);
  });

  it("detects from wrangler.json", async () => {
    await writeFile(
      join(tempDir, "wrangler.json"),
      JSON.stringify({
        name: "json-worker",
        route: "api.example.com/*",
        triggers: { crons: ["0 0 * * *"] },
      }),
    );

    const result = await detectWorkers(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("json-worker");
    expect(result!.routes).toContain("api.example.com/*");
    expect(result!.crons).toContain("0 0 * * *");
    expect(result!.configFile).toBe("wrangler.json");
  });

  it("detects from wrangler.jsonc with comments", async () => {
    await writeFile(
      join(tempDir, "wrangler.jsonc"),
      `{
  // Worker configuration
  "name": "jsonc-worker",
  "route": "api.example.com/*"
  /* more config here */
}`,
    );

    const result = await detectWorkers(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("jsonc-worker");
  });

  it("detects from package.json scripts with wrangler deploy", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-worker",
        scripts: {
          deploy: "wrangler deploy",
          dev: "wrangler dev",
        },
      }),
    );

    const result = await detectWorkers(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("cloudflare-workers");
    expect(result!.configFile).toBe("package.json");
  });

  it("returns null when no wrangler markers found", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test", dependencies: { express: "^4.0" } }),
    );

    const result = await detectWorkers(tempDir, emptyStack);
    expect(result).toBeNull();
  });

  it("prefers wrangler.toml over package.json", async () => {
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `name = "toml-worker"\nroute = "api.example.com/*"`,
    );
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "pkg-worker",
        scripts: { deploy: "wrangler deploy" },
      }),
    );

    const result = await detectWorkers(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("toml-worker");
    expect(result!.configFile).toBe("wrangler.toml");
  });
});

// =============================================================================
// Firebase Functions parsing
// =============================================================================

describe("parseFirebaseFunctions", () => {
  it("parses single functions config", () => {
    const json = JSON.stringify({
      functions: { source: "functions", runtime: "nodejs20" },
    });
    const result = parseFirebaseFunctions(json);
    expect(result.detected).toBe(true);
    expect(result.functionsDir).toBe("functions");
    expect(result.runtime).toBe("nodejs20");
  });

  it("parses array functions config (multi-codebase)", () => {
    const json = JSON.stringify({
      functions: [
        { source: "functions", codebase: "default", runtime: "nodejs20" },
        { source: "functions-v2", codebase: "v2" },
      ],
    });
    const result = parseFirebaseFunctions(json);
    expect(result.detected).toBe(true);
    expect(result.functionsDir).toBe("functions");
    expect(result.codebase).toBe("default");
  });

  it("returns detected=false when no functions config", () => {
    const json = JSON.stringify({ hosting: { public: "dist" } });
    const result = parseFirebaseFunctions(json);
    expect(result.detected).toBe(false);
  });

  it("returns detected=false for invalid JSON", () => {
    const result = parseFirebaseFunctions("not json");
    expect(result.detected).toBe(false);
  });
});

// =============================================================================
// .firebaserc reading
// =============================================================================

describe("readFirebaseProject", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-fbrc-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads default project from .firebaserc", async () => {
    await writeFile(
      join(tempDir, ".firebaserc"),
      JSON.stringify({
        projects: { default: "my-firebase-project" },
      }),
    );

    const result = await readFirebaseProject(tempDir);
    expect(result).toBe("my-firebase-project");
  });

  it("returns null when .firebaserc does not exist", async () => {
    const result = await readFirebaseProject(tempDir);
    expect(result).toBeNull();
  });

  it("returns null when .firebaserc has no default project", async () => {
    await writeFile(
      join(tempDir, ".firebaserc"),
      JSON.stringify({ projects: {} }),
    );

    const result = await readFirebaseProject(tempDir);
    expect(result).toBeNull();
  });
});

// =============================================================================
// Scheduled function detection from source
// =============================================================================

describe("detectScheduledFunctions", () => {
  it("detects v2 onSchedule functions", () => {
    const source = `
import { onSchedule } from "firebase-functions/v2/scheduler";

export const dailyCleanup = onSchedule("every day 00:00", async (event) => {
  // cleanup logic
});

export const hourlySync = onSchedule("every 1 hours", async (event) => {
  // sync logic
});
`;
    const result = detectScheduledFunctions(source);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "dailyCleanup", schedule: "every day 00:00" });
    expect(result[1]).toEqual({ name: "hourlySync", schedule: "every 1 hours" });
  });

  it("detects v1 pubsub.schedule functions", () => {
    const source = `
const functions = require("firebase-functions");

exports.scheduledBackup = functions.pubsub.schedule("every 6 hours").onRun(async () => {
  // backup logic
});
`;
    const result = detectScheduledFunctions(source);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: "scheduledBackup", schedule: "every 6 hours" });
  });

  it("returns empty for non-scheduled functions", () => {
    const source = `
import { onRequest } from "firebase-functions/v2/https";

export const api = onRequest(async (req, res) => {
  res.send("Hello");
});
`;
    const result = detectScheduledFunctions(source);
    expect(result).toHaveLength(0);
  });
});

// =============================================================================
// Firebase Functions detection
// =============================================================================

describe("detectFirebaseFunctions", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-fbfn-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects from firebase.json with functions config", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({
        functions: { source: "functions", runtime: "nodejs20" },
      }),
    );
    await writeFile(
      join(tempDir, ".firebaserc"),
      JSON.stringify({ projects: { default: "my-project" } }),
    );

    const result = await detectFirebaseFunctions(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("firebase-functions");
    expect(result!.kind).toBe("serverless");
    expect(result!.firebaseProject).toBe("my-project");
    expect(result!.functionsDir).toBe("functions");
    expect(result!.runtime).toBe("nodejs20");
  });

  it("detects from functions/ directory with firebase-functions dep", async () => {
    await mkdir(join(tempDir, "functions"), { recursive: true });
    await writeFile(
      join(tempDir, "functions", "package.json"),
      JSON.stringify({
        name: "functions",
        dependencies: { "firebase-functions": "^4.0.0", "firebase-admin": "^12.0.0" },
      }),
    );

    const result = await detectFirebaseFunctions(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("firebase-functions");
    expect(result!.functionsDir).toBe("functions");
  });

  it("detects from root package.json with firebase-functions dep", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "my-app",
        dependencies: { "firebase-functions": "^4.0.0" },
      }),
    );

    const result = await detectFirebaseFunctions(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("firebase-functions");
  });

  it("returns null when no Firebase Functions markers found", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test", dependencies: { express: "^4.0" } }),
    );

    const result = await detectFirebaseFunctions(tempDir, emptyStack);
    expect(result).toBeNull();
  });

  it("returns null when firebase.json has no functions config", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({ hosting: { public: "dist" } }),
    );

    const result = await detectFirebaseFunctions(tempDir, emptyStack);
    expect(result).toBeNull();
  });

  it("prefers firebase.json over functions/ directory", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({
        functions: { source: "src/functions", codebase: "main" },
      }),
    );
    await mkdir(join(tempDir, "functions"), { recursive: true });
    await writeFile(
      join(tempDir, "functions", "package.json"),
      JSON.stringify({
        dependencies: { "firebase-functions": "^4.0.0" },
      }),
    );

    const result = await detectFirebaseFunctions(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.functionsDir).toBe("src/functions");
    expect(result!.codebase).toBe("main");
  });
});

// =============================================================================
// Cloud detection integration — serverless adapters in Tier 4
// =============================================================================

describe("detectCloudServices (serverless)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-cloud-serverless-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects CF Workers from wrangler.toml", async () => {
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `name = "api-worker"\nroute = "api.example.com/*"`,
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    const workers = result.configs.find((c) => c.provider === "cloudflare-workers");
    expect(workers).toBeDefined();
    expect(workers!.kind).toBe("serverless");
    expect(workers!.name).toBe("api-worker");

    const evidence = result.evidence.find((e) => e.detectedAs === "cloud:cloudflare-workers");
    expect(evidence).toBeDefined();
  });

  it("detects Firebase Functions from firebase.json", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({ functions: { source: "functions" } }),
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    const fb = result.configs.find((c) => c.provider === "firebase-functions");
    expect(fb).toBeDefined();
    expect(fb!.kind).toBe("serverless");

    const evidence = result.evidence.find((e) => e.detectedAs === "cloud:firebase-functions");
    expect(evidence).toBeDefined();
  });

  it("detects both CF Workers and Firebase Functions in one project", async () => {
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `name = "api"\nroute = "api.mtnmap.app/*"`,
    );
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({ functions: { source: "functions" } }),
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    const workers = result.configs.find((c) => c.provider === "cloudflare-workers");
    const fb = result.configs.find((c) => c.provider === "firebase-functions");
    expect(workers).toBeDefined();
    expect(fb).toBeDefined();
  });

  it("detects serverless alongside database services", async () => {
    // Mtnmap-like setup: Neon + CF Workers + Firebase Functions
    await writeFile(
      join(tempDir, ".env"),
      "DATABASE_URL=postgres://user:pw@ep-cool.neon.tech/mydb\n",
    );
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `name = "api"\nroute = "api.example.com/*"`,
    );
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({ functions: { source: "functions" } }),
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    expect(result.configs.length).toBeGreaterThanOrEqual(3);

    const neon = result.configs.find((c) => c.provider === "neon");
    const workers = result.configs.find((c) => c.provider === "cloudflare-workers");
    const fb = result.configs.find((c) => c.provider === "firebase-functions");

    expect(neon).toBeDefined();
    expect(workers).toBeDefined();
    expect(fb).toBeDefined();
  });

  it("returns no serverless when no markers found", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "simple-app", dependencies: {} }),
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    const serverless = result.configs.filter((c) => c.kind === "serverless");
    expect(serverless).toHaveLength(0);
  });
});
