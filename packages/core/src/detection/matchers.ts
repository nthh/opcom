import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  LanguageInfo,
  FrameworkInfo,
  PackageManagerInfo,
  InfrastructureInfo,
  VersionManagerInfo,
  ServiceDefinition,
  TestSuite,
  LintConfig,
  DetectionEvidence,
} from "@opcom/types";

// --- package.json ---

export interface PackageJsonResult {
  languages: LanguageInfo[];
  frameworks: FrameworkInfo[];
  packageManagers: PackageManagerInfo[];
  testing: TestSuite[];
  linting: LintConfig[];
  evidence: DetectionEvidence[];
  nodeVersion?: string;
}

const JS_FRAMEWORK_MAP: Record<string, string> = {
  next: "Next.js",
  react: "React",
  "react-native": "React Native",
  expo: "Expo",
  vue: "Vue",
  nuxt: "Nuxt",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  svelte: "Svelte",
  "@sveltejs/kit": "SvelteKit",
  angular: "Angular",
  "@angular/core": "Angular",
};

export function parsePackageJson(content: string, sourceFile: string): PackageJsonResult {
  const pkg = JSON.parse(content);
  const languages: LanguageInfo[] = [];
  const frameworks: FrameworkInfo[] = [];
  const packageManagers: PackageManagerInfo[] = [];
  const linting: LintConfig[] = [];
  const evidence: DetectionEvidence[] = [];

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  // Detect TypeScript vs JavaScript
  if (allDeps?.typescript) {
    languages.push({ name: "typescript", version: stripRange(allDeps.typescript), sourceFile });
  } else {
    languages.push({ name: "javascript", sourceFile });
  }

  // Extract Node version from engines field (like Google does)
  let nodeVersion: string | undefined;
  if (pkg.engines?.node) {
    nodeVersion = pkg.engines.node;
    evidence.push({ file: sourceFile, detectedAs: "version:node", details: `engines.node = "${nodeVersion}"` });
  }

  // Detect frameworks
  for (const [dep, frameworkName] of Object.entries(JS_FRAMEWORK_MAP)) {
    if (allDeps?.[dep]) {
      frameworks.push({ name: frameworkName, version: stripRange(allDeps[dep]), sourceFile });
      evidence.push({ file: sourceFile, detectedAs: `framework:${frameworkName}`, details: `dependency "${dep}"` });
    }
  }

  // Detect package manager from packageManager field
  if (pkg.packageManager) {
    const pm = pkg.packageManager.split("@")[0];
    packageManagers.push({ name: pm, sourceFile });
  }

  // Detect testing from devDeps
  const testing: TestSuite[] = [];
  if (allDeps?.vitest) {
    testing.push({ name: "vitest", framework: "vitest", command: "npx vitest run" });
    evidence.push({ file: sourceFile, detectedAs: "testing:vitest" });
  }
  if (allDeps?.jest) {
    testing.push({ name: "jest", framework: "jest", command: "npx jest" });
    evidence.push({ file: sourceFile, detectedAs: "testing:jest" });
  }
  if (allDeps?.mocha) {
    testing.push({ name: "mocha", framework: "mocha", command: "npx mocha" });
    evidence.push({ file: sourceFile, detectedAs: "testing:mocha" });
  }

  // Detect linting
  if (allDeps?.eslint) linting.push({ name: "eslint", sourceFile });
  if (allDeps?.prettier) linting.push({ name: "prettier", sourceFile });
  if (allDeps?.biome || allDeps?.["@biomejs/biome"]) linting.push({ name: "biome", sourceFile });

  evidence.push({ file: sourceFile, detectedAs: `language:${languages[0]?.name ?? "javascript"}` });

  return { languages, frameworks, packageManagers, testing, linting, evidence, nodeVersion };
}

// --- pyproject.toml ---

export interface PyprojectResult {
  languages: LanguageInfo[];
  frameworks: FrameworkInfo[];
  packageManagers: PackageManagerInfo[];
  testing: TestSuite[];
  linting: LintConfig[];
  evidence: DetectionEvidence[];
}

const PY_FRAMEWORK_MAP: Record<string, string> = {
  fastapi: "FastAPI",
  django: "Django",
  flask: "Flask",
  click: "Click",
  pydantic: "Pydantic",
  starlette: "Starlette",
  streamlit: "Streamlit",
  gradio: "Gradio",
  celery: "Celery",
};

