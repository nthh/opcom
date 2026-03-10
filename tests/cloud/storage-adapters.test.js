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
// R2 bucket parsing from wrangler.toml
// =============================================================================
(0, vitest_1.describe)("parseR2Buckets", () => {
    (0, vitest_1.it)("parses single [[r2_buckets]] binding", () => {
        const toml = `
name = "my-worker"
account_id = "abc123"

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "folia-assets"
`;
        (0, vitest_1.expect)((0, core_1.parseR2Buckets)(toml)).toEqual(["folia-assets"]);
    });
    (0, vitest_1.it)("parses multiple [[r2_buckets]] bindings", () => {
        const toml = `
name = "my-worker"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "media-bucket"

[[r2_buckets]]
binding = "BACKUP"
bucket_name = "backup-bucket"
`;
        (0, vitest_1.expect)((0, core_1.parseR2Buckets)(toml)).toEqual(["media-bucket", "backup-bucket"]);
    });
    (0, vitest_1.it)("returns empty array when no r2_buckets section", () => {
        const toml = `
name = "my-worker"
account_id = "abc123"

[triggers]
crons = ["*/5 * * * *"]
`;
        (0, vitest_1.expect)((0, core_1.parseR2Buckets)(toml)).toEqual([]);
    });
    (0, vitest_1.it)("handles bucket_name with single quotes", () => {
        const toml = `
[[r2_buckets]]
binding = "DATA"
bucket_name = 'my-data-bucket'
`;
        (0, vitest_1.expect)((0, core_1.parseR2Buckets)(toml)).toEqual(["my-data-bucket"]);
    });
    (0, vitest_1.it)("ignores r2_buckets without bucket_name", () => {
        const toml = `
[[r2_buckets]]
binding = "ASSETS"
preview_bucket_name = "preview-bucket"
`;
        (0, vitest_1.expect)((0, core_1.parseR2Buckets)(toml)).toEqual([]);
    });
});
// =============================================================================
// R2 detection from project files
// =============================================================================
(0, vitest_1.describe)("detectR2", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-r2-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects from wrangler.toml with [[r2_buckets]]", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `
name = "my-worker"
account_id = "abc123"

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "folia-assets"
`);
        const result = await (0, core_1.detectR2)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("cloudflare-r2");
        (0, vitest_1.expect)(result.kind).toBe("storage");
        (0, vitest_1.expect)(result.name).toBe("folia-assets");
        (0, vitest_1.expect)(result.bucket).toBe("folia-assets");
        (0, vitest_1.expect)(result.buckets).toEqual(["folia-assets"]);
        (0, vitest_1.expect)(result.accountId).toBe("abc123");
    });
    (0, vitest_1.it)("detects multiple R2 buckets from wrangler.toml", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `
name = "my-worker"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "media-bucket"

[[r2_buckets]]
binding = "BACKUP"
bucket_name = "backup-bucket"
`);
        const result = await (0, core_1.detectR2)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("media-bucket");
        (0, vitest_1.expect)(result.buckets).toEqual(["media-bucket", "backup-bucket"]);
    });
    (0, vitest_1.it)("detects from .env with R2_BUCKET", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), 'R2_BUCKET="my-r2-bucket"\nCLOUDFLARE_ACCOUNT_ID=abc123\n');
        const result = await (0, core_1.detectR2)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("cloudflare-r2");
        (0, vitest_1.expect)(result.name).toBe("my-r2-bucket");
        (0, vitest_1.expect)(result.bucket).toBe("my-r2-bucket");
        (0, vitest_1.expect)(result.accountId).toBe("abc123");
    });
    (0, vitest_1.it)("detects from .env with R2_BUCKET_NAME", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), "R2_BUCKET_NAME=assets-bucket\n");
        const result = await (0, core_1.detectR2)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("assets-bucket");
    });
    (0, vitest_1.it)("detects from .env.local", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env.local"), "R2_BUCKET=dev-bucket\n");
        const result = await (0, core_1.detectR2)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("dev-bucket");
    });
    (0, vitest_1.it)("detects from package.json scripts with wrangler r2", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({
            name: "test",
            scripts: {
                "upload": "wrangler r2 object put my-bucket/file.txt --file=./file.txt",
            },
        }));
        const result = await (0, core_1.detectR2)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("cloudflare-r2");
        (0, vitest_1.expect)(result.name).toBe("r2-bucket");
    });
    (0, vitest_1.it)("detects from wrangler.json with r2_buckets", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.json"), JSON.stringify({
            name: "my-worker",
            account_id: "xyz789",
            r2_buckets: [
                { binding: "ASSETS", bucket_name: "json-bucket" },
            ],
        }));
        const result = await (0, core_1.detectR2)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("cloudflare-r2");
        (0, vitest_1.expect)(result.name).toBe("json-bucket");
        (0, vitest_1.expect)(result.accountId).toBe("xyz789");
    });
    (0, vitest_1.it)("returns null when no R2 markers found", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({ name: "test", dependencies: { express: "^4.0" } }));
        const result = await (0, core_1.detectR2)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("returns null for wrangler.toml without r2_buckets", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `
name = "my-worker"
account_id = "abc123"

[triggers]
crons = ["*/5 * * * *"]
`);
        const result = await (0, core_1.detectR2)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("prefers wrangler.toml over .env", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `
account_id = "from-toml"

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "toml-bucket"
`);
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), "R2_BUCKET=env-bucket\n");
        const result = await (0, core_1.detectR2)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("toml-bucket");
        (0, vitest_1.expect)(result.accountId).toBe("from-toml");
    });
});
// =============================================================================
// GCS gsutil size parsing
// =============================================================================
(0, vitest_1.describe)("parseGsutilSize", () => {
    (0, vitest_1.it)("parses standard gsutil du output", () => {
        (0, vitest_1.expect)((0, core_1.parseGsutilSize)("12345678  gs://my-bucket")).toBe(12345678);
    });
    (0, vitest_1.it)("parses with leading whitespace", () => {
        (0, vitest_1.expect)((0, core_1.parseGsutilSize)("  98765  gs://other-bucket")).toBe(98765);
    });
    (0, vitest_1.it)("returns null for empty output", () => {
        (0, vitest_1.expect)((0, core_1.parseGsutilSize)("")).toBeNull();
    });
    (0, vitest_1.it)("returns null for non-matching output", () => {
        (0, vitest_1.expect)((0, core_1.parseGsutilSize)("No objects found")).toBeNull();
    });
    (0, vitest_1.it)("parses large sizes (GB range)", () => {
        (0, vitest_1.expect)((0, core_1.parseGsutilSize)("2300000000  gs://big-bucket")).toBe(2300000000);
    });
});
// =============================================================================
// Firebase Storage bucket parsing
// =============================================================================
(0, vitest_1.describe)("parseFirebaseStorageBucket", () => {
    (0, vitest_1.it)("extracts explicit bucket name", () => {
        const json = JSON.stringify({
            storage: { bucket: "my-project.appspot.com", rules: "storage.rules" },
        });
        (0, vitest_1.expect)((0, core_1.parseFirebaseStorageBucket)(json)).toBe("my-project.appspot.com");
    });
    (0, vitest_1.it)("returns null when storage has rules but no explicit bucket", () => {
        const json = JSON.stringify({
            storage: { rules: "storage.rules" },
        });
        (0, vitest_1.expect)((0, core_1.parseFirebaseStorageBucket)(json)).toBeNull();
    });
    (0, vitest_1.it)("returns null when no storage config", () => {
        const json = JSON.stringify({
            hosting: { public: "dist" },
        });
        (0, vitest_1.expect)((0, core_1.parseFirebaseStorageBucket)(json)).toBeNull();
    });
    (0, vitest_1.it)("returns null for invalid JSON", () => {
        (0, vitest_1.expect)((0, core_1.parseFirebaseStorageBucket)("not json")).toBeNull();
    });
});
// =============================================================================
// GCS detection from project files
// =============================================================================
(0, vitest_1.describe)("detectGCS", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-gcs-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects from .env with GCS_BUCKET", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), 'GCS_BUCKET="my-gcs-bucket"\nGOOGLE_CLOUD_PROJECT=my-project\n');
        const result = await (0, core_1.detectGCS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("gcs");
        (0, vitest_1.expect)(result.kind).toBe("storage");
        (0, vitest_1.expect)(result.name).toBe("my-gcs-bucket");
        (0, vitest_1.expect)(result.bucket).toBe("my-gcs-bucket");
        (0, vitest_1.expect)(result.projectId).toBe("my-project");
    });
    (0, vitest_1.it)("detects from .env with GCS_BUCKET_NAME", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), "GCS_BUCKET_NAME=backup-bucket\n");
        const result = await (0, core_1.detectGCS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("backup-bucket");
    });
    (0, vitest_1.it)("detects from .env.local", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env.local"), "GCS_BUCKET=dev-storage\n");
        const result = await (0, core_1.detectGCS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("dev-storage");
    });
    (0, vitest_1.it)("detects from firebase.json with storage config", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({
            storage: { rules: "storage.rules", bucket: "my-app.appspot.com" },
            hosting: { public: "dist" },
        }));
        const result = await (0, core_1.detectGCS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("gcs");
        (0, vitest_1.expect)(result.name).toBe("my-app.appspot.com");
        (0, vitest_1.expect)(result.bucket).toBe("my-app.appspot.com");
    });
    (0, vitest_1.it)("detects from firebase.json with storage rules and .firebaserc project", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({ storage: { rules: "storage.rules" } }));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".firebaserc"), JSON.stringify({ projects: { default: "mtnmap-prod" } }));
        const result = await (0, core_1.detectGCS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("gcs");
        (0, vitest_1.expect)(result.name).toBe("mtnmap-prod.appspot.com");
        (0, vitest_1.expect)(result.bucket).toBe("mtnmap-prod.appspot.com");
        (0, vitest_1.expect)(result.projectId).toBe("mtnmap-prod");
    });
    (0, vitest_1.it)("detects from package.json scripts with gsutil", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({
            name: "test",
            scripts: {
                "backup": "gsutil rsync -r ./data gs://my-backup-bucket/data",
            },
        }));
        const result = await (0, core_1.detectGCS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("gcs");
        (0, vitest_1.expect)(result.name).toBe("my-backup-bucket");
        (0, vitest_1.expect)(result.bucket).toBe("my-backup-bucket");
    });
    (0, vitest_1.it)("returns null when no GCS markers found", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({ name: "test", dependencies: { express: "^4.0" } }));
        const result = await (0, core_1.detectGCS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("returns null for firebase.json without storage", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({ hosting: { public: "dist" } }));
        const result = await (0, core_1.detectGCS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("does not detect from GOOGLE_CLOUD_PROJECT alone without storage vars", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), "GOOGLE_CLOUD_PROJECT=my-project\nDATABASE_URL=postgres://localhost/db\n");
        const result = await (0, core_1.detectGCS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
    (0, vitest_1.it)("detects from GOOGLE_CLOUD_PROJECT with storage env vars", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), "GOOGLE_CLOUD_PROJECT=my-project\nGCS_ENDPOINT=https://storage.googleapis.com\n");
        const result = await (0, core_1.detectGCS)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("gcs");
        (0, vitest_1.expect)(result.projectId).toBe("my-project");
    });
});
// =============================================================================
// Cloud detection integration — storage services
// =============================================================================
(0, vitest_1.describe)("detectCloudServices — storage", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-cloud-storage-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects R2 alongside database services", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), [
            "TURSO_DATABASE_URL=libsql://myapp-prod-myorg.turso.io",
            "R2_BUCKET=assets",
        ].join("\n"));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `
[[r2_buckets]]
binding = "ASSETS"
bucket_name = "assets"
`);
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        const turso = result.configs.find((c) => c.provider === "turso");
        (0, vitest_1.expect)(turso).toBeDefined();
        (0, vitest_1.expect)(turso.kind).toBe("database");
        const r2 = result.configs.find((c) => c.provider === "cloudflare-r2");
        (0, vitest_1.expect)(r2).toBeDefined();
        (0, vitest_1.expect)(r2.kind).toBe("storage");
        const r2Evidence = result.evidence.find((e) => e.detectedAs === "cloud:cloudflare-r2");
        (0, vitest_1.expect)(r2Evidence).toBeDefined();
        (0, vitest_1.expect)(r2Evidence.details).toContain("storage");
    });
    (0, vitest_1.it)("detects both R2 and GCS in one project (like Mtnmap)", async () => {
        // R2 via wrangler.toml
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "wrangler.toml"), `
[[r2_buckets]]
binding = "MEDIA"
bucket_name = "mtnmap-media"
`);
        // GCS via firebase.json storage
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "firebase.json"), JSON.stringify({
            storage: { rules: "storage.rules" },
            hosting: { public: "dist" },
        }));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".firebaserc"), JSON.stringify({ projects: { default: "mtnmap-prod" } }));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        const r2 = result.configs.find((c) => c.provider === "cloudflare-r2");
        (0, vitest_1.expect)(r2).toBeDefined();
        (0, vitest_1.expect)(r2.kind).toBe("storage");
        const gcs = result.configs.find((c) => c.provider === "gcs");
        (0, vitest_1.expect)(gcs).toBeDefined();
        (0, vitest_1.expect)(gcs.kind).toBe("storage");
        (0, vitest_1.expect)(result.evidence.filter((e) => e.details.includes("storage"))).toHaveLength(2);
    });
    (0, vitest_1.it)("returns no storage services for clean project", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({ name: "simple-app", dependencies: { express: "^4" } }));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        const storageConfigs = result.configs.filter((c) => c.kind === "storage");
        (0, vitest_1.expect)(storageConfigs).toHaveLength(0);
    });
});
//# sourceMappingURL=storage-adapters.test.js.map