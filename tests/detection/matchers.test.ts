import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  parsePackageJson,
  parsePyprojectData,
  parseRequirementsTxt,
  parseDockerComposeData,
  parseFirebaseJson,
  parseWranglerToml,
  parseMiseData,
  detectVersionFiles,
  detectLanguagesBySourceFiles,
  detectMonorepoTools,
  detectPackageManagerFromLockfile,
} from "@opcom/core";

describe("parsePackageJson", () => {
  it("detects TypeScript and frameworks from dependencies", () => {
    const pkg = JSON.stringify({
      dependencies: { react: "^18.2.0", next: "^14.0.0" },
      devDependencies: { typescript: "^5.3.0", vitest: "^1.0.0", eslint: "^8.0.0" },
    });
    const result = parsePackageJson(pkg, "package.json");

    expect(result.languages).toEqual([
      { name: "typescript", version: "5.3.0", sourceFile: "package.json" },
    ]);
    expect(result.frameworks.map((f) => f.name)).toContain("React");
    expect(result.frameworks.map((f) => f.name)).toContain("Next.js");
    expect(result.testing[0]?.framework).toBe("vitest");
    expect(result.linting.map((l) => l.name)).toContain("eslint");
  });

  it("detects JavaScript when no TypeScript dep", () => {
    const pkg = JSON.stringify({ dependencies: { express: "^4.0.0" } });
    const result = parsePackageJson(pkg, "package.json");

    expect(result.languages[0].name).toBe("javascript");
    expect(result.frameworks[0].name).toBe("Express");
  });

  it("detects packageManager field", () => {
    const pkg = JSON.stringify({ packageManager: "pnpm@9.0.0" });
    const result = parsePackageJson(pkg, "package.json");

    expect(result.packageManagers).toEqual([{ name: "pnpm", sourceFile: "package.json" }]);
  });

  it("extracts Node version from engines field", () => {
    const pkg = JSON.stringify({ engines: { node: ">=18.0.0" } });
    const result = parsePackageJson(pkg, "package.json");

    expect(result.nodeVersion).toBe(">=18.0.0");
    expect(result.evidence.some((e) => e.detectedAs === "version:node")).toBe(true);
  });

  it("detects mocha and biome", () => {
    const pkg = JSON.stringify({
      devDependencies: { mocha: "^10.0.0", "@biomejs/biome": "^1.0.0" },
    });
    const result = parsePackageJson(pkg, "package.json");

    expect(result.testing[0]?.framework).toBe("mocha");
    expect(result.linting.map((l) => l.name)).toContain("biome");
  });
});

describe("parsePyprojectData", () => {
  it("detects Python, frameworks, testing, and linting", () => {
    const data = {
      project: {
        name: "myapp",
        "requires-python": ">=3.11",
        dependencies: ["fastapi>=0.100.0", "pydantic>=2.0.0"],
      },
      tool: {
        pytest: { ini_options: { testpaths: ["tests"] } },
        ruff: { "line-length": 120 },
        mypy: {},
      },
    };

    const result = parsePyprojectData(data, "pyproject.toml");

    expect(result.languages[0]).toEqual({ name: "python", version: "3.11", sourceFile: "pyproject.toml" });
    expect(result.frameworks.map((f) => f.name)).toContain("FastAPI");
    expect(result.frameworks.map((f) => f.name)).toContain("Pydantic");
    expect(result.testing[0]?.framework).toBe("pytest");
    expect(result.linting.map((l) => l.name)).toContain("ruff");
    expect(result.linting.map((l) => l.name)).toContain("mypy");
  });

  it("detects poetry from [tool.poetry] section", () => {
    const data = {
      project: { name: "myapp" },
      tool: { poetry: { name: "myapp", version: "0.1.0" } },
    };
    const result = parsePyprojectData(data, "pyproject.toml");

    expect(result.packageManagers.map((p) => p.name)).toContain("poetry");
  });

  it("detects uv from [tool.uv] section", () => {
    const data = {
      project: { name: "myapp" },
      tool: { uv: { "required-version": ">=0.5.0" } },
    };
    const result = parsePyprojectData(data, "pyproject.toml");

    expect(result.packageManagers.map((p) => p.name)).toContain("uv");
  });

  it("detects poetry from build-system backend", () => {
    const data = {
      "build-system": {
        "requires": ["poetry-core"],
        "build-backend": "poetry.core.masonry.api",
      },
      project: { name: "myapp" },
    };
    const result = parsePyprojectData(data, "pyproject.toml");

    expect(result.packageManagers.map((p) => p.name)).toContain("poetry");
  });

  it("detects hatch from build-system backend", () => {
    const data = {
      "build-system": {
        "requires": ["hatchling"],
        "build-backend": "hatchling.build",
      },
      project: { name: "myapp" },
    };
    const result = parsePyprojectData(data, "pyproject.toml");

    expect(result.packageManagers.map((p) => p.name)).toContain("hatch");
  });

  it("detects black linter", () => {
    const data = {
      project: { name: "myapp" },
      tool: { black: { "line-length": 88 } },
    };
    const result = parsePyprojectData(data, "pyproject.toml");

    expect(result.linting.map((l) => l.name)).toContain("black");
  });
});

describe("parseRequirementsTxt", () => {
  it("detects Python language and frameworks", () => {
    const content = `
# API deps
fastapi>=0.100.0
uvicorn>=0.20.0
pydantic>=2.0
# Dev deps
pytest>=7.0
`;
    const result = parseRequirementsTxt(content, "requirements.txt");

    expect(result.languages[0].name).toBe("python");
    expect(result.frameworks.map((f) => f.name)).toContain("FastAPI");
    expect(result.frameworks.map((f) => f.name)).toContain("Pydantic");
    expect(result.packageManagers[0].name).toBe("pip");
  });

  it("skips comments and empty lines", () => {
    const content = `
# This is a comment

flask==2.0.0
`;
    const result = parseRequirementsTxt(content, "requirements.txt");

    expect(result.frameworks.map((f) => f.name)).toContain("Flask");
    expect(result.frameworks).toHaveLength(1);
  });
});