export function parsePyprojectData(data: Record<string, unknown>, sourceFile: string): PyprojectResult {
  const languages: LanguageInfo[] = [];
  const frameworks: FrameworkInfo[] = [];
  const packageManagers: PackageManagerInfo[] = [];
  const linting: LintConfig[] = [];
  const evidence: DetectionEvidence[] = [];

  // Python language
  const project = data.project as Record<string, unknown> | undefined;
  const requiresPython = project?.["requires-python"] as string | undefined;
  languages.push({
    name: "python",
    version: requiresPython ? requiresPython.replace(/[><=!~]/g, "").trim() : undefined,
    sourceFile,
  });
  evidence.push({ file: sourceFile, detectedAs: "language:python" });

  // Extract dependencies
  const deps = (project?.dependencies as string[]) ?? [];
  const optDeps = project?.["optional-dependencies"] as Record<string, string[]> | undefined;
  const allDeps = [...deps, ...Object.values(optDeps ?? {}).flat()];
  const depNames = allDeps.map((d) => d.split(/[><=!~\s[\]]/)[0].toLowerCase());

  // Detect frameworks
  for (const [dep, frameworkName] of Object.entries(PY_FRAMEWORK_MAP)) {
    if (depNames.includes(dep)) {
      frameworks.push({ name: frameworkName, sourceFile });
      evidence.push({ file: sourceFile, detectedAs: `framework:${frameworkName}` });
    }
  }

  // Detect testing
  const testing: TestSuite[] = [];
  const tool = data.tool as Record<string, unknown> | undefined;
  const hasPytest = tool?.pytest || tool?.["pytest.ini_options"] || depNames.includes("pytest");
  if (hasPytest) {
    // Use "uv run pytest" when uv is detected, so tests work in worktrees
    // without a local virtualenv.
    const useUv = tool?.uv || packageManagers.some((p) => p.name === "uv");
    const cmd = useUv ? "uv run pytest" : "pytest";
    testing.push({ name: "pytest", framework: "pytest", command: cmd, paths: ["**/*.py", "pyproject.toml"], required: true });
    evidence.push({ file: sourceFile, detectedAs: "testing:pytest" });
  }

  // Detect linting
  if (tool?.ruff) {
    linting.push({ name: "ruff", sourceFile });
    evidence.push({ file: sourceFile, detectedAs: "linting:ruff" });
  }
  if (tool?.mypy) {
    linting.push({ name: "mypy", sourceFile });
    evidence.push({ file: sourceFile, detectedAs: "linting:mypy" });
  }
  if (tool?.black) {
    linting.push({ name: "black", sourceFile });
    evidence.push({ file: sourceFile, detectedAs: "linting:black" });
  }

  // Package manager detection from pyproject.toml sections (Google pattern)
  // [tool.poetry] → poetry, [tool.uv] → uv, [build-system] with poetry → poetry
  if (tool?.poetry) {
    packageManagers.push({ name: "poetry", sourceFile });
    evidence.push({ file: sourceFile, detectedAs: "package-manager:poetry", details: "[tool.poetry] section" });
  }
  if (tool?.uv) {
    packageManagers.push({ name: "uv", sourceFile });
    evidence.push({ file: sourceFile, detectedAs: "package-manager:uv", details: "[tool.uv] section" });
  }
  const buildSystem = data["build-system"] as Record<string, unknown> | undefined;
  if (buildSystem) {
    const buildBackend = buildSystem["build-backend"] as string | undefined;
    if (buildBackend?.includes("poetry")) {
      if (!packageManagers.some((p) => p.name === "poetry")) {
        packageManagers.push({ name: "poetry", sourceFile });
        evidence.push({ file: sourceFile, detectedAs: "package-manager:poetry", details: "build-backend" });
      }
    }
    if (buildBackend?.includes("hatchling") || buildBackend?.includes("hatch")) {
      packageManagers.push({ name: "hatch", sourceFile });
      evidence.push({ file: sourceFile, detectedAs: "package-manager:hatch", details: "build-backend" });
    }
  }

  return { languages, frameworks, packageManagers, testing, linting, evidence };
}

// --- requirements.txt ---

export interface RequirementsTxtResult {
  languages: LanguageInfo[];
  frameworks: FrameworkInfo[];
  packageManagers: PackageManagerInfo[];
  evidence: DetectionEvidence[];
}

