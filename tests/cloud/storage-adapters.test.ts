import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseR2Buckets,
  detectR2,
  parseGsutilSize,
  parseFirebaseStorageBucket,
  detectGCS,
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
// R2 bucket parsing from wrangler.toml
// =============================================================================

describe("parseR2Buckets", () => {
  it("parses single [[r2_buckets]] binding", () => {
    const toml = `
name = "my-worker"
account_id = "abc123"

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "folia-assets"
`;
    expect(parseR2Buckets(toml)).toEqual(["folia-assets"]);
  });

  it("parses multiple [[r2_buckets]] bindings", () => {
    const toml = `
name = "my-worker"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "media-bucket"

[[r2_buckets]]
binding = "BACKUP"
bucket_name = "backup-bucket"
`;
    expect(parseR2Buckets(toml)).toEqual(["media-bucket", "backup-bucket"]);
  });

  it("returns empty array when no r2_buckets section", () => {
    const toml = `
name = "my-worker"
account_id = "abc123"

[triggers]
crons = ["*/5 * * * *"]
`;
    expect(parseR2Buckets(toml)).toEqual([]);
  });

  it("handles bucket_name with single quotes", () => {
    const toml = `
[[r2_buckets]]
binding = "DATA"
bucket_name = 'my-data-bucket'
`;
    expect(parseR2Buckets(toml)).toEqual(["my-data-bucket"]);
  });

  it("ignores r2_buckets without bucket_name", () => {
    const toml = `
[[r2_buckets]]
binding = "ASSETS"
preview_bucket_name = "preview-bucket"
`;
    expect(parseR2Buckets(toml)).toEqual([]);
  });
});

// =============================================================================
// R2 detection from project files
// =============================================================================

describe("detectR2", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-r2-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects from wrangler.toml with [[r2_buckets]]", async () => {
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `
name = "my-worker"
account_id = "abc123"

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "folia-assets"
`,
    );

    const result = await detectR2(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("cloudflare-r2");
    expect(result!.kind).toBe("storage");
    expect(result!.name).toBe("folia-assets");
    expect(result!.bucket).toBe("folia-assets");
    expect(result!.buckets).toEqual(["folia-assets"]);
    expect(result!.accountId).toBe("abc123");
  });

  it("detects multiple R2 buckets from wrangler.toml", async () => {
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `
name = "my-worker"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "media-bucket"

[[r2_buckets]]
binding = "BACKUP"
bucket_name = "backup-bucket"
`,
    );

    const result = await detectR2(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("media-bucket");
    expect(result!.buckets).toEqual(["media-bucket", "backup-bucket"]);
  });

  it("detects from .env with R2_BUCKET", async () => {
    await writeFile(
      join(tempDir, ".env"),
      'R2_BUCKET="my-r2-bucket"\nCLOUDFLARE_ACCOUNT_ID=abc123\n',
    );

    const result = await detectR2(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("cloudflare-r2");
    expect(result!.name).toBe("my-r2-bucket");
    expect(result!.bucket).toBe("my-r2-bucket");
    expect(result!.accountId).toBe("abc123");
  });

  it("detects from .env with R2_BUCKET_NAME", async () => {
    await writeFile(
      join(tempDir, ".env"),
      "R2_BUCKET_NAME=assets-bucket\n",
    );

    const result = await detectR2(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("assets-bucket");
  });

  it("detects from .env.local", async () => {
    await writeFile(
      join(tempDir, ".env.local"),
      "R2_BUCKET=dev-bucket\n",
    );

    const result = await detectR2(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("dev-bucket");
  });

  it("detects from package.json scripts with wrangler r2", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: {
          "upload": "wrangler r2 object put my-bucket/file.txt --file=./file.txt",
        },
      }),
    );

    const result = await detectR2(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("cloudflare-r2");
    expect(result!.name).toBe("r2-bucket");
  });

  it("detects from wrangler.json with r2_buckets", async () => {
    await writeFile(
      join(tempDir, "wrangler.json"),
      JSON.stringify({
        name: "my-worker",
        account_id: "xyz789",
        r2_buckets: [
          { binding: "ASSETS", bucket_name: "json-bucket" },
        ],
      }),
    );

    const result = await detectR2(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("cloudflare-r2");
    expect(result!.name).toBe("json-bucket");
    expect(result!.accountId).toBe("xyz789");
  });

  it("returns null when no R2 markers found", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test", dependencies: { express: "^4.0" } }),
    );

    const result = await detectR2(tempDir, emptyStack);
    expect(result).toBeNull();
  });

  it("returns null for wrangler.toml without r2_buckets", async () => {
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `
name = "my-worker"
account_id = "abc123"

[triggers]
crons = ["*/5 * * * *"]
`,
    );

    const result = await detectR2(tempDir, emptyStack);
    expect(result).toBeNull();
  });

  it("prefers wrangler.toml over .env", async () => {
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `
account_id = "from-toml"

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "toml-bucket"
`,
    );
    await writeFile(
      join(tempDir, ".env"),
      "R2_BUCKET=env-bucket\n",
    );

    const result = await detectR2(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("toml-bucket");
    expect(result!.accountId).toBe("from-toml");
  });
});

