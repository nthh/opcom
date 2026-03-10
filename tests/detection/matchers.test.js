"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_path_1 = require("node:path");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const core_1 = require("@opcom/core");
(0, vitest_1.describe)("parsePackageJson", () => {
    (0, vitest_1.it)("detects TypeScript and frameworks from dependencies", () => {
        const pkg = JSON.stringify({
            dependencies: { react: "^18.2.0", next: "^14.0.0" },
            devDependencies: { typescript: "^5.3.0", vitest: "^1.0.0", eslint: "^8.0.0" },
        });
        const result = (0, core_1.parsePackageJson)(pkg, "package.json");
        (0, vitest_1.expect)(result.languages).toEqual([
            { name: "typescript", version: "5.3.0", sourceFile: "package.json" },
        ]);
        (0, vitest_1.expect)(result.frameworks.map((f) => f.name)).toContain("React");
        (0, vitest_1.expect)(result.frameworks.map((f) => f.name)).toContain("Next.js");
        (0, vitest_1.expect)(result.testing?.framework).toBe("vitest");
        (0, vitest_1.expect)(result.linting.map((l) => l.name)).toContain("eslint");
    });
    (0, vitest_1.it)("detects JavaScript when no TypeScript dep", () => {
        const pkg = JSON.stringify({ dependencies: { express: "^4.0.0" } });
        const result = (0, core_1.parsePackageJson)(pkg, "package.json");
        (0, vitest_1.expect)(result.languages[0].name).toBe("javascript");
        (0, vitest_1.expect)(result.frameworks[0].name).toBe("Express");
    });
    (0, vitest_1.it)("detects packageManager field", () => {
        const pkg = JSON.stringify({ packageManager: "pnpm@9.0.0" });
        const result = (0, core_1.parsePackageJson)(pkg, "package.json");
        (0, vitest_1.expect)(result.packageManagers).toEqual([{ name: "pnpm", sourceFile: "package.json" }]);
    });
    (0, vitest_1.it)("extracts Node version from engines field", () => {
        const pkg = JSON.stringify({ engines: { node: ">=18.0.0" } });
        const result = (0, core_1.parsePackageJson)(pkg, "package.json");
        (0, vitest_1.expect)(result.nodeVersion).toBe(">=18.0.0");
        (0, vitest_1.expect)(result.evidence.some((e) => e.detectedAs === "version:node")).toBe(true);
    });
    (0, vitest_1.it)("detects mocha and biome", () => {
        const pkg = JSON.stringify({
            devDependencies: { mocha: "^10.0.0", "@biomejs/biome": "^1.0.0" },
        });
        const result = (0, core_1.parsePackageJson)(pkg, "package.json");
        (0, vitest_1.expect)(result.testing?.framework).toBe("mocha");
        (0, vitest_1.expect)(result.linting.map((l) => l.name)).toContain("biome");
    });
});
(0, vitest_1.describe)("parsePyprojectData", () => {
    (0, vitest_1.it)("detects Python, frameworks, testing, and linting", () => {
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
        const result = (0, core_1.parsePyprojectData)(data, "pyproject.toml");
        (0, vitest_1.expect)(result.languages[0]).toEqual({ name: "python", version: "3.11", sourceFile: "pyproject.toml" });
        (0, vitest_1.expect)(result.frameworks.map((f) => f.name)).toContain("FastAPI");
        (0, vitest_1.expect)(result.frameworks.map((f) => f.name)).toContain("Pydantic");
        (0, vitest_1.expect)(result.testing?.framework).toBe("pytest");
        (0, vitest_1.expect)(result.linting.map((l) => l.name)).toContain("ruff");
        (0, vitest_1.expect)(result.linting.map((l) => l.name)).toContain("mypy");
    });
    (0, vitest_1.it)("detects poetry from [tool.poetry] section", () => {
        const data = {
            project: { name: "myapp" },
            tool: { poetry: { name: "myapp", version: "0.1.0" } },
        };
        const result = (0, core_1.parsePyprojectData)(data, "pyproject.toml");
        (0, vitest_1.expect)(result.packageManagers.map((p) => p.name)).toContain("poetry");
    });
    (0, vitest_1.it)("detects uv from [tool.uv] section", () => {
        const data = {
            project: { name: "myapp" },
            tool: { uv: { "required-version": ">=0.5.0" } },
        };
        const result = (0, core_1.parsePyprojectData)(data, "pyproject.toml");
        (0, vitest_1.expect)(result.packageManagers.map((p) => p.name)).toContain("uv");
    });
    (0, vitest_1.it)("detects poetry from build-system backend", () => {
        const data = {
            "build-system": {
                "requires": ["poetry-core"],
                "build-backend": "poetry.core.masonry.api",
            },
            project: { name: "myapp" },
        };
        const result = (0, core_1.parsePyprojectData)(data, "pyproject.toml");
        (0, vitest_1.expect)(result.packageManagers.map((p) => p.name)).toContain("poetry");
    });
    (0, vitest_1.it)("detects hatch from build-system backend", () => {
        const data = {
            "build-system": {
                "requires": ["hatchling"],
                "build-backend": "hatchling.build",
            },
            project: { name: "myapp" },
        };
        const result = (0, core_1.parsePyprojectData)(data, "pyproject.toml");
        (0, vitest_1.expect)(result.packageManagers.map((p) => p.name)).toContain("hatch");
    });
    (0, vitest_1.it)("detects black linter", () => {
        const data = {
            project: { name: "myapp" },
            tool: { black: { "line-length": 88 } },
        };
        const result = (0, core_1.parsePyprojectData)(data, "pyproject.toml");
        (0, vitest_1.expect)(result.linting.map((l) => l.name)).toContain("black");
    });
});
(0, vitest_1.describe)("parseRequirementsTxt", () => {
    (0, vitest_1.it)("detects Python language and frameworks", () => {
        const content = `
# API deps
fastapi>=0.100.0
uvicorn>=0.20.0
pydantic>=2.0
# Dev deps
pytest>=7.0
`;
        const result = (0, core_1.parseRequirementsTxt)(content, "requirements.txt");
        (0, vitest_1.expect)(result.languages[0].name).toBe("python");
        (0, vitest_1.expect)(result.frameworks.map((f) => f.name)).toContain("FastAPI");
        (0, vitest_1.expect)(result.frameworks.map((f) => f.name)).toContain("Pydantic");
        (0, vitest_1.expect)(result.packageManagers[0].name).toBe("pip");
    });
    (0, vitest_1.it)("skips comments and empty lines", () => {
        const content = `
# This is a comment

flask==2.0.0
`;
        const result = (0, core_1.parseRequirementsTxt)(content, "requirements.txt");
        (0, vitest_1.expect)(result.frameworks.map((f) => f.name)).toContain("Flask");
        (0, vitest_1.expect)(result.frameworks).toHaveLength(1);
    });
});
(0, vitest_1.describe)("parseDockerComposeData", () => {
    (0, vitest_1.it)("extracts services and ports", () => {
        const data = {
            services: {
                api: { build: ".", ports: ["8000:8000"] },
                postgres: { image: "postgres:16", ports: ["5432:5432"] },
            },
        };
        const result = (0, core_1.parseDockerComposeData)(data, "docker-compose.yml");
        (0, vitest_1.expect)(result.infrastructure[0].name).toBe("docker");
        (0, vitest_1.expect)(result.services).toHaveLength(2);
        (0, vitest_1.expect)(result.services[0]).toEqual({ name: "api", port: 8000 });
        (0, vitest_1.expect)(result.services[1]).toEqual({ name: "postgres", port: 5432 });
    });
});
(0, vitest_1.describe)("parseFirebaseJson", () => {
    (0, vitest_1.it)("detects firebase infrastructure", () => {
        const result = (0, core_1.parseFirebaseJson)("{}", "firebase.json");
        (0, vitest_1.expect)(result.infrastructure[0].name).toBe("firebase");
    });
});
(0, vitest_1.describe)("parseWranglerToml", () => {
    (0, vitest_1.it)("detects cloudflare workers", () => {
        const result = (0, core_1.parseWranglerToml)("wrangler.toml");
        (0, vitest_1.expect)(result.infrastructure[0].name).toBe("cloudflare-workers");
    });
});
(0, vitest_1.describe)("parseMiseData", () => {
    (0, vitest_1.it)("extracts version managers and language versions", () => {
        const data = { tools: { python: "3.11", node: "20" } };
        const result = (0, core_1.parseMiseData)(data, ".mise.toml");
        (0, vitest_1.expect)(result.versionManagers[0].name).toBe("mise");
        (0, vitest_1.expect)(result.languages).toHaveLength(2);
        (0, vitest_1.expect)(result.languages.find((l) => l.name === "python")?.version).toBe("3.11");
        (0, vitest_1.expect)(result.languages.find((l) => l.name === "javascript")?.version).toBe("20");
    });
    (0, vitest_1.it)("detects rust from mise tools", () => {
        const data = { tools: { rust: "1.75.0" } };
        const result = (0, core_1.parseMiseData)(data, ".mise.toml");
        (0, vitest_1.expect)(result.languages.find((l) => l.name === "rust")?.version).toBe("1.75.0");
    });
});
(0, vitest_1.describe)("detectVersionFiles", () => {
    let tempDir;
    (0, vitest_1.it)("reads .python-version file", async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-vf-"));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".python-version"), "3.12.1\n");
        const results = await (0, core_1.detectVersionFiles)(tempDir);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].language.name).toBe("python");
        (0, vitest_1.expect)(results[0].language.version).toBe("3.12.1");
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("reads .nvmrc file", async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-vf-"));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".nvmrc"), "20\n");
        const results = await (0, core_1.detectVersionFiles)(tempDir);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].language.name).toBe("javascript");
        (0, vitest_1.expect)(results[0].language.version).toBe("20");
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("reads multiple version files", async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-vf-"));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".python-version"), "3.11\n");
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".node-version"), "18.17.0\n");
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, ".ruby-version"), "3.2.0\n");
        const results = await (0, core_1.detectVersionFiles)(tempDir);
        (0, vitest_1.expect)(results).toHaveLength(3);
        const langs = results.map((r) => r.language.name);
        (0, vitest_1.expect)(langs).toContain("python");
        (0, vitest_1.expect)(langs).toContain("javascript");
        (0, vitest_1.expect)(langs).toContain("ruby");
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
});
(0, vitest_1.describe)("detectLanguagesBySourceFiles", () => {
    let tempDir;
    (0, vitest_1.it)("detects Python from .py files", async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-glob-"));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "main.py"), "print('hello')");
        const result = await (0, core_1.detectLanguagesBySourceFiles)(tempDir);
        (0, vitest_1.expect)(result.languages.map((l) => l.name)).toContain("python");
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects from files in subdirectories", async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-glob-"));
        await (0, promises_1.mkdir)((0, node_path_1.join)(tempDir, "src"));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "src", "main.go"), "package main");
        const result = await (0, core_1.detectLanguagesBySourceFiles)(tempDir);
        (0, vitest_1.expect)(result.languages.map((l) => l.name)).toContain("go");
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("ignores node_modules", async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-glob-"));
        await (0, promises_1.mkdir)((0, node_path_1.join)(tempDir, "node_modules"));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "node_modules", "lib.js"), "module.exports = {}");
        const result = await (0, core_1.detectLanguagesBySourceFiles)(tempDir);
        (0, vitest_1.expect)(result.languages).toHaveLength(0);
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
});
(0, vitest_1.describe)("detectMonorepoTools", () => {
    let tempDir;
    (0, vitest_1.it)("detects turbo.json and nx.json", async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-mono-"));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "turbo.json"), "{}");
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "nx.json"), "{}");
        const results = (0, core_1.detectMonorepoTools)(tempDir);
        (0, vitest_1.expect)(results.map((r) => r.tool)).toContain("turborepo");
        (0, vitest_1.expect)(results.map((r) => r.tool)).toContain("nx");
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)("detects pnpm-workspace.yaml", async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-mono-"));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "pnpm-workspace.yaml"), "packages:\n  - packages/*");
        const results = (0, core_1.detectMonorepoTools)(tempDir);
        (0, vitest_1.expect)(results.map((r) => r.tool)).toContain("pnpm-workspaces");
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
});
(0, vitest_1.describe)("detectPackageManagerFromLockfile", () => {
    let tempDir;
    (0, vitest_1.it)("detects pdm.lock", async () => {
        tempDir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "opcom-lock-"));
        await (0, promises_1.writeFile)((0, node_path_1.join)(tempDir, "pdm.lock"), "");
        const result = (0, core_1.detectPackageManagerFromLockfile)(tempDir);
        (0, vitest_1.expect)(result?.name).toBe("pdm");
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
});
//# sourceMappingURL=matchers.test.js.map