#!/usr/bin/env node

/**
 * Release opcom: test → bump version → bundle → publish → commit + tag → push.
 *
 * Publish happens BEFORE git commit so a failed publish doesn't leave
 * a dangling version bump in git history.
 *
 * Usage:
 *   npm run release            # patch bump (0.1.5 → 0.1.6)
 *   npm run release -- minor   # minor bump (0.1.5 → 0.2.0)
 *   npm run release -- major   # major bump (0.1.5 → 1.0.0)
 *   npm run release -- --dry   # show what would happen, don't execute
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const bump = args.find((a) => ["patch", "minor", "major"].includes(a)) ?? "patch";

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  if (dry) return "";
  return execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
}

// --- Pre-checks ---
const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8" }).trim();
if (status && !dry) {
  console.error("\n  Working tree is dirty. Commit or stash changes first.\n");
  process.exit(1);
}

// Check npm auth
try {
  execSync("npm whoami", { cwd: root, stdio: "pipe" });
} catch {
  console.error("\n  Not logged into npm. Run: npm login\n");
  process.exit(1);
}

// --- Read current version ---
const pkgPath = resolve(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const current = pkg.version;

// --- Bump version ---
const parts = current.split(".").map(Number);
if (bump === "major") { parts[0]++; parts[1] = 0; parts[2] = 0; }
else if (bump === "minor") { parts[1]++; parts[2] = 0; }
else { parts[2]++; }
const next = parts.join(".");

console.log(`\n  opcom ${current} → ${next} (${bump})\n`);

if (dry) {
  console.log("  --dry mode: showing steps without executing\n");
}

// --- 1. Tests ---
console.log("  [1/6] Running tests...");
run("npx vitest run --reporter=dot 2>&1 | tail -5", { stdio: "pipe" });

// --- 2. Bump version in package.json ---
console.log("  [2/6] Bumping version...");
if (!dry) {
  pkg.version = next;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

// --- 3. Bundle ---
console.log("  [3/6] Bundling...");
run("npm run bundle");

// --- 4. Publish (before git commit — failed publish shouldn't leave a dangling version bump) ---
console.log("  [4/6] Publishing to npm...");
try {
  run("npm publish", { cwd: resolve(root, "dist", "npm") });
} catch (err) {
  // Revert version bump on publish failure
  console.error("\n  Publish failed. Reverting version bump...");
  if (!dry) {
    pkg.version = current;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }
  process.exit(1);
}

// --- 5. Git commit + tag ---
console.log("  [5/6] Committing...");
run(`git add package.json`);
run(`git commit -m "${next}"`);
run(`git tag v${next}`);

// --- 6. Push ---
console.log("  [6/6] Pushing...");
run("git push && git push --tags");

console.log(`\n  Released opcom v${next}\n`);
