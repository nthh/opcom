#!/usr/bin/env node

/**
 * Bundle opcom for npm publish.
 *
 * Produces dist/npm/ with a single-file CLI + package.json.
 * Native addons (better-sqlite3) stay external as runtime deps.
 */

import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const outdir = resolve(root, "dist", "npm");

// Clean & create output dir
mkdirSync(outdir, { recursive: true });

// Read root package.json for version
const rootPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
const version = rootPkg.version || "0.1.0";

console.log(`Bundling opcom v${version}...`);

await build({
  entryPoints: [resolve(root, "packages/cli/src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: resolve(outdir, "cli.mjs"),
  // Source already has #!/usr/bin/env node shebang — esbuild preserves it
  banner: {
    js: [
      // Create require() shim for CJS deps bundled into ESM
      `import { createRequire as __bundleCreateRequire } from "node:module";`,
      `const require = __bundleCreateRequire(import.meta.url);`,
    ].join("\n"),
  },
  external: [
    "better-sqlite3",
  ],
  minify: false,
  sourcemap: false,
  treeShaking: true,
  logLevel: "info",
});

// Write publish package.json
const publishPkg = {
  name: "opcom",
  version,
  description: "Developer workspace manager — detect projects, manage tickets, orchestrate agents",
  type: "module",
  bin: {
    opcom: "./cli.mjs",
  },
  files: ["cli.mjs"],
  engines: {
    node: ">=18",
  },
  dependencies: {
    "better-sqlite3": "^11.7.0",
  },
  keywords: [
    "developer-tools",
    "workspace",
    "project-management",
    "cli",
    "agents",
    "devops",
  ],
  license: "MIT",
  repository: {
    type: "git",
    url: "https://github.com/nathanclevenger/opcom",
  },
  author: "Nathan Clevenger",
};

writeFileSync(resolve(outdir, "package.json"), JSON.stringify(publishPkg, null, 2) + "\n");

console.log(`\nBundled to ${outdir}/`);
console.log(`  cli.mjs — single-file CLI`);
console.log(`  package.json — publish manifest`);
console.log(`\nTo test: npx ${outdir}/`);
console.log(`To publish: cd ${outdir} && npm publish`);
