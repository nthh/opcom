import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseTursoUrl,
  detectTurso,
  parseNeonUrl,
  isNeonUrl,
  detectNeon,
  detectPrisma,
  parseMigrateStatus,
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
// Turso URL parsing
// =============================================================================

describe("parseTursoUrl", () => {
  it("parses libsql://dbname-org.turso.io", () => {
    expect(parseTursoUrl("libsql://myapp-prod-myorg.turso.io")).toBe("myapp-prod");
  });

  it("parses libsql://dbname.turso.io without org suffix", () => {
    expect(parseTursoUrl("libsql://mydb.turso.io")).toBe("mydb");
  });

  it("parses https variant", () => {
    expect(parseTursoUrl("https://myapp-prod-myorg.turso.io")).toBe("myapp-prod");
  });

  it("returns null for non-turso URLs", () => {
    expect(parseTursoUrl("postgres://user:pw@localhost/db")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseTursoUrl("")).toBeNull();
  });
});

// =============================================================================
// Neon URL parsing
// =============================================================================

describe("parseNeonUrl", () => {
  it("parses standard Neon postgres URL", () => {
    const result = parseNeonUrl(
      "postgres://user:pw@ep-cool-bar-123.us-east-2.aws.neon.tech/mydb",
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBe("mydb");
    expect(result!.host).toContain("neon.tech");
  });

  it("parses postgresql:// variant", () => {
    const result = parseNeonUrl(
      "postgresql://user:pw@ep-test-456.neon.tech/platform_dm",
    );
    expect(result).not.toBeNull();
    expect(result!.name).toBe("platform_dm");
  });

  it("returns null for non-neon URLs", () => {
    expect(parseNeonUrl("postgres://user:pw@localhost/db")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseNeonUrl("")).toBeNull();
  });
});

describe("isNeonUrl", () => {
  it("returns true for neon.tech URLs", () => {
    expect(isNeonUrl("postgres://user:pw@ep-cool.neon.tech/db")).toBe(true);
  });

  it("returns false for non-neon URLs", () => {
    expect(isNeonUrl("postgres://user:pw@localhost/db")).toBe(false);
  });
});

// =============================================================================
// Turso detection from project files
// =============================================================================

describe("detectTurso", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-turso-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects from .env with TURSO_DATABASE_URL", async () => {
    await writeFile(
      join(tempDir, ".env"),
      'TURSO_DATABASE_URL="libsql://myapp-prod-myorg.turso.io"\nOTHER_VAR=value\n',
    );

    const result = await detectTurso(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("turso");
    expect(result!.kind).toBe("database");
    expect(result!.name).toBe("myapp-prod");
    expect(result!.connectionUrl).toContain("turso.io");
  });

  it("detects from .env with LIBSQL_URL", async () => {
    await writeFile(
      join(tempDir, ".env"),
      "LIBSQL_URL=libsql://mydb.turso.io\n",
    );

    const result = await detectTurso(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("mydb");
  });

  it("detects from .env.local", async () => {
    await writeFile(
      join(tempDir, ".env.local"),
      "TURSO_DATABASE_URL=libsql://dev-db.turso.io\n",
    );

    const result = await detectTurso(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("dev-db");
  });

  it("detects from turso.toml", async () => {
    await writeFile(join(tempDir, "turso.toml"), "[database]\nname = 'mydb'\n");

    const result = await detectTurso(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("turso");
  });

  it("detects from drizzle.config.ts with libsql", async () => {
    await writeFile(
      join(tempDir, "drizzle.config.ts"),
      `
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  driver: "libsql",
  dbCredentials: { url: process.env.TURSO_DATABASE_URL! },
});
`,
    );

    const result = await detectTurso(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("turso");
  });

  it("detects from package.json with @libsql/client", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: { "@libsql/client": "^0.5.0" },
      }),
    );

    const result = await detectTurso(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("turso");
  });

  it("returns null when no Turso markers found", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test", dependencies: { express: "^4.0" } }),
    );

    const result = await detectTurso(tempDir, emptyStack);
    expect(result).toBeNull();
  });
});

// =============================================================================
// Neon detection from project files
// =============================================================================

