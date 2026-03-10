"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const context_graph_1 = require("@opcom/context-graph");
let contextDir;
let projectDir;
(0, vitest_1.beforeEach)(() => {
    contextDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "cg-testgen-ctx-"));
    projectDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "cg-testgen-proj-"));
});
(0, vitest_1.afterEach)(() => {
    (0, node_fs_1.rmSync)(contextDir, { recursive: true, force: true });
    (0, node_fs_1.rmSync)(projectDir, { recursive: true, force: true });
});
// --- Helpers ---
function makeTriageResult(overrides = {}) {
    return {
        signalId: "spec_no_tests:spec:auth",
        signalType: "spec_no_tests",
        verdict: "actionable",
        action: "write_test",
        priority: "P1",
        reasoning: "Auth logic needs tests",
        testHints: {
            testType: "unit",
            behaviors: ["verify login", "reject invalid password"],
            targetPath: "tests/auth.test.ts",
            framework: "vitest",
        },
        ...overrides,
    };
}
function makeE2eTriageResult(overrides = {}) {
    return makeTriageResult({
        signalId: "ui_spec_no_e2e:spec:dashboard",
        signalType: "ui_spec_no_e2e",
        testHints: {
            testType: "e2e",
            behaviors: ["sidebar toggle", "panel visibility"],
            targetPath: "e2e/dashboard.spec.ts",
            framework: "playwright",
            userActions: ["click sidebar toggle", "verify sidebar visible"],
        },
        ...overrides,
    });
}
function makeApiTriageResult(overrides = {}) {
    return makeTriageResult({
        signalId: "api_spec_no_test:spec:users-api",
        signalType: "api_spec_no_test",
        testHints: {
            testType: "api",
            behaviors: ["create user", "reject duplicate email"],
            targetPath: "tests/api/users.test.ts",
            framework: "vitest",
            apiContract: {
                method: "POST",
                path: "/api/users",
                expectedStatuses: [201, 409, 422],
            },
        },
        ...overrides,
    });
}
function mockLLM(response) {
    const calls = [];
    return {
        calls,
        async complete(prompt, model) {
            calls.push({ prompt, model });
            if (response !== undefined)
                return response;
            return `// File: tests/auth.test.ts
// Spec: spec:auth
import { describe, it, expect } from 'vitest';

describe('Auth', () => {
  it('should verify login', () => {
    // Spec: spec:auth
    expect(true).toBe(true);
  });

  it('should reject invalid password', () => {
    // Spec: spec:auth
    expect(false).toBe(false);
  });
});`;
        },
    };
}
// --- parseGeneratedTests ---
(0, vitest_1.describe)("parseGeneratedTests", () => {
    (0, vitest_1.it)("extracts file path from comment", () => {
        const response = `// File: tests/auth.test.ts
import { describe, it, expect } from 'vitest';
describe('Auth', () => { it('works', () => {}); });`;
        const tests = (0, context_graph_1.parseGeneratedTests)(response);
        (0, vitest_1.expect)(tests).toHaveLength(1);
        (0, vitest_1.expect)(tests[0].path).toBe("tests/auth.test.ts");
    });
    (0, vitest_1.it)("extracts spec reference from comment", () => {
        const response = `// File: tests/auth.test.ts
// Spec: AUTH.md#2.1
import { describe, it, expect } from 'vitest';`;
        const tests = (0, context_graph_1.parseGeneratedTests)(response);
        (0, vitest_1.expect)(tests[0].specRef).toBe("AUTH.md#2.1");
    });
    (0, vitest_1.it)("detects vitest framework", () => {
        const response = `// File: tests/auth.test.ts
import { describe, it, expect } from 'vitest';
describe('Auth', () => {});`;
        const tests = (0, context_graph_1.parseGeneratedTests)(response);
        (0, vitest_1.expect)(tests[0].framework).toBe("vitest");
    });
    (0, vitest_1.it)("detects playwright framework", () => {
        const response = `// File: e2e/dashboard.spec.ts
import { test, expect } from '@playwright/test';
test('loads', async ({ page }) => {});`;
        const tests = (0, context_graph_1.parseGeneratedTests)(response);
        (0, vitest_1.expect)(tests[0].framework).toBe("playwright");
        (0, vitest_1.expect)(tests[0].testType).toBe("e2e");
    });
    (0, vitest_1.it)("detects pytest framework", () => {
        const response = `# File: tests/test_auth.py
import pytest

class TestAuth:
    @pytest.mark.asyncio
    async def test_login(self):
        pass`;
        const tests = (0, context_graph_1.parseGeneratedTests)(response);
        (0, vitest_1.expect)(tests[0].framework).toBe("pytest");
    });
    (0, vitest_1.it)("strips markdown code fences", () => {
        const response = "```typescript\n// File: tests/auth.test.ts\nimport { describe } from 'vitest';\n```";
        const tests = (0, context_graph_1.parseGeneratedTests)(response);
        (0, vitest_1.expect)(tests).toHaveLength(1);
        (0, vitest_1.expect)(tests[0].path).toBe("tests/auth.test.ts");
    });
    (0, vitest_1.it)("returns empty array for empty response", () => {
        const tests = (0, context_graph_1.parseGeneratedTests)("");
        (0, vitest_1.expect)(tests).toEqual([]);
    });
    (0, vitest_1.it)("handles response with no file path", () => {
        const response = `import { describe, it, expect } from 'vitest';
describe('Auth', () => {});`;
        const tests = (0, context_graph_1.parseGeneratedTests)(response);
        (0, vitest_1.expect)(tests).toHaveLength(1);
        (0, vitest_1.expect)(tests[0].path).toBe("");
    });
});
// --- detectTestFramework ---
(0, vitest_1.describe)("detectTestFramework", () => {
    (0, vitest_1.it)("detects vitest from vitest.config.ts", () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "vitest.config.ts"), "export default {}");
        (0, vitest_1.expect)((0, context_graph_1.detectTestFramework)(projectDir)).toBe("vitest");
    });
    (0, vitest_1.it)("detects vitest from vite.config.ts", () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "vite.config.ts"), "export default {}");
        (0, vitest_1.expect)((0, context_graph_1.detectTestFramework)(projectDir)).toBe("vitest");
    });
    (0, vitest_1.it)("detects jest from jest.config.ts", () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "jest.config.ts"), "module.exports = {}");
        (0, vitest_1.expect)((0, context_graph_1.detectTestFramework)(projectDir)).toBe("jest");
    });
    (0, vitest_1.it)("detects pytest from pyproject.toml", () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "pyproject.toml"), "[tool.pytest]");
        (0, vitest_1.expect)((0, context_graph_1.detectTestFramework)(projectDir)).toBe("pytest");
    });
    (0, vitest_1.it)("detects vitest from package.json scripts.test", () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "package.json"), JSON.stringify({
            scripts: { test: "vitest run" },
        }));
        (0, vitest_1.expect)((0, context_graph_1.detectTestFramework)(projectDir)).toBe("vitest");
    });
    (0, vitest_1.it)("detects jest from package.json scripts.test", () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "package.json"), JSON.stringify({
            scripts: { test: "jest --passWithNoTests" },
        }));
        (0, vitest_1.expect)((0, context_graph_1.detectTestFramework)(projectDir)).toBe("jest");
    });
    (0, vitest_1.it)("defaults to vitest for JS/TS projects with package.json", () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "package.json"), JSON.stringify({}));
        (0, vitest_1.expect)((0, context_graph_1.detectTestFramework)(projectDir)).toBe("vitest");
    });
    (0, vitest_1.it)("defaults to vitest when no markers found", () => {
        (0, vitest_1.expect)((0, context_graph_1.detectTestFramework)(projectDir)).toBe("vitest");
    });
});
// --- detectPlaywrightConfig ---
(0, vitest_1.describe)("detectPlaywrightConfig", () => {
    (0, vitest_1.it)("returns true when playwright.config.ts exists", () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "playwright.config.ts"), "export default {}");
        (0, vitest_1.expect)((0, context_graph_1.detectPlaywrightConfig)(projectDir)).toBe(true);
    });
    (0, vitest_1.it)("returns false when no config exists", () => {
        (0, vitest_1.expect)((0, context_graph_1.detectPlaywrightConfig)(projectDir)).toBe(false);
    });
});
// --- detectApiFramework ---
(0, vitest_1.describe)("detectApiFramework", () => {
    (0, vitest_1.it)("detects FastAPI", () => {
        (0, vitest_1.expect)((0, context_graph_1.detectApiFramework)("from fastapi import FastAPI")).toBe("fastapi");
    });
    (0, vitest_1.it)("detects Flask", () => {
        (0, vitest_1.expect)((0, context_graph_1.detectApiFramework)("from flask import Flask")).toBe("flask");
    });
    (0, vitest_1.it)("detects Express", () => {
        (0, vitest_1.expect)((0, context_graph_1.detectApiFramework)('import express from "express"; const app = express()')).toBe("express");
    });
    (0, vitest_1.it)("detects Hono", () => {
        (0, vitest_1.expect)((0, context_graph_1.detectApiFramework)("import { Hono } from 'hono'; const app = new Hono()")).toBe("hono");
    });
    (0, vitest_1.it)("detects Elysia", () => {
        (0, vitest_1.expect)((0, context_graph_1.detectApiFramework)("new Elysia()")).toBe("elysia");
    });
    (0, vitest_1.it)("returns unknown for unrecognized code", () => {
        (0, vitest_1.expect)((0, context_graph_1.detectApiFramework)("function handler() { return 'hello'; }")).toBe("unknown");
    });
});
// --- loadTestPreferences ---
(0, vitest_1.describe)("loadTestPreferences", () => {
    (0, vitest_1.it)("loads preferences from .context/test-preferences.md", async () => {
        const contextPath = (0, node_path_1.join)(projectDir, ".context");
        (0, node_fs_1.mkdirSync)(contextPath, { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(contextPath, "test-preferences.md"), `# Test Preferences

## Framework
vitest with typescript

## Conventions
- Use describe blocks for grouping
- Always mock external APIs
- Use beforeEach for setup

## Examples

### Good test
\`\`\`typescript
it('should work', () => { expect(true).toBe(true); });
\`\`\`
`);
        const prefs = await (0, context_graph_1.loadTestPreferences)(projectDir);
        (0, vitest_1.expect)(prefs.raw).toContain("vitest with typescript");
        (0, vitest_1.expect)(prefs.framework).toBe("vitest with typescript");
        (0, vitest_1.expect)(prefs.conventions).toHaveLength(3);
        (0, vitest_1.expect)(prefs.conventions[0]).toBe("Use describe blocks for grouping");
        (0, vitest_1.expect)(prefs.examples).toContain("Good test");
    });
    (0, vitest_1.it)("returns empty preferences when no file exists", async () => {
        const prefs = await (0, context_graph_1.loadTestPreferences)(projectDir);
        (0, vitest_1.expect)(prefs.raw).toBe("");
        (0, vitest_1.expect)(prefs.conventions).toEqual([]);
        (0, vitest_1.expect)(prefs.examples).toBe("");
    });
    (0, vitest_1.it)("falls back to project root test-preferences.md", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "test-preferences.md"), `# Test Preferences

## Framework
jest

## Conventions
- Use test() not it()
`);
        const prefs = await (0, context_graph_1.loadTestPreferences)(projectDir);
        (0, vitest_1.expect)(prefs.framework).toBe("jest");
        (0, vitest_1.expect)(prefs.conventions).toHaveLength(1);
    });
});
// --- UnitTestGenerator ---
(0, vitest_1.describe)("UnitTestGenerator", () => {
    const generator = new context_graph_1.UnitTestGenerator();
    (0, vitest_1.it)("canGenerate returns true for actionable unit test signals", () => {
        (0, vitest_1.expect)(generator.canGenerate(makeTriageResult())).toBe(true);
    });
    (0, vitest_1.it)("canGenerate returns true for integration test signals", () => {
        (0, vitest_1.expect)(generator.canGenerate(makeTriageResult({
            testHints: { ...makeTriageResult().testHints, testType: "integration" },
        }))).toBe(true);
    });
    (0, vitest_1.it)("canGenerate returns false for e2e signals", () => {
        (0, vitest_1.expect)(generator.canGenerate(makeE2eTriageResult())).toBe(false);
    });
    (0, vitest_1.it)("canGenerate returns false for non-actionable signals", () => {
        (0, vitest_1.expect)(generator.canGenerate(makeTriageResult({ verdict: "expected" }))).toBe(false);
    });
    (0, vitest_1.it)("canGenerate returns false for non-write_test actions", () => {
        (0, vitest_1.expect)(generator.canGenerate(makeTriageResult({ action: "update_spec" }))).toBe(false);
    });
    (0, vitest_1.it)("builds context from graph", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-unit-ctx", contextDir);
        // Set up graph with spec and implementing file
        db.upsertNode({ id: "spec:auth", type: "spec", path: "docs/spec/auth.md", title: "Authentication" });
        const signal = makeTriageResult();
        const context = await generator.buildContext(signal, db, projectDir);
        (0, vitest_1.expect)(context).toBeDefined();
        (0, vitest_1.expect)(context.extra.framework).toBe("vitest");
        (0, vitest_1.expect)(context.extra.targetPath).toBe("tests/auth.test.ts");
        db.close();
    });
    (0, vitest_1.it)("builds prompt with signal details", () => {
        const signal = makeTriageResult();
        const context = {
            specContent: "Users authenticate with email and password",
            sourceCode: "export function login() { }",
            existingTests: "it('tests something', () => {})",
            preferences: "Use vitest",
            extra: { framework: "vitest", targetPath: "tests/auth.test.ts" },
        };
        const prompt = generator.buildPrompt(signal, context);
        (0, vitest_1.expect)(prompt).toContain("vitest");
        (0, vitest_1.expect)(prompt).toContain("TypeScript");
        (0, vitest_1.expect)(prompt).toContain("Users authenticate with email and password");
        (0, vitest_1.expect)(prompt).toContain("export function login()");
        (0, vitest_1.expect)(prompt).toContain("tests something");
        (0, vitest_1.expect)(prompt).toContain("verify login");
        (0, vitest_1.expect)(prompt).toContain("reject invalid password");
        (0, vitest_1.expect)(prompt).toContain("// File: tests/auth.test.ts");
    });
    (0, vitest_1.it)("builds prompt for pytest", () => {
        const signal = makeTriageResult({
            testHints: {
                ...makeTriageResult().testHints,
                framework: "pytest",
            },
        });
        const context = {
            specContent: "spec",
            sourceCode: "code",
            existingTests: "",
            preferences: "",
            extra: { framework: "pytest", targetPath: "tests/test_auth.py" },
        };
        const prompt = generator.buildPrompt(signal, context);
        (0, vitest_1.expect)(prompt).toContain("pytest");
        (0, vitest_1.expect)(prompt).toContain("Python");
    });
});
// --- PlaywrightGenerator ---
(0, vitest_1.describe)("PlaywrightGenerator", () => {
    const generator = new context_graph_1.PlaywrightGenerator();
    (0, vitest_1.it)("canGenerate returns true for e2e signals", () => {
        (0, vitest_1.expect)(generator.canGenerate(makeE2eTriageResult())).toBe(true);
    });
    (0, vitest_1.it)("canGenerate returns false for unit test signals", () => {
        (0, vitest_1.expect)(generator.canGenerate(makeTriageResult())).toBe(false);
    });
    (0, vitest_1.it)("canGenerate returns false for api signals", () => {
        (0, vitest_1.expect)(generator.canGenerate(makeApiTriageResult())).toBe(false);
    });
    (0, vitest_1.it)("builds prompt with user actions", () => {
        const signal = makeE2eTriageResult();
        const context = {
            specContent: "Users can toggle the sidebar",
            sourceCode: "<button onClick={toggleSidebar}>Toggle</button>",
            existingTests: "",
            preferences: "",
            extra: {
                framework: "playwright",
                targetPath: "e2e/dashboard.spec.ts",
                appUrl: "http://localhost:3000",
                selectors: "data-testid preferred",
                userActions: "click sidebar toggle\n- verify sidebar visible",
            },
        };
        const prompt = generator.buildPrompt(signal, context);
        (0, vitest_1.expect)(prompt).toContain("Playwright");
        (0, vitest_1.expect)(prompt).toContain("Users can toggle the sidebar");
        (0, vitest_1.expect)(prompt).toContain("http://localhost:3000");
        (0, vitest_1.expect)(prompt).toContain("data-testid");
        (0, vitest_1.expect)(prompt).toContain("click sidebar toggle");
        (0, vitest_1.expect)(prompt).toContain("test.describe");
        (0, vitest_1.expect)(prompt).toContain("test.step");
    });
    (0, vitest_1.it)("extracts baseURL from playwright config", async () => {
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "playwright.config.ts"), `
import { defineConfig } from '@playwright/test';
export default defineConfig({
  use: { baseURL: 'http://localhost:5173' },
});
`);
        const db = new context_graph_1.GraphDatabase("testgen-pw-ctx", contextDir);
        const signal = makeE2eTriageResult();
        const context = await generator.buildContext(signal, db, projectDir);
        (0, vitest_1.expect)(context.extra.appUrl).toBe("http://localhost:5173");
        db.close();
    });
    (0, vitest_1.it)("detects selector convention from existing tests", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-pw-sel", contextDir);
        // Create test node with getByTestId patterns
        db.upsertNode({
            id: "test:e2e-dashboard",
            type: "test",
            path: "e2e/existing.spec.ts",
        });
        db.upsertNode({ id: "spec:dashboard", type: "spec" });
        db.upsertEdge({ source: "test:e2e-dashboard", target: "spec:dashboard", relation: "asserts" });
        // Write a test file with getByTestId patterns
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "e2e"), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "e2e/existing.spec.ts"), `
import { test, expect } from '@playwright/test';
test('sidebar', async ({ page }) => {
  await page.getByTestId('sidebar-toggle').click();
  await page.getByTestId('sidebar-panel').isVisible();
  await page.getByRole('button', { name: 'Close' }).click();
});
`);
        const signal = makeE2eTriageResult();
        const context = await generator.buildContext(signal, db, projectDir);
        (0, vitest_1.expect)(context.extra.selectors).toContain("testid");
        db.close();
    });
});
// --- ApiTestGenerator ---
(0, vitest_1.describe)("ApiTestGenerator", () => {
    const generator = new context_graph_1.ApiTestGenerator();
    (0, vitest_1.it)("canGenerate returns true for api signals", () => {
        (0, vitest_1.expect)(generator.canGenerate(makeApiTriageResult())).toBe(true);
    });
    (0, vitest_1.it)("canGenerate returns false for unit signals", () => {
        (0, vitest_1.expect)(generator.canGenerate(makeTriageResult())).toBe(false);
    });
    (0, vitest_1.it)("canGenerate returns false for e2e signals", () => {
        (0, vitest_1.expect)(generator.canGenerate(makeE2eTriageResult())).toBe(false);
    });
    (0, vitest_1.it)("builds prompt with API contract", () => {
        const signal = makeApiTriageResult();
        const context = {
            specContent: "POST /api/users creates a user",
            sourceCode: 'app.post("/api/users", handler)',
            existingTests: "",
            preferences: "",
            extra: {
                framework: "vitest",
                targetPath: "tests/api/users.test.ts",
                apiFramework: "express",
                apiContract: "POST /api/users → [201, 409, 422]",
                method: "POST",
                path: "/api/users",
                expectedStatuses: "201, 409, 422",
            },
        };
        const prompt = generator.buildPrompt(signal, context);
        (0, vitest_1.expect)(prompt).toContain("express");
        (0, vitest_1.expect)(prompt).toContain("supertest(app)");
        (0, vitest_1.expect)(prompt).toContain("POST /api/users");
        (0, vitest_1.expect)(prompt).toContain("201, 409, 422");
        (0, vitest_1.expect)(prompt).toContain("create user");
        (0, vitest_1.expect)(prompt).toContain("reject duplicate email");
    });
    (0, vitest_1.it)("builds prompt with hono test client", () => {
        const signal = makeApiTriageResult();
        const context = {
            specContent: "API spec",
            sourceCode: "",
            existingTests: "",
            preferences: "",
            extra: {
                framework: "vitest",
                targetPath: "tests/api.test.ts",
                apiFramework: "hono",
            },
        };
        const prompt = generator.buildPrompt(signal, context);
        (0, vitest_1.expect)(prompt).toContain("hono");
        (0, vitest_1.expect)(prompt).toContain("app.request()");
    });
    (0, vitest_1.it)("builds prompt with fastapi test client", () => {
        const signal = makeApiTriageResult();
        const context = {
            specContent: "API spec",
            sourceCode: "",
            existingTests: "",
            preferences: "",
            extra: {
                framework: "pytest",
                targetPath: "tests/test_api.py",
                apiFramework: "fastapi",
            },
        };
        const prompt = generator.buildPrompt(signal, context);
        (0, vitest_1.expect)(prompt).toContain("fastapi");
        (0, vitest_1.expect)(prompt).toContain("httpx.AsyncClient");
    });
    (0, vitest_1.it)("detects API framework from source code in context", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-api-fw", contextDir);
        // Set up graph with a file node containing Express code
        db.upsertNode({
            id: "file:src/routes/users.ts",
            type: "file",
            path: "src/routes/users.ts",
        });
        // Write the route file
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "src/routes"), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/routes/users.ts"), `
import express from "express";
const router = express.Router();
router.post("/api/users", async (req, res) => {
  res.status(201).json({ id: "1", email: req.body.email });
});
export default router;
`);
        const signal = makeApiTriageResult({
            signalId: "api_spec_no_test:file:src/routes/users.ts",
        });
        const context = await generator.buildContext(signal, db, projectDir);
        (0, vitest_1.expect)(context.extra.apiFramework).toBe("express");
        db.close();
    });
});
// --- TestGenerationEngine ---
(0, vitest_1.describe)("TestGenerationEngine", () => {
    (0, vitest_1.it)("plans generation for actionable signals", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-plan", contextDir);
        const llm = mockLLM();
        const signals = [
            makeTriageResult(),
            makeE2eTriageResult(),
            makeApiTriageResult(),
        ];
        const engine = new context_graph_1.TestGenerationEngine(db, llm, projectDir);
        const plans = await engine.plan(signals);
        (0, vitest_1.expect)(plans).toHaveLength(3);
        (0, vitest_1.expect)(plans[0].generator.name).toBe("unit");
        (0, vitest_1.expect)(plans[1].generator.name).toBe("playwright");
        (0, vitest_1.expect)(plans[2].generator.name).toBe("api");
        db.close();
    });
    (0, vitest_1.it)("skips non-actionable signals in plan", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-skip-plan", contextDir);
        const llm = mockLLM();
        const signals = [
            makeTriageResult({ verdict: "expected" }),
            makeTriageResult({ action: "update_spec" }),
            makeTriageResult(), // This one is actionable
        ];
        const engine = new context_graph_1.TestGenerationEngine(db, llm, projectDir);
        const plans = await engine.plan(signals);
        (0, vitest_1.expect)(plans).toHaveLength(1);
        (0, vitest_1.expect)(plans[0].signal.signalId).toBe("spec_no_tests:spec:auth");
        db.close();
    });
    (0, vitest_1.it)("respects maxSignals option", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-max", contextDir);
        const llm = mockLLM();
        const signals = Array.from({ length: 20 }, (_, i) => makeTriageResult({ signalId: `spec_no_tests:spec:s${i}` }));
        const engine = new context_graph_1.TestGenerationEngine(db, llm, projectDir, { maxSignals: 3 });
        const plans = await engine.plan(signals);
        (0, vitest_1.expect)(plans).toHaveLength(3);
        db.close();
    });
    (0, vitest_1.it)("generates tests via LLM", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-generate", contextDir);
        const llm = mockLLM();
        const signals = [makeTriageResult()];
        const engine = new context_graph_1.TestGenerationEngine(db, llm, projectDir);
        const plans = await engine.plan(signals);
        const results = await engine.generate(plans);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].status).toBe("generated");
        (0, vitest_1.expect)(results[0].tests).toHaveLength(1);
        (0, vitest_1.expect)(results[0].tests[0].path).toBe("tests/auth.test.ts");
        (0, vitest_1.expect)(results[0].tests[0].framework).toBe("vitest");
        (0, vitest_1.expect)(llm.calls).toHaveLength(1);
        db.close();
    });
    (0, vitest_1.it)("uses specified model for LLM calls", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-model", contextDir);
        const llm = mockLLM();
        const signals = [makeTriageResult()];
        const engine = new context_graph_1.TestGenerationEngine(db, llm, projectDir, { model: "claude-opus-4-6" });
        const plans = await engine.plan(signals);
        await engine.generate(plans);
        (0, vitest_1.expect)(llm.calls[0].model).toBe("claude-opus-4-6");
        db.close();
    });
    (0, vitest_1.it)("defaults to claude-sonnet-4-6 model", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-default-model", contextDir);
        const llm = mockLLM();
        const signals = [makeTriageResult()];
        const engine = new context_graph_1.TestGenerationEngine(db, llm, projectDir);
        const plans = await engine.plan(signals);
        await engine.generate(plans);
        (0, vitest_1.expect)(llm.calls[0].model).toBe("claude-sonnet-4-6");
        db.close();
    });
    (0, vitest_1.it)("stores generated tests in database", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-store", contextDir);
        const llm = mockLLM();
        const signals = [makeTriageResult()];
        const engine = new context_graph_1.TestGenerationEngine(db, llm, projectDir);
        const plans = await engine.plan(signals);
        await engine.generate(plans);
        const stored = engine.getStoredGeneratedTests();
        (0, vitest_1.expect)(stored).toHaveLength(1);
        (0, vitest_1.expect)(stored[0].path).toBe("tests/auth.test.ts");
        (0, vitest_1.expect)(stored[0].framework).toBe("vitest");
        (0, vitest_1.expect)(stored[0].status).toBe("pending");
        (0, vitest_1.expect)(stored[0].signalId).toBe("spec_no_tests:spec:auth");
        db.close();
    });
    (0, vitest_1.it)("handles LLM errors gracefully", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-error", contextDir);
        const llm = {
            async complete() {
                throw new Error("API rate limited");
            },
        };
        const signals = [makeTriageResult()];
        const engine = new context_graph_1.TestGenerationEngine(db, llm, projectDir);
        const plans = await engine.plan(signals);
        const results = await engine.generate(plans);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].status).toBe("skipped");
        (0, vitest_1.expect)(results[0].tests).toEqual([]);
        db.close();
    });
    (0, vitest_1.it)("handles empty LLM response", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-empty", contextDir);
        const llm = mockLLM("");
        const signals = [makeTriageResult()];
        const engine = new context_graph_1.TestGenerationEngine(db, llm, projectDir);
        const plans = await engine.plan(signals);
        const results = await engine.generate(plans);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].status).toBe("skipped");
        db.close();
    });
    (0, vitest_1.it)("generates tests for multiple signal types in one batch", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-multi", contextDir);
        const unitResponse = `// File: tests/auth.test.ts
// Spec: spec:auth
import { describe, it, expect } from 'vitest';
describe('Auth', () => { it('works', () => {}); });`;
        const e2eResponse = `// File: e2e/dashboard.spec.ts
// Spec: spec:dashboard
import { test, expect } from '@playwright/test';
test('sidebar', async ({ page }) => {});`;
        const apiResponse = `// File: tests/api/users.test.ts
// Spec: spec:users-api
import { describe, it, expect } from 'vitest';
describe('Users API', () => { it('creates user', () => {}); });`;
        let callIndex = 0;
        const llm = {
            calls: [],
            async complete(prompt, model) {
                this.calls.push({ prompt, model });
                const responses = [unitResponse, e2eResponse, apiResponse];
                return responses[callIndex++] ?? "";
            },
        };
        const signals = [
            makeTriageResult(),
            makeE2eTriageResult(),
            makeApiTriageResult(),
        ];
        const engine = new context_graph_1.TestGenerationEngine(db, llm, projectDir);
        const plans = await engine.plan(signals);
        const results = await engine.generate(plans);
        (0, vitest_1.expect)(results).toHaveLength(3);
        (0, vitest_1.expect)(results[0].tests[0].path).toBe("tests/auth.test.ts");
        (0, vitest_1.expect)(results[1].tests[0].path).toBe("e2e/dashboard.spec.ts");
        (0, vitest_1.expect)(results[2].tests[0].path).toBe("tests/api/users.test.ts");
        (0, vitest_1.expect)(llm.calls).toHaveLength(3);
        // All stored in DB
        const stored = engine.getStoredGeneratedTests();
        (0, vitest_1.expect)(stored).toHaveLength(3);
        db.close();
    });
    (0, vitest_1.it)("includes prompt with correct content for each generator", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-prompts", contextDir);
        const llm = mockLLM();
        // Unit test signal
        const signals = [makeTriageResult()];
        const engine = new context_graph_1.TestGenerationEngine(db, llm, projectDir);
        const plans = await engine.plan(signals);
        await engine.generate(plans);
        // Check the prompt was built correctly
        const prompt = llm.calls[0].prompt;
        (0, vitest_1.expect)(prompt).toContain("vitest");
        (0, vitest_1.expect)(prompt).toContain("verify login");
        (0, vitest_1.expect)(prompt).toContain("reject invalid password");
        (0, vitest_1.expect)(prompt).toContain("// File: tests/auth.test.ts");
        db.close();
    });
});
// --- End-to-end: Drift → Triage → Generate ---
(0, vitest_1.describe)("full pipeline: drift → triage → generate", () => {
    (0, vitest_1.it)("generates tests from graph with specs and files", async () => {
        const db = new context_graph_1.GraphDatabase("testgen-e2e", contextDir);
        // Set up a graph
        db.upsertNode({ id: "spec:auth", type: "spec", title: "Authentication", path: "docs/spec/auth.md" });
        db.upsertNode({ id: "file:src/auth.ts", type: "file", path: "src/auth.ts" });
        db.upsertEdge({ source: "file:src/auth.ts", target: "spec:auth", relation: "implements" });
        // Write files for context
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "docs/spec"), { recursive: true });
        (0, node_fs_1.mkdirSync)((0, node_path_1.join)(projectDir, "src"), { recursive: true });
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "docs/spec/auth.md"), "# Auth\nUsers log in with email/password.");
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(projectDir, "src/auth.ts"), "export function login(email: string, password: string) { return true; }");
        // Create a pre-stored triage result (simulating Phase 5 output)
        const triageResult = makeTriageResult({
            signalId: "spec_no_tests:spec:auth",
            testHints: {
                testType: "unit",
                behaviors: ["login with valid credentials returns true", "login with invalid password returns false"],
                targetPath: "tests/auth.test.ts",
                framework: "vitest",
            },
        });
        const llm = mockLLM(`// File: tests/auth.test.ts
// Spec: spec:auth
import { describe, it, expect } from 'vitest';
import { login } from '../src/auth';

describe('Authentication — spec:auth', () => {
  it('login with valid credentials returns true', () => {
    // Spec: spec:auth
    const result = login('user@test.com', 'valid-password');
    expect(result).toBe(true);
  });

  it('login with invalid password returns false', () => {
    // Spec: spec:auth
    const result = login('user@test.com', 'wrong-password');
    expect(result).toBe(false);
  });
});`);
        const engine = new context_graph_1.TestGenerationEngine(db, llm, projectDir);
        const plans = await engine.plan([triageResult]);
        (0, vitest_1.expect)(plans).toHaveLength(1);
        (0, vitest_1.expect)(plans[0].generator.name).toBe("unit");
        // Check that context was built with actual file contents
        (0, vitest_1.expect)(plans[0].context.specContent).toContain("Users log in with email/password");
        (0, vitest_1.expect)(plans[0].context.sourceCode).toContain("export function login");
        const results = await engine.generate(plans);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].status).toBe("generated");
        (0, vitest_1.expect)(results[0].tests[0].content).toContain("login with valid credentials");
        (0, vitest_1.expect)(results[0].tests[0].content).toContain("Spec: spec:auth");
        db.close();
    });
});
//# sourceMappingURL=test-generator.test.js.map