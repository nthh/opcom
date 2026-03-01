import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CloudServiceConfig,
  MigrationStatus,
  MigrateResult,
  StackInfo,
} from "@opcom/types";

const execFileAsync = promisify(execFile);

export interface PrismaOverlayConfig {
  schemaPath: string;
  provider: string;  // "postgresql", "sqlite", "mysql"
}

/**
 * Detect Prisma usage in a project.
 * Returns overlay config if prisma is found, null otherwise.
 */
export async function detectPrisma(
  projectPath: string,
  _stack: StackInfo,
): Promise<PrismaOverlayConfig | null> {
  // Check for prisma/schema.prisma
  const schemaPath = join(projectPath, "prisma", "schema.prisma");
  if (existsSync(schemaPath)) {
    try {
      const content = await readFile(schemaPath, "utf-8");
      const providerMatch = content.match(/provider\s*=\s*"([^"]+)"/);
      const provider = providerMatch?.[1] ?? "postgresql";
      return { schemaPath: "prisma/schema.prisma", provider };
    } catch {
      return { schemaPath: "prisma/schema.prisma", provider: "postgresql" };
    }
  }

  // Check package.json for prisma dependency
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const content = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps["prisma"] || allDeps["@prisma/client"]) {
        return { schemaPath: "prisma/schema.prisma", provider: "postgresql" };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Parse the output of `npx prisma migrate status`.
 *
 * Example output:
 *   Prisma schema loaded from prisma/schema.prisma
 *   ...
 *   47 migrations found in prisma/migrations
 *   47 of 47 migrations have been applied.
 *
 * Or with pending:
 *   47 migrations found in prisma/migrations
 *   45 of 47 migrations have been applied.
 *   Following 2 migrations have not yet been applied:
 *   20260228_add_user_prefs
 *   20260301_fix_schema
 */
export function parseMigrateStatus(output: string): MigrationStatus {
  const status: MigrationStatus = {
    tool: "prisma",
    applied: 0,
    pending: 0,
  };

  // Parse "X migrations found"
  const totalMatch = output.match(/(\d+)\s+migrations?\s+found/i);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;

  // Parse "X of Y migrations have been applied"
  const appliedMatch = output.match(/(\d+)\s+of\s+(\d+)\s+migrations?\s+have been applied/i);
  if (appliedMatch) {
    status.applied = parseInt(appliedMatch[1], 10);
    status.pending = parseInt(appliedMatch[2], 10) - status.applied;
  } else if (total > 0) {
    // If all applied, the output might say "Database schema is up to date"
    if (output.includes("up to date") || output.includes("already in sync")) {
      status.applied = total;
      status.pending = 0;
    }
  }

  // Parse pending migration names
  const pendingSection = output.match(/not yet been applied:\s*([\s\S]*)$/);
  if (pendingSection) {
    const names = pendingSection[1]
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("Prisma") && !l.startsWith("Status"));
    if (names.length > 0) {
      status.pending = names.length;
    }
  }

  // Parse last applied migration name
  const lastMigrationMatch = output.match(
    /(?:Last applied migration|latest migration):\s*(\S+)/i,
  );
  if (lastMigrationMatch) {
    status.lastMigrationName = lastMigrationMatch[1];
  }

  return status;
}

/**
 * Get Prisma migration status by running `npx prisma migrate status`.
 */
export async function getPrismaMigrationStatus(
  projectPath: string,
): Promise<MigrationStatus | null> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["prisma", "migrate", "status"],
      {
        cwd: projectPath,
        timeout: 30_000,
        env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "true" },
      },
    );
    // prisma migrate status may write to stderr too
    const output = stdout + "\n" + stderr;
    return parseMigrateStatus(output);
  } catch (err: unknown) {
    // prisma migrate status exits non-zero when there are pending migrations
    if (err && typeof err === "object" && "stdout" in err) {
      const output =
        ((err as { stdout?: string }).stdout ?? "") +
        "\n" +
        ((err as { stderr?: string }).stderr ?? "");
      if (output.includes("migration")) {
        return parseMigrateStatus(output);
      }
    }
    return null;
  }
}

/**
 * Run `npx prisma migrate deploy` to apply pending migrations.
 */
export async function runPrismaMigrate(
  projectPath: string,
): Promise<MigrateResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["prisma", "migrate", "deploy"],
      {
        cwd: projectPath,
        timeout: 60_000,
        env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "true" },
      },
    );
    const output = stdout + "\n" + stderr;

    // Parse applied migrations from output
    const applied: string[] = [];
    const applyMatches = output.matchAll(
      /Applying migration\s+`(\S+)`/g,
    );
    for (const m of applyMatches) {
      applied.push(m[1]);
    }

    // Check for remaining pending
    const status = parseMigrateStatus(output);

    return {
      applied,
      pending: status.pending > 0
        ? Array.from({ length: status.pending }, (_, i) => `pending-${i + 1}`)
        : [],
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Prisma migrate deploy failed";
    return { applied: [], pending: [], error: message };
  }
}

/**
 * Augment a CloudServiceConfig's DatabaseDetail with Prisma migration status.
 * This is an overlay — it adds migration info to an existing database adapter's output.
 */
export async function augmentWithPrisma(
  projectPath: string,
  config: CloudServiceConfig,
): Promise<MigrationStatus | null> {
  // Only augment database configs
  if (config.kind !== "database") return null;

  const prismaConfig = await detectPrisma(projectPath, {
    languages: [],
    frameworks: [],
    packageManagers: [],
    infrastructure: [],
    versionManagers: [],
  });

  if (!prismaConfig) return null;

  return getPrismaMigrationStatus(projectPath);
}