// =============================================================================
// GCS gsutil size parsing
// =============================================================================

describe("parseGsutilSize", () => {
  it("parses standard gsutil du output", () => {
    expect(parseGsutilSize("12345678  gs://my-bucket")).toBe(12345678);
  });

  it("parses with leading whitespace", () => {
    expect(parseGsutilSize("  98765  gs://other-bucket")).toBe(98765);
  });

  it("returns null for empty output", () => {
    expect(parseGsutilSize("")).toBeNull();
  });

  it("returns null for non-matching output", () => {
    expect(parseGsutilSize("No objects found")).toBeNull();
  });

  it("parses large sizes (GB range)", () => {
    expect(parseGsutilSize("2300000000  gs://big-bucket")).toBe(2300000000);
  });
});

// =============================================================================
// Firebase Storage bucket parsing
// =============================================================================

describe("parseFirebaseStorageBucket", () => {
  it("extracts explicit bucket name", () => {
    const json = JSON.stringify({
      storage: { bucket: "my-project.appspot.com", rules: "storage.rules" },
    });
    expect(parseFirebaseStorageBucket(json)).toBe("my-project.appspot.com");
  });

  it("returns null when storage has rules but no explicit bucket", () => {
    const json = JSON.stringify({
      storage: { rules: "storage.rules" },
    });
    expect(parseFirebaseStorageBucket(json)).toBeNull();
  });

  it("returns null when no storage config", () => {
    const json = JSON.stringify({
      hosting: { public: "dist" },
    });
    expect(parseFirebaseStorageBucket(json)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseFirebaseStorageBucket("not json")).toBeNull();
  });
});

// =============================================================================
// GCS detection from project files
// =============================================================================