describe("parseDockerComposeData", () => {
  it("extracts services and ports", () => {
    const data = {
      services: {
        api: { build: ".", ports: ["8000:8000"] },
        postgres: { image: "postgres:16", ports: ["5432:5432"] },
      },
    };

    const result = parseDockerComposeData(data, "docker-compose.yml");

    expect(result.infrastructure[0].name).toBe("docker");
    expect(result.services).toHaveLength(2);
    expect(result.services[0]).toEqual({ name: "api", port: 8000 });
    expect(result.services[1]).toEqual({ name: "postgres", port: 5432 });
  });
});

describe("parseFirebaseJson", () => {
  it("detects firebase infrastructure", () => {
    const result = parseFirebaseJson("{}", "firebase.json");
    expect(result.infrastructure[0].name).toBe("firebase");
  });
});

describe("parseWranglerToml", () => {
  it("detects cloudflare workers", () => {
    const result = parseWranglerToml("wrangler.toml");
    expect(result.infrastructure[0].name).toBe("cloudflare-workers");
  });
});

describe("parseMiseData", () => {
  it("extracts version managers and language versions", () => {
    const data = { tools: { python: "3.11", node: "20" } };
    const result = parseMiseData(data, ".mise.toml");

    expect(result.versionManagers[0].name).toBe("mise");
    expect(result.languages).toHaveLength(2);
    expect(result.languages.find((l) => l.name === "python")?.version).toBe("3.11");
    expect(result.languages.find((l) => l.name === "javascript")?.version).toBe("20");
  });

  it("detects rust from mise tools", () => {
    const data = { tools: { rust: "1.75.0" } };
    const result = parseMiseData(data, ".mise.toml");

    expect(result.languages.find((l) => l.name === "rust")?.version).toBe("1.75.0");
  });
});

describe("detectVersionFiles", () => {
  let tempDir: string;

  it("reads .python-version file", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-vf-"));
    await writeFile(join(tempDir, ".python-version"), "3.12.1\n");

    const results = await detectVersionFiles(tempDir);

    expect(results).toHaveLength(1);
    expect(results[0].language.name).toBe("python");
    expect(results[0].language.version).toBe("3.12.1");

    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads .nvmrc file", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-vf-"));
    await writeFile(join(tempDir, ".nvmrc"), "20\n");

    const results = await detectVersionFiles(tempDir);

    expect(results).toHaveLength(1);
    expect(results[0].language.name).toBe("javascript");
    expect(results[0].language.version).toBe("20");

    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads multiple version files", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-vf-"));
    await writeFile(join(tempDir, ".python-version"), "3.11\n");
    await writeFile(join(tempDir, ".node-version"), "18.17.0\n");
    await writeFile(join(tempDir, ".ruby-version"), "3.2.0\n");

    const results = await detectVersionFiles(tempDir);

    expect(results).toHaveLength(3);
    const langs = results.map((r) => r.language.name);
    expect(langs).toContain("python");
    expect(langs).toContain("javascript");
    expect(langs).toContain("ruby");

    await rm(tempDir, { recursive: true, force: true });
  });
});

describe("detectLanguagesBySourceFiles", () => {
  let tempDir: string;

  it("detects Python from .py files", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-glob-"));
    await writeFile(join(tempDir, "main.py"), "print('hello')");

    const result = await detectLanguagesBySourceFiles(tempDir);

    expect(result.languages.map((l) => l.name)).toContain("python");

    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects from files in subdirectories", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-glob-"));
    await mkdir(join(tempDir, "src"));
    await writeFile(join(tempDir, "src", "main.go"), "package main");

    const result = await detectLanguagesBySourceFiles(tempDir);

    expect(result.languages.map((l) => l.name)).toContain("go");

    await rm(tempDir, { recursive: true, force: true });
  });

  it("ignores node_modules", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-glob-"));
    await mkdir(join(tempDir, "node_modules"));
    await writeFile(join(tempDir, "node_modules", "lib.js"), "module.exports = {}");

    const result = await detectLanguagesBySourceFiles(tempDir);

    expect(result.languages).toHaveLength(0);

    await rm(tempDir, { recursive: true, force: true });
  });
});

describe("detectMonorepoTools", () => {
  let tempDir: string;

  it("detects turbo.json and nx.json", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-mono-"));
    await writeFile(join(tempDir, "turbo.json"), "{}");
    await writeFile(join(tempDir, "nx.json"), "{}");

    const results = detectMonorepoTools(tempDir);

    expect(results.map((r) => r.tool)).toContain("turborepo");
    expect(results.map((r) => r.tool)).toContain("nx");

    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects pnpm-workspace.yaml", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-mono-"));
    await writeFile(join(tempDir, "pnpm-workspace.yaml"), "packages:\n  - packages/*");

    const results = detectMonorepoTools(tempDir);

    expect(results.map((r) => r.tool)).toContain("pnpm-workspaces");

    await rm(tempDir, { recursive: true, force: true });
  });
});

describe("detectPackageManagerFromLockfile", () => {
  let tempDir: string;

  it("detects pdm.lock", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "opcom-lock-"));
    await writeFile(join(tempDir, "pdm.lock"), "");

    const result = detectPackageManagerFromLockfile(tempDir);

    expect(result?.name).toBe("pdm");

    await rm(tempDir, { recursive: true, force: true });
  });
});
