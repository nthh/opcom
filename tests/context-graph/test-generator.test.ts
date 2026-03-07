import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  GraphDatabase,
  type LLMProvider,
  type TriageResult,
  type DriftSignalType,
  TestGenerationEngine,
  UnitTestGenerator,
  PlaywrightGenerator,
  ApiTestGenerator,
  parseGeneratedTests,
  detectTestFramework,
  detectPlaywrightConfig,
  detectApiFramework,
  loadTestPreferences,
  type GenerationContext,
  type GenerationPlan,
} from "@opcom/context-graph";

let contextDir: string;
let projectDir: string;

beforeEach(() => {
  contextDir = mkdtempSync(join(tmpdir(), "cg-testgen-ctx-"));
  projectDir = mkdtempSync(join(tmpdir(), "cg-testgen-proj-"));
});

afterEach(() => {
  rmSync(contextDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

// --- Helpers ---

function makeTriageResult(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    signalId: "spec_no_tests:spec:auth",
    signalType: "spec_no_tests" as DriftSignalType,
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

function makeE2eTriageResult(overrides: Partial<TriageResult> = {}): TriageResult {
  return makeTriageResult({
    signalId: "ui_spec_no_e2e:spec:dashboard",
    signalType: "ui_spec_no_e2e" as DriftSignalType,
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

function makeApiTriageResult(overrides: Partial<TriageResult> = {}): TriageResult {
  return makeTriageResult({
    signalId: "api_spec_no_test:spec:users-api",
    signalType: "api_spec_no_test" as DriftSignalType,
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

function mockLLM(response?: string): LLMProvider & { calls: Array<{ prompt: string; model: string }> } {
  const calls: Array<{ prompt: string; model: string }> = [];
  return {
    calls,
    async complete(prompt: string, model: string): Promise<string> {
      calls.push({ prompt, model });
      if (response !== undefined) return response;
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

describe("parseGeneratedTests", () => {
  it("extracts file path from comment", () => {
    const response = `// File: tests/auth.test.ts
import { describe, it, expect } from 'vitest';
describe('Auth', () => { it('works', () => {}); });`;

    const tests = parseGeneratedTests(response);
    expect(tests).toHaveLength(1);
    expect(tests[0].path).toBe("tests/auth.test.ts");
  });

  it("extracts spec reference from comment", () => {
    const response = `// File: tests/auth.test.ts
// Spec: AUTH.md#2.1
import { describe, it, expect } from 'vitest';`;

    const tests = parseGeneratedTests(response);
    expect(tests[0].specRef).toBe("AUTH.md#2.1");
  });

  it("detects vitest framework", () => {
    const response = `// File: tests/auth.test.ts
import { describe, it, expect } from 'vitest';
describe('Auth', () => {});`;

    const tests = parseGeneratedTests(response);
    expect(tests[0].framework).toBe("vitest");
  });

  it("detects playwright framework", () => {
    const response = `// File: e2e/dashboard.spec.ts
import { test, expect } from '@playwright/test';
test('loads', async ({ page }) => {});`;

    const tests = parseGeneratedTests(response);
    expect(tests[0].framework).toBe("playwright");
    expect(tests[0].testType).toBe("e2e");
  });

  it("detects pytest framework", () => {
    const response = `# File: tests/test_auth.py
import pytest

class TestAuth:
    @pytest.mark.asyncio
    async def test_login(self):
        pass`;

    const tests = parseGeneratedTests(response);
    expect(tests[0].framework).toBe("pytest");
  });

  it("strips markdown code fences", () => {
    const response = "```typescript\n// File: tests/auth.test.ts\nimport { describe } from 'vitest';\n```";

    const tests = parseGeneratedTests(response);
    expect(tests).toHaveLength(1);
    expect(tests[0].path).toBe("tests/auth.test.ts");
  });

  it("returns empty array for empty response", () => {
    const tests = parseGeneratedTests("");
    expect(tests).toEqual([]);
  });

  it("handles response with no file path", () => {
    const response = `import { describe, it, expect } from 'vitest';
describe('Auth', () => {});`;

    const tests = parseGeneratedTests(response);
    expect(tests).toHaveLength(1);
    expect(tests[0].path).toBe("");
  });
});

// --- detectTestFramework ---

describe("detectTestFramework", () => {
  it("detects vitest from vitest.config.ts", () => {
    writeFileSync(join(projectDir, "vitest.config.ts"), "export default {}");
    expect(detectTestFramework(projectDir)).toBe("vitest");
  });

  it("detects vitest from vite.config.ts", () => {
    writeFileSync(join(projectDir, "vite.config.ts"), "export default {}");
    expect(detectTestFramework(projectDir)).toBe("vitest");
  });

  it("detects jest from jest.config.ts", () => {
    writeFileSync(join(projectDir, "jest.config.ts"), "module.exports = {}");
    expect(detectTestFramework(projectDir)).toBe("jest");
  });

  it("detects pytest from pyproject.toml", () => {
    writeFileSync(join(projectDir, "pyproject.toml"), "[tool.pytest]");
    expect(detectTestFramework(projectDir)).toBe("pytest");
  });

  it("detects vitest from package.json scripts.test", () => {
    writeFileSync(join(projectDir, "package.json"), JSON.stringify({
      scripts: { test: "vitest run" },
    }));
    expect(detectTestFramework(projectDir)).toBe("vitest");
  });

  it("detects jest from package.json scripts.test", () => {
    writeFileSync(join(projectDir, "package.json"), JSON.stringify({
      scripts: { test: "jest --passWithNoTests" },
    }));
    expect(detectTestFramework(projectDir)).toBe("jest");
  });

  it("defaults to vitest for JS/TS projects with package.json", () => {
    writeFileSync(join(projectDir, "package.json"), JSON.stringify({}));
    expect(detectTestFramework(projectDir)).toBe("vitest");
  });

  it("defaults to vitest when no markers found", () => {
    expect(detectTestFramework(projectDir)).toBe("vitest");
  });
});

// --- detectPlaywrightConfig ---

describe("detectPlaywrightConfig", () => {
  it("returns true when playwright.config.ts exists", () => {
    writeFileSync(join(projectDir, "playwright.config.ts"), "export default {}");
    expect(detectPlaywrightConfig(projectDir)).toBe(true);
  });

  it("returns false when no config exists", () => {
    expect(detectPlaywrightConfig(projectDir)).toBe(false);
  });
});

// --- detectApiFramework ---

describe("detectApiFramework", () => {
  it("detects FastAPI", () => {
    expect(detectApiFramework("from fastapi import FastAPI")).toBe("fastapi");
  });

  it("detects Flask", () => {
    expect(detectApiFramework("from flask import Flask")).toBe("flask");
  });

  it("detects Express", () => {
    expect(detectApiFramework('import express from "express"; const app = express()')).toBe("express");
  });

  it("detects Hono", () => {
    expect(detectApiFramework("import { Hono } from 'hono'; const app = new Hono()")).toBe("hono");
  });

  it("detects Elysia", () => {
    expect(detectApiFramework("new Elysia()")).toBe("elysia");
  });

  it("returns unknown for unrecognized code", () => {
    expect(detectApiFramework("function handler() { return 'hello'; }")).toBe("unknown");
  });
});

// --- loadTestPreferences ---

describe("loadTestPreferences", () => {
  it("loads preferences from .context/test-preferences.md", async () => {
    const contextPath = join(projectDir, ".context");
    mkdirSync(contextPath, { recursive: true });
    writeFileSync(
      join(contextPath, "test-preferences.md"),
      `# Test Preferences

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
`,
    );

    const prefs = await loadTestPreferences(projectDir);
    expect(prefs.raw).toContain("vitest with typescript");
    expect(prefs.framework).toBe("vitest with typescript");
    expect(prefs.conventions).toHaveLength(3);
    expect(prefs.conventions[0]).toBe("Use describe blocks for grouping");
    expect(prefs.examples).toContain("Good test");
  });

  it("returns empty preferences when no file exists", async () => {
    const prefs = await loadTestPreferences(projectDir);
    expect(prefs.raw).toBe("");
    expect(prefs.conventions).toEqual([]);
    expect(prefs.examples).toBe("");
  });

  it("falls back to project root test-preferences.md", async () => {
    writeFileSync(
      join(projectDir, "test-preferences.md"),
      `# Test Preferences

## Framework
jest

## Conventions
- Use test() not it()
`,
    );

    const prefs = await loadTestPreferences(projectDir);
    expect(prefs.framework).toBe("jest");
    expect(prefs.conventions).toHaveLength(1);
  });
});

// --- UnitTestGenerator ---

describe("UnitTestGenerator", () => {
  const generator = new UnitTestGenerator();

  it("canGenerate returns true for actionable unit test signals", () => {
    expect(generator.canGenerate(makeTriageResult())).toBe(true);
  });

  it("canGenerate returns true for integration test signals", () => {
    expect(generator.canGenerate(makeTriageResult({
      testHints: { ...makeTriageResult().testHints, testType: "integration" },
    }))).toBe(true);
  });

  it("canGenerate returns false for e2e signals", () => {
    expect(generator.canGenerate(makeE2eTriageResult())).toBe(false);
  });

  it("canGenerate returns false for non-actionable signals", () => {
    expect(generator.canGenerate(makeTriageResult({ verdict: "expected" }))).toBe(false);
  });

  it("canGenerate returns false for non-write_test actions", () => {
    expect(generator.canGenerate(makeTriageResult({ action: "update_spec" }))).toBe(false);
  });

  it("builds context from graph", async () => {
    const db = new GraphDatabase("testgen-unit-ctx", contextDir);

    // Set up graph with spec and implementing file
    db.upsertNode({ id: "spec:auth", type: "spec", path: "docs/spec/auth.md", title: "Authentication" });

    const signal = makeTriageResult();
    const context = await generator.buildContext(signal, db, projectDir);

    expect(context).toBeDefined();
    expect(context.extra.framework).toBe("vitest");
    expect(context.extra.targetPath).toBe("tests/auth.test.ts");

    db.close();
  });

  it("builds prompt with signal details", () => {
    const signal = makeTriageResult();
    const context: GenerationContext = {
      specContent: "Users authenticate with email and password",
      sourceCode: "export function login() { }",
      existingTests: "it('tests something', () => {})",
      preferences: "Use vitest",
      extra: { framework: "vitest", targetPath: "tests/auth.test.ts" },
    };

    const prompt = generator.buildPrompt(signal, context);
    expect(prompt).toContain("vitest");
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("Users authenticate with email and password");
    expect(prompt).toContain("export function login()");
    expect(prompt).toContain("tests something");
    expect(prompt).toContain("verify login");
    expect(prompt).toContain("reject invalid password");
    expect(prompt).toContain("// File: tests/auth.test.ts");
  });

  it("builds prompt for pytest", () => {
    const signal = makeTriageResult({
      testHints: {
        ...makeTriageResult().testHints,
        framework: "pytest",
      },
    });
    const context: GenerationContext = {
      specContent: "spec",
      sourceCode: "code",
      existingTests: "",
      preferences: "",
      extra: { framework: "pytest", targetPath: "tests/test_auth.py" },
    };

    const prompt = generator.buildPrompt(signal, context);
    expect(prompt).toContain("pytest");
    expect(prompt).toContain("Python");
  });
});

// --- PlaywrightGenerator ---

describe("PlaywrightGenerator", () => {
  const generator = new PlaywrightGenerator();

  it("canGenerate returns true for e2e signals", () => {
    expect(generator.canGenerate(makeE2eTriageResult())).toBe(true);
  });

  it("canGenerate returns false for unit test signals", () => {
    expect(generator.canGenerate(makeTriageResult())).toBe(false);
  });

  it("canGenerate returns false for api signals", () => {
    expect(generator.canGenerate(makeApiTriageResult())).toBe(false);
  });

  it("builds prompt with user actions", () => {
    const signal = makeE2eTriageResult();
    const context: GenerationContext = {
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
    expect(prompt).toContain("Playwright");
    expect(prompt).toContain("Users can toggle the sidebar");
    expect(prompt).toContain("http://localhost:3000");
    expect(prompt).toContain("data-testid");
    expect(prompt).toContain("click sidebar toggle");
    expect(prompt).toContain("test.describe");
    expect(prompt).toContain("test.step");
  });

  it("extracts baseURL from playwright config", async () => {
    writeFileSync(join(projectDir, "playwright.config.ts"), `
import { defineConfig } from '@playwright/test';
export default defineConfig({
  use: { baseURL: 'http://localhost:5173' },
});
`);

    const db = new GraphDatabase("testgen-pw-ctx", contextDir);
    const signal = makeE2eTriageResult();
    const context = await generator.buildContext(signal, db, projectDir);

    expect(context.extra.appUrl).toBe("http://localhost:5173");

    db.close();
  });

  it("detects selector convention from existing tests", async () => {
    const db = new GraphDatabase("testgen-pw-sel", contextDir);

    // Create test node with getByTestId patterns
    db.upsertNode({
      id: "test:e2e-dashboard",
      type: "test",
      path: "e2e/existing.spec.ts",
    });
    db.upsertNode({ id: "spec:dashboard", type: "spec" });
    db.upsertEdge({ source: "test:e2e-dashboard", target: "spec:dashboard", relation: "asserts" });

    // Write a test file with getByTestId patterns
    mkdirSync(join(projectDir, "e2e"), { recursive: true });
    writeFileSync(join(projectDir, "e2e/existing.spec.ts"), `
import { test, expect } from '@playwright/test';
test('sidebar', async ({ page }) => {
  await page.getByTestId('sidebar-toggle').click();
  await page.getByTestId('sidebar-panel').isVisible();
  await page.getByRole('button', { name: 'Close' }).click();
});
`);

    const signal = makeE2eTriageResult();
    const context = await generator.buildContext(signal, db, projectDir);

    expect(context.extra.selectors).toContain("testid");

    db.close();
  });
});

// --- ApiTestGenerator ---

describe("ApiTestGenerator", () => {
  const generator = new ApiTestGenerator();

  it("canGenerate returns true for api signals", () => {
    expect(generator.canGenerate(makeApiTriageResult())).toBe(true);
  });

  it("canGenerate returns false for unit signals", () => {
    expect(generator.canGenerate(makeTriageResult())).toBe(false);
  });

  it("canGenerate returns false for e2e signals", () => {
    expect(generator.canGenerate(makeE2eTriageResult())).toBe(false);
  });

  it("builds prompt with API contract", () => {
    const signal = makeApiTriageResult();
    const context: GenerationContext = {
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
    expect(prompt).toContain("express");
    expect(prompt).toContain("supertest(app)");
    expect(prompt).toContain("POST /api/users");
    expect(prompt).toContain("201, 409, 422");
    expect(prompt).toContain("create user");
    expect(prompt).toContain("reject duplicate email");
  });

  it("builds prompt with hono test client", () => {
    const signal = makeApiTriageResult();
    const context: GenerationContext = {
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
    expect(prompt).toContain("hono");
    expect(prompt).toContain("app.request()");
  });

  it("builds prompt with fastapi test client", () => {
    const signal = makeApiTriageResult();
    const context: GenerationContext = {
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
    expect(prompt).toContain("fastapi");
    expect(prompt).toContain("httpx.AsyncClient");
  });

  it("detects API framework from source code in context", async () => {
    const db = new GraphDatabase("testgen-api-fw", contextDir);

    // Set up graph with a file node containing Express code
    db.upsertNode({
      id: "file:src/routes/users.ts",
      type: "file",
      path: "src/routes/users.ts",
    });

    // Write the route file
    mkdirSync(join(projectDir, "src/routes"), { recursive: true });
    writeFileSync(join(projectDir, "src/routes/users.ts"), `
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

    expect(context.extra.apiFramework).toBe("express");

    db.close();
  });
});

// --- TestGenerationEngine ---

describe("TestGenerationEngine", () => {
  it("plans generation for actionable signals", async () => {
    const db = new GraphDatabase("testgen-plan", contextDir);
    const llm = mockLLM();

    const signals: TriageResult[] = [
      makeTriageResult(),
      makeE2eTriageResult(),
      makeApiTriageResult(),
    ];

    const engine = new TestGenerationEngine(db, llm, projectDir);
    const plans = await engine.plan(signals);

    expect(plans).toHaveLength(3);
    expect(plans[0].generator.name).toBe("unit");
    expect(plans[1].generator.name).toBe("playwright");
    expect(plans[2].generator.name).toBe("api");

    db.close();
  });

  it("skips non-actionable signals in plan", async () => {
    const db = new GraphDatabase("testgen-skip-plan", contextDir);
    const llm = mockLLM();

    const signals: TriageResult[] = [
      makeTriageResult({ verdict: "expected" }),
      makeTriageResult({ action: "update_spec" }),
      makeTriageResult(), // This one is actionable
    ];

    const engine = new TestGenerationEngine(db, llm, projectDir);
    const plans = await engine.plan(signals);

    expect(plans).toHaveLength(1);
    expect(plans[0].signal.signalId).toBe("spec_no_tests:spec:auth");

    db.close();
  });

  it("respects maxSignals option", async () => {
    const db = new GraphDatabase("testgen-max", contextDir);
    const llm = mockLLM();

    const signals: TriageResult[] = Array.from({ length: 20 }, (_, i) =>
      makeTriageResult({ signalId: `spec_no_tests:spec:s${i}` }),
    );

    const engine = new TestGenerationEngine(db, llm, projectDir, { maxSignals: 3 });
    const plans = await engine.plan(signals);

    expect(plans).toHaveLength(3);

    db.close();
  });

  it("generates tests via LLM", async () => {
    const db = new GraphDatabase("testgen-generate", contextDir);
    const llm = mockLLM();

    const signals: TriageResult[] = [makeTriageResult()];
    const engine = new TestGenerationEngine(db, llm, projectDir);

    const plans = await engine.plan(signals);
    const results = await engine.generate(plans);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("generated");
    expect(results[0].tests).toHaveLength(1);
    expect(results[0].tests[0].path).toBe("tests/auth.test.ts");
    expect(results[0].tests[0].framework).toBe("vitest");
    expect(llm.calls).toHaveLength(1);

    db.close();
  });

  it("uses specified model for LLM calls", async () => {
    const db = new GraphDatabase("testgen-model", contextDir);
    const llm = mockLLM();

    const signals: TriageResult[] = [makeTriageResult()];
    const engine = new TestGenerationEngine(db, llm, projectDir, { model: "claude-opus-4-6" });

    const plans = await engine.plan(signals);
    await engine.generate(plans);

    expect(llm.calls[0].model).toBe("claude-opus-4-6");

    db.close();
  });

  it("defaults to claude-sonnet-4-6 model", async () => {
    const db = new GraphDatabase("testgen-default-model", contextDir);
    const llm = mockLLM();

    const signals: TriageResult[] = [makeTriageResult()];
    const engine = new TestGenerationEngine(db, llm, projectDir);

    const plans = await engine.plan(signals);
    await engine.generate(plans);

    expect(llm.calls[0].model).toBe("claude-sonnet-4-6");

    db.close();
  });

  it("stores generated tests in database", async () => {
    const db = new GraphDatabase("testgen-store", contextDir);
    const llm = mockLLM();

    const signals: TriageResult[] = [makeTriageResult()];
    const engine = new TestGenerationEngine(db, llm, projectDir);

    const plans = await engine.plan(signals);
    await engine.generate(plans);

    const stored = engine.getStoredGeneratedTests();
    expect(stored).toHaveLength(1);
    expect(stored[0].path).toBe("tests/auth.test.ts");
    expect(stored[0].framework).toBe("vitest");
    expect(stored[0].status).toBe("pending");
    expect(stored[0].signalId).toBe("spec_no_tests:spec:auth");

    db.close();
  });

  it("handles LLM errors gracefully", async () => {
    const db = new GraphDatabase("testgen-error", contextDir);
    const llm: LLMProvider = {
      async complete() {
        throw new Error("API rate limited");
      },
    };

    const signals: TriageResult[] = [makeTriageResult()];
    const engine = new TestGenerationEngine(db, llm, projectDir);

    const plans = await engine.plan(signals);
    const results = await engine.generate(plans);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("skipped");
    expect(results[0].tests).toEqual([]);

    db.close();
  });

  it("handles empty LLM response", async () => {
    const db = new GraphDatabase("testgen-empty", contextDir);
    const llm = mockLLM("");

    const signals: TriageResult[] = [makeTriageResult()];
    const engine = new TestGenerationEngine(db, llm, projectDir);

    const plans = await engine.plan(signals);
    const results = await engine.generate(plans);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("skipped");

    db.close();
  });

  it("generates tests for multiple signal types in one batch", async () => {
    const db = new GraphDatabase("testgen-multi", contextDir);

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
    const llm: LLMProvider & { calls: Array<{ prompt: string; model: string }> } = {
      calls: [],
      async complete(prompt: string, model: string): Promise<string> {
        this.calls.push({ prompt, model });
        const responses = [unitResponse, e2eResponse, apiResponse];
        return responses[callIndex++] ?? "";
      },
    };

    const signals: TriageResult[] = [
      makeTriageResult(),
      makeE2eTriageResult(),
      makeApiTriageResult(),
    ];

    const engine = new TestGenerationEngine(db, llm, projectDir);
    const plans = await engine.plan(signals);
    const results = await engine.generate(plans);

    expect(results).toHaveLength(3);
    expect(results[0].tests[0].path).toBe("tests/auth.test.ts");
    expect(results[1].tests[0].path).toBe("e2e/dashboard.spec.ts");
    expect(results[2].tests[0].path).toBe("tests/api/users.test.ts");
    expect(llm.calls).toHaveLength(3);

    // All stored in DB
    const stored = engine.getStoredGeneratedTests();
    expect(stored).toHaveLength(3);

    db.close();
  });

  it("includes prompt with correct content for each generator", async () => {
    const db = new GraphDatabase("testgen-prompts", contextDir);
    const llm = mockLLM();

    // Unit test signal
    const signals: TriageResult[] = [makeTriageResult()];
    const engine = new TestGenerationEngine(db, llm, projectDir);
    const plans = await engine.plan(signals);
    await engine.generate(plans);

    // Check the prompt was built correctly
    const prompt = llm.calls[0].prompt;
    expect(prompt).toContain("vitest");
    expect(prompt).toContain("verify login");
    expect(prompt).toContain("reject invalid password");
    expect(prompt).toContain("// File: tests/auth.test.ts");

    db.close();
  });
});

// --- End-to-end: Drift → Triage → Generate ---

describe("full pipeline: drift → triage → generate", () => {
  it("generates tests from graph with specs and files", async () => {
    const db = new GraphDatabase("testgen-e2e", contextDir);

    // Set up a graph
    db.upsertNode({ id: "spec:auth", type: "spec", title: "Authentication", path: "docs/spec/auth.md" });
    db.upsertNode({ id: "file:src/auth.ts", type: "file", path: "src/auth.ts" });
    db.upsertEdge({ source: "file:src/auth.ts", target: "spec:auth", relation: "implements" });

    // Write files for context
    mkdirSync(join(projectDir, "docs/spec"), { recursive: true });
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "docs/spec/auth.md"), "# Auth\nUsers log in with email/password.");
    writeFileSync(join(projectDir, "src/auth.ts"), "export function login(email: string, password: string) { return true; }");

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

    const engine = new TestGenerationEngine(db, llm, projectDir);
    const plans = await engine.plan([triageResult]);

    expect(plans).toHaveLength(1);
    expect(plans[0].generator.name).toBe("unit");

    // Check that context was built with actual file contents
    expect(plans[0].context.specContent).toContain("Users log in with email/password");
    expect(plans[0].context.sourceCode).toContain("export function login");

    const results = await engine.generate(plans);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("generated");
    expect(results[0].tests[0].content).toContain("login with valid credentials");
    expect(results[0].tests[0].content).toContain("Spec: spec:auth");

    db.close();
  });
});