describe("detectNeon", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-neon-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects from .env with DATABASE_URL pointing to neon.tech", async () => {
    await writeFile(
      join(tempDir, ".env"),
      'DATABASE_URL="postgres://user:pw@ep-cool-bar-123.us-east-2.aws.neon.tech/platform_dm"\n',
    );

    const result = await detectNeon(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("neon");
    expect(result!.kind).toBe("database");
    expect(result!.name).toBe("platform_dm");
  });

  it("detects from .env with POSTGRES_URL pointing to neon.tech", async () => {
    await writeFile(
      join(tempDir, ".env"),
      "POSTGRES_URL=postgres://user:pw@ep-test.neon.tech/mydb\n",
    );

    const result = await detectNeon(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("mydb");
  });

  it("detects from prisma/schema.prisma referencing neon via env", async () => {
    await mkdir(join(tempDir, "prisma"), { recursive: true });
    await writeFile(
      join(tempDir, "prisma", "schema.prisma"),
      `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`,
    );
    await writeFile(
      join(tempDir, ".env"),
      "DATABASE_URL=postgres://user:pw@ep-test.neon.tech/appdb\n",
    );

    const result = await detectNeon(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("neon");
    expect(result!.name).toBe("appdb");
  });

  it("detects from drizzle.config.ts with neon reference", async () => {
    await writeFile(
      join(tempDir, "drizzle.config.ts"),
      `
import { defineConfig } from "drizzle-kit";
import { neon } from "@neondatabase/serverless";
export default defineConfig({
  driver: "neon",
});
`,
    );

    const result = await detectNeon(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("neon");
  });

  it("returns null when no Neon markers found", async () => {
    await writeFile(
      join(tempDir, ".env"),
      "DATABASE_URL=postgres://user:pw@localhost/db\n",
    );

    const result = await detectNeon(tempDir, emptyStack);
    expect(result).toBeNull();
  });
});

// =============================================================================
// Prisma detection
// =============================================================================

describe("detectPrisma", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-prisma-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects from prisma/schema.prisma", async () => {
    await mkdir(join(tempDir, "prisma"), { recursive: true });
    await writeFile(
      join(tempDir, "prisma", "schema.prisma"),
      `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
`,
    );

    const result = await detectPrisma(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.schemaPath).toBe("prisma/schema.prisma");
    expect(result!.provider).toBe("postgresql");
  });

  it("detects sqlite provider from schema", async () => {
    await mkdir(join(tempDir, "prisma"), { recursive: true });
    await writeFile(
      join(tempDir, "prisma", "schema.prisma"),
      `
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
`,
    );

    const result = await detectPrisma(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("sqlite");
  });

  it("detects from package.json with prisma dependency", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "test",
        devDependencies: { prisma: "^5.0.0" },
        dependencies: { "@prisma/client": "^5.0.0" },
      }),
    );

    const result = await detectPrisma(tempDir, emptyStack);
    expect(result).not.toBeNull();
    expect(result!.schemaPath).toBe("prisma/schema.prisma");
  });

  it("returns null when no Prisma markers found", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test", dependencies: {} }),
    );

    const result = await detectPrisma(tempDir, emptyStack);
    expect(result).toBeNull();
  });
});

// =============================================================================
// Prisma migrate status parsing
// =============================================================================

describe("parseMigrateStatus", () => {
  it("parses all migrations applied", () => {
    const output = `
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "mydb"

47 migrations found in prisma/migrations

47 of 47 migrations have been applied.
`;
    const result = parseMigrateStatus(output);
    expect(result.tool).toBe("prisma");
    expect(result.applied).toBe(47);
    expect(result.pending).toBe(0);
  });

  it("parses pending migrations", () => {
    const output = `
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "mydb"

47 migrations found in prisma/migrations

45 of 47 migrations have been applied.
Following 2 migrations have not yet been applied:
20260228_add_user_prefs
20260301_fix_schema
`;
    const result = parseMigrateStatus(output);
    expect(result.tool).toBe("prisma");
    expect(result.applied).toBe(45);
    expect(result.pending).toBe(2);
  });

  it("parses database up to date", () => {
    const output = `
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "mydb"

10 migrations found in prisma/migrations
Database schema is up to date!
`;
    const result = parseMigrateStatus(output);
    expect(result.tool).toBe("prisma");
    expect(result.applied).toBe(10);
    expect(result.pending).toBe(0);
  });

  it("handles empty output", () => {
    const result = parseMigrateStatus("");
    expect(result.tool).toBe("prisma");
    expect(result.applied).toBe(0);
    expect(result.pending).toBe(0);
  });

  it("parses single migration found", () => {
    const output = `
1 migration found in prisma/migrations
1 of 1 migrations have been applied.
`;
    const result = parseMigrateStatus(output);
    expect(result.applied).toBe(1);
    expect(result.pending).toBe(0);
  });
});

// =============================================================================
// Cloud detection integration (Tier 4)
// =============================================================================

describe("detectCloudServices", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-cloud-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects multiple cloud services in one project", async () => {
    // Set up a project with both Turso and Neon
    await writeFile(
      join(tempDir, ".env"),
      [
        "TURSO_DATABASE_URL=libsql://myapp-prod-myorg.turso.io",
        "DATABASE_URL=postgres://user:pw@ep-cool.neon.tech/platform_dm",
      ].join("\n"),
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    expect(result.configs).toHaveLength(2);

    const turso = result.configs.find((c) => c.provider === "turso");
    expect(turso).toBeDefined();
    expect(turso!.kind).toBe("database");

    const neon = result.configs.find((c) => c.provider === "neon");
    expect(neon).toBeDefined();
    expect(neon!.kind).toBe("database");

    expect(result.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty when no cloud services found", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "simple-app", dependencies: {} }),
    );

    const result = await detectCloudServices(tempDir, emptyStack);
    expect(result.configs).toHaveLength(0);
  });

  it("includes Prisma evidence when detected", async () => {
    await mkdir(join(tempDir, "prisma"), { recursive: true });
    await writeFile(
      join(tempDir, "prisma", "schema.prisma"),
      `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`,
    );
    await writeFile(
      join(tempDir, ".env"),
      "DATABASE_URL=postgres://user:pw@ep-cool.neon.tech/mydb\n",
    );

    const result = await detectCloudServices(tempDir, emptyStack);

    // Should detect Neon + Prisma evidence
    const neon = result.configs.find((c) => c.provider === "neon");
    expect(neon).toBeDefined();

    const prismaEvidence = result.evidence.find(
      (e) => e.detectedAs === "cloud:prisma-migrations",
    );
    expect(prismaEvidence).toBeDefined();
    expect(prismaEvidence!.details).toContain("postgresql");
  });
});
