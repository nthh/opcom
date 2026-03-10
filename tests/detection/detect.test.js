"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_path_1 = require("node:path");
const core_1 = require("@opcom/core");
const FIXTURE_PATH = (0, node_path_1.join)(import.meta.dirname, "../fixtures/mock-project");
(0, vitest_1.describe)("detectProject — fixture", () => {
    (0, vitest_1.it)("detects full stack from mock project", async () => {
        const result = await (0, core_1.detectProject)(FIXTURE_PATH);
        (0, vitest_1.expect)(result.name).toBe("mock-project");
        (0, vitest_1.expect)(result.confidence).toBe("high");
        // Languages
        const langNames = result.stack.languages.map((l) => l.name);
        (0, vitest_1.expect)(langNames).toContain("typescript");
        (0, vitest_1.expect)(langNames).toContain("python");
        // Frameworks
        const fwNames = result.stack.frameworks.map((f) => f.name);
        (0, vitest_1.expect)(fwNames).toContain("Next.js");
        (0, vitest_1.expect)(fwNames).toContain("React");
        (0, vitest_1.expect)(fwNames).toContain("FastAPI");
        // Infrastructure
        (0, vitest_1.expect)(result.stack.infrastructure.map((i) => i.name)).toContain("docker");
        // Version managers
        (0, vitest_1.expect)(result.stack.versionManagers.map((v) => v.name)).toContain("mise");
        // Testing — vitest from package.json or pytest from pyproject.toml
        (0, vitest_1.expect)(result.testing).not.toBeNull();
        // Linting
        const lintNames = result.linting.map((l) => l.name);
        (0, vitest_1.expect)(lintNames).toContain("eslint");
        (0, vitest_1.expect)(lintNames).toContain("ruff");
        // Docker services
        (0, vitest_1.expect)(result.services.length).toBeGreaterThanOrEqual(2);
        // Tickets
        (0, vitest_1.expect)(result.workSystem).not.toBeNull();
        (0, vitest_1.expect)(result.workSystem.type).toBe("tickets-dir");
        // Evidence
        (0, vitest_1.expect)(result.evidence.length).toBeGreaterThan(5);
    });
});
(0, vitest_1.describe)("detectProject — real projects", () => {
    const realProjects = [
        { path: (0, node_path_1.join)(process.env.HOME ?? "", "projects/mtnmap"), name: "mtnmap" },
        { path: (0, node_path_1.join)(process.env.HOME ?? "", "projects/folia"), name: "folia" },
        { path: (0, node_path_1.join)(process.env.HOME ?? "", "projects/conversi"), name: "conversi" },
        { path: (0, node_path_1.join)(process.env.HOME ?? "", "projects/costli"), name: "costli" },
    ];
    for (const { path, name } of realProjects) {
        (0, vitest_1.it)(`detects ${name}`, async () => {
            const result = await (0, core_1.detectProject)(path);
            (0, vitest_1.expect)(result.name).toBe(name);
            (0, vitest_1.expect)(result.evidence.length).toBeGreaterThan(0);
            // Just verify it runs without error — specific assertions per-project below
        });
    }
    (0, vitest_1.it)("mtnmap: Expo + Firebase + Cloudflare Workers", async () => {
        const result = await (0, core_1.detectProject)(realProjects[0].path);
        const infraNames = result.stack.infrastructure.map((i) => i.name);
        (0, vitest_1.expect)(infraNames).toContain("firebase");
        (0, vitest_1.expect)(result.workSystem).not.toBeNull();
    });
    (0, vitest_1.it)("folia: Python + Docker with tickets (trk)", async () => {
        const result = await (0, core_1.detectProject)(realProjects[1].path);
        const langNames = result.stack.languages.map((l) => l.name);
        (0, vitest_1.expect)(langNames).toContain("python");
        (0, vitest_1.expect)(result.stack.infrastructure.map((i) => i.name)).toContain("docker");
        (0, vitest_1.expect)(result.workSystem?.type).toBe("trk");
    });
    (0, vitest_1.it)("conversi: FastAPI + Docker", async () => {
        const result = await (0, core_1.detectProject)(realProjects[2].path);
        (0, vitest_1.expect)(result.stack.frameworks.map((f) => f.name)).toContain("FastAPI");
        (0, vitest_1.expect)(result.stack.infrastructure.map((i) => i.name)).toContain("docker");
    });
    (0, vitest_1.it)("costli: minimal project (no manifests, source glob fallback)", async () => {
        const result = await (0, core_1.detectProject)(realProjects[3].path);
        // With source file glob fallback, costli may detect languages from *.py etc.
        // Confidence is "medium" (language found) rather than "low" (nothing found)
        (0, vitest_1.expect)(["low", "medium"]).toContain(result.confidence);
        (0, vitest_1.expect)(result.stack.frameworks).toHaveLength(0);
    });
});
//# sourceMappingURL=detect.test.js.map