export function parseRequirementsTxt(content: string, sourceFile: string): RequirementsTxtResult {
  const frameworks: FrameworkInfo[] = [];
  const evidence: DetectionEvidence[] = [];

  evidence.push({ file: sourceFile, detectedAs: "language:python" });

  // Parse each line for known frameworks
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const depNames = lines.map((l) => l.split(/[><=!~\s[\]]/)[0].toLowerCase());

  for (const [dep, frameworkName] of Object.entries(PY_FRAMEWORK_MAP)) {
    if (depNames.includes(dep)) {
      frameworks.push({ name: frameworkName, sourceFile });
      evidence.push({ file: sourceFile, detectedAs: `framework:${frameworkName}` });
    }
  }

  return {
    languages: [{ name: "python", sourceFile }],
    frameworks,
    packageManagers: [{ name: "pip", sourceFile }],
    evidence,
  };
}

// --- docker-compose.yml ---

interface DockerComposeResult {
  infrastructure: InfrastructureInfo[];
  services: ServiceDefinition[];
  evidence: DetectionEvidence[];
}

export function parseDockerComposeData(data: Record<string, unknown>, sourceFile: string): DockerComposeResult {
  const infrastructure: InfrastructureInfo[] = [{ name: "docker", sourceFile }];
  const services: ServiceDefinition[] = [];
  const evidence: DetectionEvidence[] = [{ file: sourceFile, detectedAs: "infrastructure:docker" }];

  const svcMap = (data.services ?? data) as Record<string, Record<string, unknown>> | undefined;
  if (svcMap && typeof svcMap === "object") {
    for (const [name, svc] of Object.entries(svcMap)) {
      if (name === "version" || name === "networks" || name === "volumes") continue;
      const ports = svc?.ports as string[] | undefined;
      let port: number | undefined;
      if (ports?.[0]) {
        const match = String(ports[0]).match(/(\d+):\d+/);
        if (match) port = parseInt(match[1], 10);
      }
      services.push({ name, port });
      evidence.push({ file: sourceFile, detectedAs: `service:${name}` });
    }
  }

  return { infrastructure, services, evidence };
}

// --- firebase.json ---

export function parseFirebaseJson(content: string, sourceFile: string): { infrastructure: InfrastructureInfo[]; evidence: DetectionEvidence[] } {
  JSON.parse(content); // validate
  return {
    infrastructure: [{ name: "firebase", sourceFile }],
    evidence: [{ file: sourceFile, detectedAs: "infrastructure:firebase" }],
  };
}

// --- wrangler.toml ---

export function parseWranglerToml(sourceFile: string): { infrastructure: InfrastructureInfo[]; evidence: DetectionEvidence[] } {
  return {
    infrastructure: [{ name: "cloudflare-workers", sourceFile }],
    evidence: [{ file: sourceFile, detectedAs: "infrastructure:cloudflare-workers" }],
  };
}

// --- .mise.toml ---

export function parseMiseData(data: Record<string, unknown>, sourceFile: string): {
  versionManagers: VersionManagerInfo[];
  languages: LanguageInfo[];
  evidence: DetectionEvidence[];
} {
  const versionManagers: VersionManagerInfo[] = [{ name: "mise", sourceFile }];
  const languages: LanguageInfo[] = [];
  const evidence: DetectionEvidence[] = [{ file: sourceFile, detectedAs: "version-manager:mise" }];

  const tools = data.tools as Record<string, unknown> | undefined;
  if (tools) {
    for (const [tool, version] of Object.entries(tools)) {
      const ver = typeof version === "string" ? version : Array.isArray(version) ? String(version[0]) : undefined;
      if (tool === "python" || tool === "node" || tool === "go" || tool === "ruby" || tool === "java" || tool === "rust") {
        const langName = tool === "node" ? "javascript" : tool;
        languages.push({ name: langName, version: ver, sourceFile });
        evidence.push({ file: sourceFile, detectedAs: `language:${tool}`, details: `version ${ver}` });
      }
    }
  }

  return { versionManagers, languages, evidence };
}

// --- Version files (.python-version, .nvmrc, .node-version, .ruby-version, .go-version) ---

export interface VersionFileResult {
  language: LanguageInfo;
  evidence: DetectionEvidence;
}

const VERSION_FILES: [string, string][] = [
  [".python-version", "python"],
  [".nvmrc", "javascript"],
  [".node-version", "javascript"],
  [".ruby-version", "ruby"],
  [".go-version", "go"],
  [".java-version", "java"],
  [".rust-toolchain.toml", "rust"],
];