describe("detectGCS", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-gcs-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects from .env with GCS_BUCKET", async () => {
    await writeFile(
      join(tempDir, ".env"),
      'GCS_BUCKET="my-gcs-bucket"\nGOOGLE_CLOUD_PROJECT=my-project\n',
    );

    const result = await detectGCS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("gcs");
    expect(result!.kind).toBe("storage");
    expect(result!.name).toBe("my-gcs-bucket");
    expect(result!.bucket).toBe("my-gcs-bucket");
    expect(result!.projectId).toBe("my-project");
  });

  it("detects from .env with GCS_BUCKET_NAME", async () => {
    await writeFile(
      join(tempDir, ".env"),
      "GCS_BUCKET_NAME=backup-bucket\n",
    );

    const result = await detectGCS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("backup-bucket");
  });

  it("detects from .env.local", async () => {
    await writeFile(
      join(tempDir, ".env.local"),
      "GCS_BUCKET=dev-storage\n",
    );

    const result = await detectGCS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("dev-storage");
  });

  it("detects from firebase.json with storage config", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({
        storage: { rules: "storage.rules", bucket: "my-app.appspot.com" },
        hosting: { public: "dist" },
      }),
    );

    const result = await detectGCS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("gcs");
    expect(result!.name).toBe("my-app.appspot.com");
    expect(result!.bucket).toBe("my-app.appspot.com");
  });

  it("detects from firebase.json with storage rules and .firebaserc project", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({ storage: { rules: "storage.rules" } }),
    );
    await writeFile(
      join(tempDir, ".firebaserc"),
      JSON.stringify({ projects: { default: "mtnmap-prod" } }),
    );

    const result = await detectGCS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("gcs");
    expect(result!.name).toBe("mtnmap-prod.appspot.com");
    expect(result!.bucket).toBe("mtnmap-prod.appspot.com");
    expect(result!.projectId).toBe("mtnmap-prod");
  });

  it("detects from package.json scripts with gsutil", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: {
          "backup": "gsutil rsync -r ./data gs://my-backup-bucket/data",
        },
      }),
    );

    const result = await detectGCS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("gcs");
    expect(result!.name).toBe("my-backup-bucket");
    expect(result!.bucket).toBe("my-backup-bucket");
  });

  it("returns null when no GCS markers found", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test", dependencies: { express: "^4.0" } }),
    );

    const result = await detectGCS(tempDir, emptyStack);
    expect(result).toBeNull();
  });

  it("returns null for firebase.json without storage", async () => {
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({ hosting: { public: "dist" } }),
    );

    const result = await detectGCS(tempDir, emptyStack);
    expect(result).toBeNull();
  });

  it("does not detect from GOOGLE_CLOUD_PROJECT alone without storage vars", async () => {
    await writeFile(
      join(tempDir, ".env"),
      "GOOGLE_CLOUD_PROJECT=my-project\nDATABASE_URL=postgres://localhost/db\n",
    );

    const result = await detectGCS(tempDir, emptyStack);
    expect(result).toBeNull();
  });

  it("detects from GOOGLE_CLOUD_PROJECT with storage env vars", async () => {
    await writeFile(
      join(tempDir, ".env"),
      "GOOGLE_CLOUD_PROJECT=my-project\nGCS_ENDPOINT=https://storage.googleapis.com\n",
    );

    const result = await detectGCS(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("gcs");
    expect(result!.projectId).toBe("my-project");
  });
});

// =============================================================================
// Cloud detection integration — storage services
// =============================================================================

describe("detectCloudServices — storage", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-cloud-storage-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects R2 alongside database services", async () => {
    await writeFile(
      join(tempDir, ".env"),
      [
        "TURSO_DATABASE_URL=libsql://myapp-prod-myorg.turso.io",
        "R2_BUCKET=assets",
      ].join("\n"),
    );
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `
[[r2_buckets]]
binding = "ASSETS"
bucket_name = "assets"
`,
    );

    const result = await detectCloudServices(tempDir, emptyStack);

    const turso = result.configs.find((c) => c.provider === "turso");
    expect(turso).toBeDefined();
    expect(turso!.kind).toBe("database");

    const r2 = result.configs.find((c) => c.provider === "cloudflare-r2");
    expect(r2).toBeDefined();
    expect(r2!.kind).toBe("storage");

    const r2Evidence = result.evidence.find(
      (e) => e.detectedAs === "cloud:cloudflare-r2",
    );
    expect(r2Evidence).toBeDefined();
    expect(r2Evidence!.details).toContain("storage");
  });

  it("detects both R2 and GCS in one project (like Mtnmap)", async () => {
    // R2 via wrangler.toml
    await writeFile(
      join(tempDir, "wrangler.toml"),
      `
[[r2_buckets]]
binding = "MEDIA"
bucket_name = "mtnmap-media"
`,
    );
    // GCS via firebase.json storage
    await writeFile(
      join(tempDir, "firebase.json"),
      JSON.stringify({
        storage: { rules: "storage.rules" },
        hosting: { public: "dist" },
      }),
    );
    await writeFile(
      join(tempDir, ".firebaserc"),
      JSON.stringify({ projects: { default: "mtnmap-prod" } }),
    );

    const result = await detectCloudServices(tempDir, emptyStack);

    const r2 = result.configs.find((c) => c.provider === "cloudflare-r2");
    expect(r2).toBeDefined();
    expect(r2!.kind).toBe("storage");

    const gcs = result.configs.find((c) => c.provider === "gcs");
    expect(gcs).toBeDefined();
    expect(gcs!.kind).toBe("storage");

    expect(result.evidence.filter((e) => e.details.includes("storage"))).toHaveLength(2);
  });

  it("returns no storage services for clean project", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "simple-app", dependencies: { express: "^4" } }),
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    const storageConfigs = result.configs.filter((c) => c.kind === "storage");
    expect(storageConfigs).toHaveLength(0);
  });
});
