import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import type { DetectionResult, DetectionEvidence, ProjectDocs, TestingConfig, LintConfig } from "@opcom/types";
import {
  parsePackageJson,
  parsePyprojectData,
  parseRequirementsTxt,
  parseDockerComposeData,
  parseFirebaseJson,
  parseWranglerToml,
  parseMiseData,
  detectPackageManagerFromLockfile,
  detectVersionFiles,
  detectLanguagesBySourceFiles,
  detectMonorepoTools,
} from "./matchers.js";
import { mergeStacks } from "./stack.js";
import { detectTicketSystem } from "./tickets.js";
import { detectSubProjects } from "./services.js";
import { detectGit } from "./git.js";
import { detectCloudServices } from "../cloud/detect.js";

export async function detectProject(projectPath: string): Promise<DetectionResult> {
  const name = basename(projectPath);
  const evidence: DetectionEvidence[] = [];
  const partialStacks: Parameters<typeof mergeStacks> = [];
  let testing: TestingConfig | null = null;
  const linting: LintConfig[] = [];
  let allServices: DetectionResult["services"] = [];
  let docs: ProjectDocs = {};

  // ===================================================================
  // TIER 1: Manifest files — high-confidence, deep parsing
  // ===================================================================

  // --- package.json ---
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const content = await readFile(pkgPath, "utf-8");
      const result = parsePackageJson(content, "package.json");
      partialStacks.push({
        languages: result.languages,
        frameworks: result.frameworks,
        packageManagers: result.packageManagers,
      });
      if (result.testing) testing = result.testing;
      linting.push(...result.linting);
      evidence.push(...result.evidence);
    } catch {
      evidence.push({ file: "package.json", detectedAs: "error", details: "Failed to parse" });
    }
  }

  // --- pyproject.toml ---
  const pyprojectPath = join(projectPath, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    try {
      const content = await readFile(pyprojectPath, "utf-8");
      const data = parseToml(content) as Record<string, unknown>;
      const result = parsePyprojectData(data, "pyproject.toml");
      partialStacks.push({
        languages: result.languages,
        frameworks: result.frameworks,
        packageManagers: result.packageManagers,
      });
      if (result.testing) testing = result.testing;
      linting.push(...result.linting);
      evidence.push(...result.evidence);
    } catch {
      evidence.push({ file: "pyproject.toml", detectedAs: "error", details: "Failed to parse" });
    }
  }

  // --- requirements.txt (Heroku/Google pattern — extremely common Python marker) ---
  const reqTxtPath = join(projectPath, "requirements.txt");
  if (existsSync(reqTxtPath)) {
    try {
      const content = await readFile(reqTxtPath, "utf-8");
      const result = parseRequirementsTxt(content, "requirements.txt");
      partialStacks.push({
        languages: result.languages,
        frameworks: result.frameworks,
        packageManagers: result.packageManagers,
      });
      evidence.push(...result.evidence);
    } catch {
      evidence.push({ file: "requirements.txt", detectedAs: "error", details: "Failed to parse" });
    }
  }

  // --- setup.py / setup.cfg (legacy Python markers) ---
  for (const legacyFile of ["setup.py", "setup.cfg"]) {
    if (existsSync(join(projectPath, legacyFile))) {
      partialStacks.push({
        languages: [{ name: "python", sourceFile: legacyFile }],
      });
      evidence.push({ file: legacyFile, detectedAs: "language:python", details: "legacy packaging" });
      break; // One is enough
    }
  }

  // --- Pipfile (Python marker without lockfile) ---
  if (existsSync(join(projectPath, "Pipfile"))) {
    partialStacks.push({
      languages: [{ name: "python", sourceFile: "Pipfile" }],
      packageManagers: [{ name: "pipenv", sourceFile: "Pipfile" }],
    });
    evidence.push({ file: "Pipfile", detectedAs: "language:python" });
    evidence.push({ file: "Pipfile", detectedAs: "package-manager:pipenv" });
  }

  // --- go.mod ---
  if (existsSync(join(projectPath, "go.mod"))) {
    try {
      const content = await readFile(join(projectPath, "go.mod"), "utf-8");
      const versionMatch = content.match(/^go\s+(\d+\.\d+(?:\.\d+)?)/m);
      partialStacks.push({
        languages: [{ name: "go", version: versionMatch?.[1], sourceFile: "go.mod" }],
      });
      evidence.push({ file: "go.mod", detectedAs: "language:go", details: versionMatch ? `go ${versionMatch[1]}` : undefined });
    } catch {
      partialStacks.push({ languages: [{ name: "go", sourceFile: "go.mod" }] });
      evidence.push({ file: "go.mod", detectedAs: "language:go" });
    }
  }

  // --- Cargo.toml (Rust) ---
  if (existsSync(join(projectPath, "Cargo.toml"))) {
    partialStacks.push({
      languages: [{ name: "rust", sourceFile: "Cargo.toml" }],
    });
    evidence.push({ file: "Cargo.toml", detectedAs: "language:rust" });
  }

  // --- Gemfile (Ruby) ---
  for (const rubyFile of ["Gemfile", "gems.rb"]) {
    if (existsSync(join(projectPath, rubyFile))) {
      partialStacks.push({
        languages: [{ name: "ruby", sourceFile: rubyFile }],
      });
      evidence.push({ file: rubyFile, detectedAs: "language:ruby" });
      break;
    }
  }

  // --- docker-compose.yml ---
  for (const dcFile of ["docker-compose.yml", "docker-compose.yaml"]) {
    const dcPath = join(projectPath, dcFile);
    if (existsSync(dcPath)) {
      try {
        const content = await readFile(dcPath, "utf-8");
        const data = parseYaml(content) as Record<string, unknown>;
        const result = parseDockerComposeData(data, dcFile);
        partialStacks.push({ infrastructure: result.infrastructure });
        allServices.push(...result.services);
        evidence.push(...result.evidence);
      } catch {
        evidence.push({ file: dcFile, detectedAs: "error", details: "Failed to parse" });
      }
      break;
    }
  }

  // --- Dockerfile (infrastructure signal even without compose) ---
  for (const dockerFile of ["Dockerfile", "dockerfile", "Containerfile"]) {
    if (existsSync(join(projectPath, dockerFile))) {
      partialStacks.push({ infrastructure: [{ name: "docker", sourceFile: dockerFile }] });
      evidence.push({ file: dockerFile, detectedAs: "infrastructure:docker" });
      break;
    }
  }

  // --- Kubernetes manifests ---
  // Check top-level k8s/ dirs, nested k8s/ dirs, and CI workflows using kubectl
  const k8sDetected = await detectKubernetes(projectPath);
  if (k8sDetected) {
    partialStacks.push({ infrastructure: [{ name: "kubernetes", sourceFile: k8sDetected }] });
    evidence.push({ file: k8sDetected, detectedAs: "infrastructure:kubernetes" });
  }

  // --- firebase.json ---
  const firebasePath = join(projectPath, "firebase.json");
  if (existsSync(firebasePath)) {
    try {
      const content = await readFile(firebasePath, "utf-8");
      const result = parseFirebaseJson(content, "firebase.json");
      partialStacks.push({ infrastructure: result.infrastructure });
      evidence.push(...result.evidence);
    } catch {
      evidence.push({ file: "firebase.json", detectedAs: "error", details: "Failed to parse" });
    }
  }

  // --- wrangler.toml (also check workers/ subdirs) ---
  const wranglerLocations = [
    join(projectPath, "wrangler.toml"),
    join(projectPath, "wrangler.jsonc"),
  ];
  if (existsSync(join(projectPath, "workers"))) {
    try {
      const entries = await readdir(join(projectPath, "workers"), { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          wranglerLocations.push(join(projectPath, "workers", e.name, "wrangler.toml"));
          wranglerLocations.push(join(projectPath, "workers", e.name, "wrangler.jsonc"));
        }
      }
    } catch {}
  }
  for (const wp of wranglerLocations) {
    if (existsSync(wp)) {
      const relPath = wp.replace(projectPath + "/", "");
      const result = parseWranglerToml(relPath);
      partialStacks.push({ infrastructure: result.infrastructure });
      evidence.push(...result.evidence);
      break;
    }
  }

  // --- Framework config files (standalone, not just from deps — Google pattern) ---
  // Next.js config
  for (const nextFile of ["next.config.js", "next.config.mjs", "next.config.ts"]) {
    if (existsSync(join(projectPath, nextFile))) {
      evidence.push({ file: nextFile, detectedAs: "framework:Next.js", details: "config file" });
      break;
    }
  }
  // Angular config
  if (existsSync(join(projectPath, "angular.json"))) {
    evidence.push({ file: "angular.json", detectedAs: "framework:Angular", details: "config file" });
  }

  // ===================================================================
  // TIER 2: Version files & config — medium-confidence
  // ===================================================================

  // --- .mise.toml ---
  const misePath = join(projectPath, ".mise.toml");
  if (existsSync(misePath)) {
    try {
      const content = await readFile(misePath, "utf-8");
      const data = parseToml(content) as Record<string, unknown>;
      const result = parseMiseData(data, ".mise.toml");
      partialStacks.push({
        languages: result.languages,
        versionManagers: result.versionManagers,
      });
      evidence.push(...result.evidence);
    } catch {
      evidence.push({ file: ".mise.toml", detectedAs: "error", details: "Failed to parse" });
    }
  }

  // --- Version files (.python-version, .nvmrc, .node-version, etc.) ---
  const versionFileResults = await detectVersionFiles(projectPath);
  for (const vf of versionFileResults) {
    partialStacks.push({ languages: [vf.language] });
    evidence.push(vf.evidence);
  }

  // --- Lockfile-based package manager ---
  const lockfilePm = detectPackageManagerFromLockfile(projectPath);
  if (lockfilePm) {
    partialStacks.push({ packageManagers: [lockfilePm] });
    evidence.push({ file: lockfilePm.sourceFile, detectedAs: `package-manager:${lockfilePm.name}` });
  }

  // --- Monorepo tools (turbo.json, nx.json, lerna.json, pnpm-workspace.yaml) ---
  const monorepoTools = detectMonorepoTools(projectPath);
  for (const mt of monorepoTools) {
    evidence.push(mt.evidence);
  }

  // --- Vitest config (standalone check) ---
  for (const vitestFile of ["vitest.config.ts", "vitest.config.js", "vitest.config.mts"]) {
    if (existsSync(join(projectPath, vitestFile))) {
      if (!testing) testing = { framework: "vitest", command: "npx vitest run" };
      evidence.push({ file: vitestFile, detectedAs: "testing:vitest" });
      break;
    }
  }

  // --- ESLint config (standalone check) ---
  for (const eslintFile of ["eslint.config.js", "eslint.config.mjs", "eslint.config.ts", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs"]) {
    if (existsSync(join(projectPath, eslintFile))) {
      if (!linting.some((l) => l.name === "eslint")) {
        linting.push({ name: "eslint", sourceFile: eslintFile });
      }
      evidence.push({ file: eslintFile, detectedAs: "linting:eslint" });
      break;
    }
  }

  // --- Prettier config (standalone check) ---
  for (const prettierFile of [".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js", "prettier.config.mjs"]) {
    if (existsSync(join(projectPath, prettierFile))) {
      if (!linting.some((l) => l.name === "prettier")) {
        linting.push({ name: "prettier", sourceFile: prettierFile });
      }
      evidence.push({ file: prettierFile, detectedAs: "linting:prettier" });
      break;
    }
  }

  // --- Biome config (standalone check) ---
  if (existsSync(join(projectPath, "biome.json")) || existsSync(join(projectPath, "biome.jsonc"))) {
    const biomeFile = existsSync(join(projectPath, "biome.json")) ? "biome.json" : "biome.jsonc";
    if (!linting.some((l) => l.name === "biome")) {
      linting.push({ name: "biome", sourceFile: biomeFile });
    }
    evidence.push({ file: biomeFile, detectedAs: "linting:biome" });
  }

  // --- Docs detection ---
  // Agent config (instructions for coding agents)
  for (const agentFile of ["AGENTS.md", "CLAUDE.md", "CONVENTIONS.md", ".cursorrules", ".github/copilot-instructions.md"]) {
    if (existsSync(join(projectPath, agentFile))) {
      docs.agentConfig = agentFile;
      evidence.push({ file: agentFile, detectedAs: "docs:agent-config" });
      break;
    }
  }

  // README
  if (existsSync(join(projectPath, "README.md"))) docs.readme = "README.md";

  // Specs directory
  for (const specDir of ["docs/spec", "docs/specs", "specs", "spec"]) {
    if (existsSync(join(projectPath, specDir))) {
      docs.specsDir = specDir;
      evidence.push({ file: specDir, detectedAs: "docs:specs" });
      break;
    }
  }

  // ADRs (Architecture Decision Records)
  for (const adrDir of ["docs/decisions", "docs/adr", "docs/adrs", "adr", "decisions"]) {
    if (existsSync(join(projectPath, adrDir))) {
      docs.decisionsDir = adrDir;
      evidence.push({ file: adrDir, detectedAs: "docs:adrs" });
      break;
    }
  }

  // Vision doc
  for (const visionFile of ["docs/VISION.md", "VISION.md", "docs/vision.md"]) {
    if (existsSync(join(projectPath, visionFile))) {
      docs.vision = visionFile;
      evidence.push({ file: visionFile, detectedAs: "docs:vision" });
      break;
    }
  }

  // Architecture doc
  for (const archFile of ["docs/ARCHITECTURE.md", "ARCHITECTURE.md", "docs/architecture.md"]) {
    if (existsSync(join(projectPath, archFile))) {
      docs.architecture = archFile;
      evidence.push({ file: archFile, detectedAs: "docs:architecture" });
      break;
    }
  }

  // Contributing guide
  if (existsSync(join(projectPath, "CONTRIBUTING.md"))) {
    docs.contributing = "CONTRIBUTING.md";
  }

  // Changelog
  for (const changelogFile of ["CHANGELOG.md", "CHANGES.md", "HISTORY.md"]) {
    if (existsSync(join(projectPath, changelogFile))) {
      docs.changelog = changelogFile;
      break;
    }
  }

  // Runbooks
  for (const runbookDir of ["docs/runbooks", "runbooks"]) {
    if (existsSync(join(projectPath, runbookDir))) {
      docs.runbooksDir = runbookDir;
      evidence.push({ file: runbookDir, detectedAs: "docs:runbooks" });
      break;
    }
  }

  // Codeowners
  for (const ownersFile of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
    if (existsSync(join(projectPath, ownersFile))) {
      docs.codeowners = ownersFile;
      break;
    }
  }

  // --- Parallel detections ---
  const [git, ticketResult, subProjectResult] = await Promise.all([
    detectGit(projectPath),
    detectTicketSystem(projectPath),
    detectSubProjects(projectPath),
  ]);

  if (ticketResult) evidence.push(...ticketResult.evidence);
  if (subProjectResult) evidence.push(...subProjectResult.evidence);

  // ===================================================================
  // TIER 3: Source file glob fallback (Google pattern)
  // Only runs if no languages detected from manifests/configs above.
  // ===================================================================

  const stack = mergeStacks(...partialStacks);

  if (stack.languages.length === 0) {
    const globResult = await detectLanguagesBySourceFiles(projectPath);
    for (const lang of globResult.languages) {
      stack.languages.push(lang);
    }
    evidence.push(...globResult.evidence);
  }

  // ===================================================================
  // TIER 4: Cloud service detection (additive)
  // Scans for cloud database configs, storage, serverless, etc.
  // ===================================================================

  const cloudResult = await detectCloudServices(projectPath, stack);
  evidence.push(...cloudResult.evidence);

  // --- Determine confidence ---
  let confidence: DetectionResult["confidence"] = "low";
  if (stack.languages.length > 0 && (stack.frameworks.length > 0 || stack.infrastructure.length > 0)) {
    confidence = "high";
  } else if (stack.languages.length > 0) {
    confidence = "medium";
  }

  return {
    path: projectPath,
    name,
    confidence,
    stack,
    git,
    workSystem: ticketResult?.workSystem ?? null,
    docs,
    services: allServices,
    testing,
    linting,
    subProjects: subProjectResult.subProjects,
    cloudServices: cloudResult.configs,
    evidence,
  };
}

/**
 * Detect Kubernetes usage by checking:
 * 1. Top-level k8s/ or kubernetes/ directories
 * 2. Nested k8s/ directories (e.g. experiments/remote-dev/k8s/)
 * 3. CI workflows that use kubectl
 */
async function detectKubernetes(projectPath: string): Promise<string | null> {
  // Top-level directories
  if (existsSync(join(projectPath, "k8s"))) return "k8s/";
  if (existsSync(join(projectPath, "kubernetes"))) return "kubernetes/";

  // CI workflows using kubectl
  const workflowDir = join(projectPath, ".github", "workflows");
  if (existsSync(workflowDir)) {
    try {
      const files = await readdir(workflowDir);
      for (const f of files) {
        if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
        const content = await readFile(join(workflowDir, f), "utf-8");
        if (content.includes("kubectl") || content.includes("setup-kubectl")) {
          return `.github/workflows/${f}`;
        }
      }
    } catch {
      // Skip on read errors
    }
  }

  return null;
}
