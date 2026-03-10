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
// Turso URL parsing
// =============================================================================
(0, vitest_1.describe)("parseTursoUrl", () => {
    (0, vitest_1.it)("parses libsql://dbname-org.turso.io", () => {
        (0, vitest_1.expect)((0, core_1.parseTursoUrl)("libsql://myapp-prod-myorg.turso.io")).toBe("myapp-prod");
    });
    (0, vitest_1.it)("parses libsql://dbname.turso.io without org suffix", () => {
        (0, vitest_1.expect)((0, core_1.parseTursoUrl)("libsql://mydb.turso.io")).toBe("mydb");
    });
    (0, vitest_1.it)("parses https variant", () => {
        (0, vitest_1.expect)((0, core_1.parseTursoUrl)("https://myapp-prod-myorg.turso.io")).toBe("myapp-prod");
    });
    (0, vitest_1.it)("returns null for non-turso URLs", () => {
        (0, vitest_1.expect)((0, core_1.parseTursoUrl)("postgres://user:pw@localhost/db")).toBeNull();
    });
    (0, vitest_1.it)("returns null for empty string", () => {
        (0, vitest_1.expect)((0, core_1.parseTursoUrl)("")).toBeNull();
    });
});
// =============================================================================
// Neon URL parsing
// =============================================================================
(0, vitest_1.describe)("parseNeonUrl", () => {
    (0, vitest_1.it)("parses standard Neon postgres URL", () => {
        const result = (0, core_1.parseNeonUrl)("postgres://user:pw@ep-cool-bar-123.us-east-2.aws.neon.tech/mydb");
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("mydb");
        (0, vitest_1.expect)(result.host).toContain("neon.tech");
    });
    (0, vitest_1.it)("parses postgresql:// variant", () => {
        const result = (0, core_1.parseNeonUrl)("postgresql://user:pw@ep-test-456.neon.tech/platform_dm");
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("platform_dm");
    });
    (0, vitest_1.it)("returns null for non-neon URLs", () => {
        (0, vitest_1.expect)((0, core_1.parseNeonUrl)("postgres://user:pw@localhost/db")).toBeNull();
    });
    (0, vitest_1.it)("returns null for empty string", () => {
        (0, vitest_1.expect)((0, core_1.parseNeonUrl)("")).toBeNull();
    });
});
(0, vitest_1.describe)("isNeonUrl", () => {
    (0, vitest_1.it)("returns true for neon.tech URLs", () => {
        (0, vitest_1.expect)((0, core_1.isNeonUrl)("postgres://user:pw@ep-cool.neon.tech/db")).toBe(true);
    });
    (0, vitest_1.it)("returns false for non-neon URLs", () => {
        (0, vitest_1.expect)((0, core_1.isNeonUrl)("postgres://user:pw@localhost/db")).toBe(false);
    });
});
// =============================================================================
// Turso detection from project files
// =============================================================================
(0, vitest_1.describe)("detectTurso", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-turso-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects from .env with TURSO_DATABASE_URL", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), 'TURSO_DATABASE_URL="libsql://myapp-prod-myorg.turso.io"\nOTHER_VAR=value\n');
        const result = await (0, core_1.detectTurso)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("turso");
        (0, vitest_1.expect)(result.kind).toBe("database");
        (0, vitest_1.expect)(result.name).toBe("myapp-prod");
        (0, vitest_1.expect)(result.connectionUrl).toContain("turso.io");
    });
    (0, vitest_1.it)("detects from .env with LIBSQL_URL", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), "LIBSQL_URL=libsql://mydb.turso.io\n");
        const result = await (0, core_1.detectTurso)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("mydb");
    });
    (0, vitest_1.it)("detects from .env.local", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env.local"), "TURSO_DATABASE_URL=libsql://dev-db.turso.io\n");
        const result = await (0, core_1.detectTurso)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("dev-db");
    });
    (0, vitest_1.it)("detects from turso.toml", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "turso.toml"), "[database]\nname = 'mydb'\n");
        const result = await (0, core_1.detectTurso)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("turso");
    });
    (0, vitest_1.it)("detects from drizzle.config.ts with libsql", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "drizzle.config.ts"), `
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  driver: "libsql",
  dbCredentials: { url: process.env.TURSO_DATABASE_URL! },
});
`);
        const result = await (0, core_1.detectTurso)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("turso");
    });
    (0, vitest_1.it)("detects from package.json with @libsql/client", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({
            name: "test",
            dependencies: { "@libsql/client": "^0.5.0" },
        }));
        const result = await (0, core_1.detectTurso)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("turso");
    });
    (0, vitest_1.it)("returns null when no Turso markers found", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({ name: "test", dependencies: { express: "^4.0" } }));
        const result = await (0, core_1.detectTurso)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
});
// =============================================================================
// Neon detection from project files
// =============================================================================
(0, vitest_1.describe)("detectNeon", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-neon-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects from .env with DATABASE_URL pointing to neon.tech", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), 'DATABASE_URL="postgres://user:pw@ep-cool-bar-123.us-east-2.aws.neon.tech/platform_dm"\n');
        const result = await (0, core_1.detectNeon)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("neon");
        (0, vitest_1.expect)(result.kind).toBe("database");
        (0, vitest_1.expect)(result.name).toBe("platform_dm");
    });
    (0, vitest_1.it)("detects from .env with POSTGRES_URL pointing to neon.tech", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), "POSTGRES_URL=postgres://user:pw@ep-test.neon.tech/mydb\n");
        const result = await (0, core_1.detectNeon)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.name).toBe("mydb");
    });
    (0, vitest_1.it)("detects from prisma/schema.prisma referencing neon via env", async () => {
        await (0, promises_1.mkdir)((0, node_path_1.join)(tempDir, "prisma"), { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "prisma", "schema.prisma"), `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`);
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), "DATABASE_URL=postgres://user:pw@ep-test.neon.tech/appdb\n");
        const result = await (0, core_1.detectNeon)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("neon");
        (0, vitest_1.expect)(result.name).toBe("appdb");
    });
    (0, vitest_1.it)("detects from drizzle.config.ts with neon reference", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "drizzle.config.ts"), `
import { defineConfig } from "drizzle-kit";
import { neon } from "@neondatabase/serverless";
export default defineConfig({
  driver: "neon",
});
`);
        const result = await (0, core_1.detectNeon)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("neon");
    });
    (0, vitest_1.it)("returns null when no Neon markers found", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), "DATABASE_URL=postgres://user:pw@localhost/db\n");
        const result = await (0, core_1.detectNeon)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
});
// =============================================================================
// Prisma detection
// =============================================================================
(0, vitest_1.describe)("detectPrisma", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-prisma-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects from prisma/schema.prisma", async () => {
        await (0, promises_1.mkdir)((0, node_path_1.join)(tempDir, "prisma"), { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "prisma", "schema.prisma"), `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
`);
        const result = await (0, core_1.detectPrisma)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.schemaPath).toBe("prisma/schema.prisma");
        (0, vitest_1.expect)(result.provider).toBe("postgresql");
    });
    (0, vitest_1.it)("detects sqlite provider from schema", async () => {
        await (0, promises_1.mkdir)((0, node_path_1.join)(tempDir, "prisma"), { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "prisma", "schema.prisma"), `
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
`);
        const result = await (0, core_1.detectPrisma)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.provider).toBe("sqlite");
    });
    (0, vitest_1.it)("detects from package.json with prisma dependency", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({
            name: "test",
            devDependencies: { prisma: "^5.0.0" },
            dependencies: { "@prisma/client": "^5.0.0" },
        }));
        const result = await (0, core_1.detectPrisma)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.schemaPath).toBe("prisma/schema.prisma");
    });
    (0, vitest_1.it)("returns null when no Prisma markers found", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({ name: "test", dependencies: {} }));
        const result = await (0, core_1.detectPrisma)(tempDir, emptyStack);
        (0, vitest_1.expect)(result).toBeNull();
    });
});
// =============================================================================
// Prisma migrate status parsing
// =============================================================================
(0, vitest_1.describe)("parseMigrateStatus", () => {
    (0, vitest_1.it)("parses all migrations applied", () => {
        const output = `
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "mydb"

47 migrations found in prisma/migrations

47 of 47 migrations have been applied.
`;
        const result = (0, core_1.parseMigrateStatus)(output);
        (0, vitest_1.expect)(result.tool).toBe("prisma");
        (0, vitest_1.expect)(result.applied).toBe(47);
        (0, vitest_1.expect)(result.pending).toBe(0);
    });
    (0, vitest_1.it)("parses pending migrations", () => {
        const output = `
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "mydb"

47 migrations found in prisma/migrations

45 of 47 migrations have been applied.
Following 2 migrations have not yet been applied:
20260228_add_user_prefs
20260301_fix_schema
`;
        const result = (0, core_1.parseMigrateStatus)(output);
        (0, vitest_1.expect)(result.tool).toBe("prisma");
        (0, vitest_1.expect)(result.applied).toBe(45);
        (0, vitest_1.expect)(result.pending).toBe(2);
    });
    (0, vitest_1.it)("parses database up to date", () => {
        const output = `
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "mydb"

10 migrations found in prisma/migrations
Database schema is up to date!
`;
        const result = (0, core_1.parseMigrateStatus)(output);
        (0, vitest_1.expect)(result.tool).toBe("prisma");
        (0, vitest_1.expect)(result.applied).toBe(10);
        (0, vitest_1.expect)(result.pending).toBe(0);
    });
    (0, vitest_1.it)("handles empty output", () => {
        const result = (0, core_1.parseMigrateStatus)("");
        (0, vitest_1.expect)(result.tool).toBe("prisma");
        (0, vitest_1.expect)(result.applied).toBe(0);
        (0, vitest_1.expect)(result.pending).toBe(0);
    });
    (0, vitest_1.it)("parses single migration found", () => {
        const output = `
1 migration found in prisma/migrations
1 of 1 migrations have been applied.
`;
        const result = (0, core_1.parseMigrateStatus)(output);
        (0, vitest_1.expect)(result.applied).toBe(1);
        (0, vitest_1.expect)(result.pending).toBe(0);
    });
});
// =============================================================================
// Cloud detection integration (Tier 4)
// =============================================================================
(0, vitest_1.describe)("detectCloudServices", () => {
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-cloud-test-"));
    });
    (0, vitest_1.afterEach)(async () => {
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects multiple cloud services in one project", async () => {
        // Set up a project with both Turso and Neon
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), [
            "TURSO_DATABASE_URL=libsql://myapp-prod-myorg.turso.io",
            "DATABASE_URL=postgres://user:pw@ep-cool.neon.tech/platform_dm",
        ].join("\n"));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        (0, vitest_1.expect)(result.configs).toHaveLength(2);
        const turso = result.configs.find((c) => c.provider === "turso");
        (0, vitest_1.expect)(turso).toBeDefined();
        (0, vitest_1.expect)(turso.kind).toBe("database");
        const neon = result.configs.find((c) => c.provider === "neon");
        (0, vitest_1.expect)(neon).toBeDefined();
        (0, vitest_1.expect)(neon.kind).toBe("database");
        (0, vitest_1.expect)(result.evidence.length).toBeGreaterThanOrEqual(2);
    });
    (0, vitest_1.it)("returns empty when no cloud services found", async () => {
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "package.json"), JSON.stringify({ name: "simple-app", dependencies: {} }));
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        (0, vitest_1.expect)(result.configs).toHaveLength(0);
    });
    (0, vitest_1.it)("includes Prisma evidence when detected", async () => {
        await (0, promises_1.mkdir)((0, node_path_1.join)(tempDir, "prisma"), { recursive: true });
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "prisma", "schema.prisma"), `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`);
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".env"), "DATABASE_URL=postgres://user:pw@ep-cool.neon.tech/mydb\n");
        const result = await (0, core_1.detectCloudServices)(tempDir, emptyStack);
        // Should detect Neon + Prisma evidence
        const neon = result.configs.find((c) => c.provider === "neon");
        (0, vitest_1.expect)(neon).toBeDefined();
        const prismaEvidence = result.evidence.find((e) => e.detectedAs === "cloud:prisma-migrations");
        (0, vitest_1.expect)(prismaEvidence).toBeDefined();
        (0, vitest_1.expect)(prismaEvidence.details).toContain("postgresql");
    });
});
//# sourceMappingURL=database-adapters.test.js.map