export async function detectVersionFiles(projectPath: string): Promise<VersionFileResult[]> {
  const results: VersionFileResult[] = [];

  for (const [file, langName] of VERSION_FILES) {
    const filePath = join(projectPath, file);
    if (!existsSync(filePath)) continue;

    try {
      const content = await readFile(filePath, "utf-8");
      const version = content.trim().split("\n")[0].trim();
      if (version) {
        results.push({
          language: { name: langName, version, sourceFile: file },
          evidence: { file, detectedAs: `language:${langName}`, details: `version ${version}` },
        });
      }
    } catch {
      // Skip unreadable version files
    }
  }

  return results;
}

// --- Source file glob fallback (Google's Tier 3) ---

const SOURCE_GLOB_MAP: [string, string][] = [
  // Order matters: put less ambiguous languages first.
  // JS last because .js files appear in many non-Node projects (Google's pattern).
  [".go", "go"],
  [".rs", "rust"],
  [".rb", "ruby"],
  [".java", "java"],
  [".py", "python"],
  [".ts", "typescript"],
  [".js", "javascript"],
];

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv",
  "vendor", ".next", ".nuxt", "target", "coverage", ".tox", "egg-info",
]);

export async function detectLanguagesBySourceFiles(projectPath: string): Promise<{
  languages: LanguageInfo[];
  evidence: DetectionEvidence[];
}> {
  const languages: LanguageInfo[] = [];
  const evidence: DetectionEvidence[] = [];
  const found = new Set<string>();

  try {
    const entries = await readdir(projectPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        // Shallow scan: check top-level dirs for source files
        try {
          const subEntries = await readdir(join(projectPath, entry.name));
          for (const sub of subEntries) {
            checkFile(sub, found, languages, evidence);
          }
        } catch {
          // Skip unreadable dirs
        }
      } else if (entry.isFile()) {
        checkFile(entry.name, found, languages, evidence);
      }
    }
  } catch {
    // Skip unreadable project
  }

  return { languages, evidence };
}

function checkFile(fileName: string, found: Set<string>, languages: LanguageInfo[], evidence: DetectionEvidence[]): void {
  for (const [ext, langName] of SOURCE_GLOB_MAP) {
    if (fileName.endsWith(ext) && !found.has(langName)) {
      found.add(langName);
      languages.push({ name: langName, sourceFile: `*.${ext.slice(1)} (source glob)` });
      evidence.push({
        file: fileName,
        detectedAs: `language:${langName}`,
        details: "source file glob fallback",
      });
    }
  }
}

// --- Lockfile detection ---

export function detectPackageManagerFromLockfile(projectPath: string): PackageManagerInfo | null {
  const lockfiles: [string, string][] = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
    ["uv.lock", "uv"],
    ["poetry.lock", "poetry"],
    ["Pipfile.lock", "pipenv"],
    ["pdm.lock", "pdm"],
  ];

  for (const [file, name] of lockfiles) {
    if (existsSync(join(projectPath, file))) {
      return { name, sourceFile: file };
    }
  }
  return null;
}

// --- Monorepo tool detection ---

export interface MonorepoToolResult {
  tool: string;
  sourceFile: string;
  evidence: DetectionEvidence;
}

export function detectMonorepoTools(projectPath: string): MonorepoToolResult[] {
  const results: MonorepoToolResult[] = [];

  if (existsSync(join(projectPath, "turbo.json"))) {
    results.push({
      tool: "turborepo",
      sourceFile: "turbo.json",
      evidence: { file: "turbo.json", detectedAs: "monorepo-tool:turborepo" },
    });
  }
  if (existsSync(join(projectPath, "nx.json"))) {
    results.push({
      tool: "nx",
      sourceFile: "nx.json",
      evidence: { file: "nx.json", detectedAs: "monorepo-tool:nx" },
    });
  }
  if (existsSync(join(projectPath, "lerna.json"))) {
    results.push({
      tool: "lerna",
      sourceFile: "lerna.json",
      evidence: { file: "lerna.json", detectedAs: "monorepo-tool:lerna" },
    });
  }
  if (existsSync(join(projectPath, "pnpm-workspace.yaml"))) {
    results.push({
      tool: "pnpm-workspaces",
      sourceFile: "pnpm-workspace.yaml",
      evidence: { file: "pnpm-workspace.yaml", detectedAs: "monorepo-tool:pnpm-workspaces" },
    });
  }

  return results;
}

// --- Helpers ---

function stripRange(version: string): string {
  return version.replace(/^[\^~>=<]+/, "");
}
