"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const core_1 = require("@opcom/core");
const emptyStack = {
    languages: [],
    frameworks: [],
    packageManagers: [],
    infrastructure: [],
    versionManagers: [],
};
// =============================================================================
// Wrangler route parsing
// =============================================================================
(0, vitest_1.describe)("parseWranglerRoutes", () => {
    (0, vitest_1.it)("parses single route = string", () => {
        const toml = `name = "api"\nroute = "api.example.com/*"`;
        (0, vitest_1.expect)((0, core_1.parseWranglerRoutes)(toml)).toEqual(["api.example.com/*"]);
    });
    (0, vitest_1.it)("parses route with pattern key", () => {
        const toml = `name = "api"\nroute = { pattern = "api.example.com/*", zone_name = "example.com" }`;
        (0, vitest_1.expect)((0, core_1.parseWranglerRoutes)(toml)).toEqual(["api.example.com/*"]);
    });
    (0, vitest_1.it)("parses [[routes]] sections", () => {
        const toml = `name = "api"

[[routes]]
pattern = "api.example.com/v1/*"
zone_name = "example.com"

[[routes]]
pattern = "api.example.com/v2/*"
zone_name = "example.com"
`;
        const routes = (0, core_1.parseWranglerRoutes)(toml);
        (0, vitest_1.expect)(routes).toContain("api.example.com/v1/*");
        (0, vitest_1.expect)(routes).toContain("api.example.com/v2/*");
        (0, vitest_1.expect)(routes).toHaveLength(2);
    });
    (0, vitest_1.it)("returns empty for toml with no routes", () => {
        const toml = `name = "worker"\ncompatibility_date = "2024-01-01"`;
        (0, vitest_1.expect)((0, core_1.parseWranglerRoutes)(toml)).toEqual([]);
    });
    (0, vitest_1.it)("deduplicates routes", () => {
        const toml = `route = "api.example.com/*"\n\n[[routes]]\npattern = "api.example.com/*"`;
        (0, vitest_1.expect)((0, core_1.parseWranglerRoutes)(toml)).toEqual(["api.example.com/*"]);
    });
});
// =============================================================================
// Wrangler cron parsing
// =============================================================================
(0, vitest_1.describe)("parseWranglerCrons", () => {
    (0, vitest_1.it)("parses crons from [triggers] section", () => {
        const toml = `name = "cron-worker"

[triggers]
crons = ["*/5 * * * *", "0 * * * *"]
`;
        const crons = (0, core_1.parseWranglerCrons)(toml);
        (0, vitest_1.expect)(crons).toEqual(["*/5 * * * *", "0 * * * *"]);
    });
    (0, vitest_1.it)("returns empty when no triggers", () => {
        const toml = `name = "worker"\nroute = "api.example.com/*"`;
        (0, vitest_1.expect)((0, core_1.parseWranglerCrons)(toml)).toEqual([]);
    });
    (0, vitest_1.it)("parses single cron", () => {
        const toml = `[triggers]\ncrons = ["0 0 * * *"]`;
        const crons = (0, core_1.parseWranglerCrons)(toml);
        (0, vitest_1.expect)(crons).toEqual(["0 0 * * *"]);
    });
});
// =============================================================================
// Wrangler name parsing
// =============================================================================
(0, vitest_1.describe)("parseWranglerName", () => {
    (0, vitest_1.it)("parses name from wrangler.toml", () => {
        (0, vitest_1.expect)((0, core_1.parseWranglerName)(`name = "my-worker"`)).toBe("my-worker");
    });
    (0, vitest_1.it)("parses name with single quotes", () => {
        (0, vitest_1.expect)((0, core_1.parseWranglerName)(`name = 'my-worker'`)).toBe("my-worker");
    });
    (0, vitest_1.it)("returns null when no name", () => {
        (0, vitest_1.expect)((0, core_1.parseWranglerName)(`route = "example.com/*"`)).toBeNull();
    });
});
// =============================================================================
// Cloudflare Workers detection
// =============================================================================
(0, vitest_1.describe)("detectWorkers", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-workers-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects from wrangler.toml with routes", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `name = "mtnmap-api"
compatibility_date = "2024-01-01"

[[routes]]
pattern = "api.mtnmap.app/*"
zone_name = "mtnmap.app"
`);
        const result = await (0, core_1.detectWorkers)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("cloudflare-workers");
        (0, vitest_1.expect)(result.kind).toBe("serverless");
        (0, vitest_1.expect)(result.name).toBe("mtnmap-api");
        (0, vitest_1.expect)(result.workerName).toBe("mtnmap-api");
        (0, vitest_1.expect)(result.routes).toContain("api.mtnmap.app/*");
        (0, vitest_1.expect)(result.configFile).toBe("wrangler.toml");
    });
    (0, vitest_1.it)("detects from wrangler.toml with cron triggers", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `name = "cron-worker"

[triggers]
crons = ["0 * * * *", "*/15 * * * *"]
`);
        const result = await (0, core_1.detectWorkers)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("cron-worker");
        (0, vitest_1.expect)(result.crons).toEqual(["0 * * * *", "*/15 * * * *"]);
    });
    (0, vitest_1.it)("detects from wrangler.json", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.json"), JSON.stringify({
            name: "json-worker",
            route: "api.example.com/*",
            triggers: { crons: ["0 0 * * *"] },
        }));
        const result = await (0, core_1.detectWorkers)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("json-worker");
        (0, vitest_1.expect)(result.routes).toContain("api.example.com/*");
        (0, vitest_1.expect)(result.crons).toContain("0 0 * * *");
        (0, vitest_1.expect)(result.configFile).toBe("wrangler.json");
    });
    (0, vitest_1.it)("detects from wrangler.jsonc with comments", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.jsonc"), `{
  // Worker configuration
  "name": "jsonc-worker",
  "route": "api.example.com/*"
  /* more config here */
}`);
        const result = await (0, core_1.detectWorkers)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("jsonc-worker");
    });
    (0, vitest_1.it)("detects from package.json scripts with wrangler deploy", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({
            name: "my-worker",
            scripts: {
                deploy: "wrangler deploy",
                dev: "wrangler dev",
            },
        }));
        const result = await (0, core_1.detectWorkers)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("cloudflare-workers");
        (0, vitest_1.expect)(result.configFile).toBe("package.json");
    });
    (0, vitest_1.it)("returns null when no wrangler markers found", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({ name: "test", dependencies: { express: "^4.0" } }));
        const result = await (0, core_1.detectWorkers)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("prefers wrangler.toml over package.json", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `name = "toml-worker"\nroute = "api.example.com/*"`);
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({
            name: "pkg-worker",
            scripts: { deploy: "wrangler deploy" },
        }));
        const result = await (0, core_1.detectWorkers)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("toml-worker");
        (0, vitest_1.expect)(result.configFile).toBe("wrangler.toml");
    });
});
// =============================================================================
// Firebase Functions parsing
// =============================================================================
(0, vitest_1.describe)("parseFirebaseFunctions", () => {
    (0, vitest_1.it)("parses single functions config", () => {
        const json = JSON.stringify({
            functions: { source: "functions", runtime: "nodejs20" },
        });
        const result = (0, core_1.parseFirebaseFunctions)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.functionsDir).toBe("functions");
        (0, vitest_1.expect)(result.runtime).toBe("nodejs20");
    });
    (0, vitest_1.it)("parses array functions config (multi-codebase)", () => {
        const json = JSON.stringify({
            functions: [
                { source: "functions", codebase: "default", runtime: "nodejs20" },
                { source: "functions-v2", codebase: "v2" },
            ],
        });
        const result = (0, core_1.parseFirebaseFunctions)(json);
        (0, vitest_1.expect)(result.detected).toBe(true);
        (0, vitest_1.expect)(result.functionsDir).toBe("functions");
        (0, vitest_1.expect)(result.codebase).toBe("default");
    });
    (0, vitest_1.it)("returns detected=false when no functions config", () => {
        const json = JSON.stringify({ hosting: { public: "dist" } });
        const result = (0, core_1.parseFirebaseFunctions)(json);
        (0, vitest_1.expect)(result.detected).toBe(false);
    });
    (0, vitest_1.it)("returns detected=false for invalid JSON", () => {
        const result = (0, core_1.parseFirebaseFunctions)("not json");
        (0, vitest_1.expect)(result.detected).toBe(false);
    });
});
// =============================================================================
// .firebaserc reading
// =============================================================================
(0, vitest_1.describe)("readFirebaseProject", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-fbrc-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("reads default project from .firebaserc", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".firebaserc"), JSON.stringify({
            projects: { default: "my-firebase-project" },
        }));
        const result = await (0, core_1.readFirebaseProject)(tempDir);
        (0, vitest_1.expect)(result).toBe("my-firebase-project");
    });
    (0, vitest_1.it)("returns null when .firebaserc does not exist", async () => {
        const result = await (0, core_1.readFirebaseProject)(tempDir);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("returns null when .firebaserc has no default project", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".firebaserc"), JSON.stringify({ projects: {} }));
        const result = await (0, core_1.readFirebaseProject)(tempDir);
        (0, vitest_1.expect)(result).toBeNull();
    });
});
// =============================================================================
// Scheduled function detection from source
// =============================================================================
(0, vitest_1.describe)("detectScheduledFunctions", () => {
    (0, vitest_1.it)("detects v2 onSchedule functions", () => {
        const source = `
import { onSchedule } from "firebase-functions/v2/scheduler";

export const dailyCleanup = onSchedule("every day 00:00", async (event) => {
  // cleanup logic
});

export const hourlySync = onSchedule("every 1 hours", async (event) => {
  // sync logic
});
`;
        const result = (0, core_1.detectScheduledFunctions)(source);
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result[0]).toEqual({ name: "dailyCleanup", schedule: "every day 00:00" });
        (0, vitest_1.expect)(result[1]).toEqual({ name: "hourlySync", schedule: "every 1 hours" });
    });
    (0, vitest_1.it)("detects v1 pubsub.schedule functions", () => {
        const source = `
const functions = require("firebase-functions");

exports.scheduledBackup = functions.pubsub.schedule("every 6 hours").onRun(async () => {
  // backup logic
});
`;
        const result = (0, core_1.detectScheduledFunctions)(source);
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0]).toEqual({ name: "scheduledBackup", schedule: "every 6 hours" });
    });
    (0, vitest_1.it)("returns empty for non-scheduled functions", () => {
        const source = `
import { onRequest } from "firebase-functions/v2/https";

export const api = onRequest(async (req, res) => {
  res.send("Hello");
});
`;
        const result = (0, core_1.detectScheduledFunctions)(source);
        (0, vitest_1.expect)(result).toHaveLength(0);
    });
});
// =============================================================================
// Firebase Functions detection
// =============================================================================
(0, vitest_1.describe)("detectFirebaseFunctions", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-fbfn-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects from firebase.json with functions config", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({
            functions: { source: "functions", runtime: "nodejs20" },
        }));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".firebaserc"), JSON.stringify({ projects: { default: "my-project" } }));
        const result = await (0, core_1.detectFirebaseFunctions)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("firebase-functions");
        (0, vitest_1.expect)(result.kind).toBe("serverless");
        (0, vitest_1.expect)(result.firebaseProject).toBe("my-project");
        (0, vitest_1.expect)(result.functionsDir).toBe("functions");
        (0, vitest_1.expect)(result.runtime).toBe("nodejs20");
    });
    (0, vitest_1.it)("detects from functions/ directory with firebase-functions dep", async () => {
        await (0, promises_1.mkdir)((0, node_path_1.join)(tempDir, "functions"), { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "functions", "package.json"), JSON.stringify({
            name: "functions",
            dependencies: { "firebase-functions": "^4.0.0", "firebase-admin": "^12.0.0" },
        }));
        const result = await (0, core_1.detectFirebaseFunctions)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("firebase-functions");
        (0, vitest_1.expect)(result.functionsDir).toBe("functions");
    });
    (0, vitest_1.it)("detects from root package.json with firebase-functions dep", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({
            name: "my-app",
            dependencies: { "firebase-functions": "^4.0.0" },
        }));
        const result = await (0, core_1.detectFirebaseFunctions)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("firebase-functions");
    });
    (0, vitest_1.it)("returns null when no Firebase Functions markers found", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({ name: "test", dependencies: { express: "^4.0" } }));
        const result = await (0, core_1.detectFirebaseFunctions)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("returns null when firebase.json has no functions config", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({ hosting: { public: "dist" } }));
        const result = await (0, core_1.detectFirebaseFunctions)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("prefers firebase.json over functions/ directory", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({
            functions: { source: "src/functions", codebase: "main" },
        }));
        await (0, promises_1.mkdir)((0, node_path_1.join)(tempDir, "functions"), { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "functions", "package.json"), JSON.stringify({
            dependencies: { "firebase-functions": "^4.0.0" },
        }));
        const result = await (0, core_1.detectFirebaseFunctions)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.functionsDir).toBe("src/functions");
        (0, vitest_1.expect)(result.codebase).toBe("main");
    });
});
// =============================================================================
// Cloud detection integration — serverless adapters in Tier 4
// =============================================================================
(0, vitest_1.describe)("detectCloudServices (serverless)", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-cloud-serverless-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects CF Workers from wrangler.toml", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `name = "api-worker"\nroute = "api.example.com/*"`);
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        const workers = result.configs.find((c) => c.provider === "cloudflare-workers");
        (0, vitest_1.expect)(workers).toBeDefined();
        (0, vitest_1.expect)(workers.kind).toBe("serverless");
        (0, vitest_1.expect)(workers.name).toBe("api-worker");
        const evidence = result.evidence.find((e) => e.detectedAs === "cloud:cloudflare-workers");
        (0, vitest_1.expect)(evidence).toBeDefined();
    });
    (0, vitest_1.it)("detects Firebase Functions from firebase.json", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({ functions: { source: "functions" } }));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        const fb = result.configs.find((c) => c.provider === "firebase-functions");
        (0, vitest_1.expect)(fb).toBeDefined();
        (0, vitest_1.expect)(fb.kind).toBe("serverless");
        const evidence = result.evidence.find((e) => e.detectedAs === "cloud:firebase-functions");
        (0, vitest_1.expect)(evidence).toBeDefined();
    });
    (0, vitest_1.it)("detects both CF Workers and Firebase Functions in one project", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `name = "api"\nroute = "api.mtnmap.app/*"`);
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({ functions: { source: "functions" } }));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        const workers = result.configs.find((c) => c.provider === "cloudflare-workers");
        const fb = result.configs.find((c) => c.provider === "firebase-functions");
        (0, vitest_1.expect)(workers).toBeDefined();
        (0, vitest_1.expect)(fb).toBeDefined();
    });
    (0, vitest_1.it)("detects serverless alongside database services", async () => {
        // Mtnmap-like setup: Neon + CF Workers + Firebase Functions
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), "DATABASE_URL=postgres://user:pw@ep-cool.neon.tech/mydb\n");
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `name = "api"\nroute = "api.example.com/*"`);
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({ functions: { source: "functions" } }));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        (0, vitest_1.expect)(result.configs.length).toBeGreaterThanOrEqual(3);
        const neon = result.configs.find((c) => c.provider === "neon");
        const workers = result.configs.find((c) => c.provider === "cloudflare-workers");
        const fb = result.configs.find((c) => c.provider === "firebase-functions");
        (0, vitest_1.expect)(neon).toBeDefined();
        (0, vitest_1.expect)(workers).toBeDefined();
        (0, vitest_1.expect)(fb).toBeDefined();
    });
    (0, vitest_1.it)("returns no serverless when no markers found", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({ name: "simple-app", dependencies: {} }));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        const serverless = result.configs.filter((c) => c.kind === "serverless");
        (0, vitest_1.expect)(serverless).toHaveLength(0);
    });
});
//# sourceMappingURL=serverless-adapters.test.js.map