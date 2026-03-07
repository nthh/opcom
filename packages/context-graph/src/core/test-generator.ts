/**
 * AI Test Generation from Triage Results.
 *
 * When triage identifies a real gap, an LLM agent generates tests.
 * Three output formats: unit/integration tests (vitest/pytest),
 * e2e browser tests (Playwright), and API tests (supertest/httpx).
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { GraphDatabase } from "./database.js";
import type { TriageResult } from "./triage.js";
import type { LLMProvider } from "./triage.js";
import type { TestType } from "./drift.js";

// --- Types ---

export interface GeneratedTest {
  path: string;
  content: string;
  specRef: string;
  testType: string;
  framework: string;
}

export interface VerificationResult {
  passed: boolean;
  output: string;
  errors?: string[];
  duration: number;
}

export interface GenerationContext {
  specContent: string;
  sourceCode: string;
  existingTests: string;
  preferences: string;
  extra: Record<string, string>;
}

export interface TestGeneratorInterface {
  name: string;
  canGenerate(signal: TriageResult): boolean;
  buildContext(signal: TriageResult, db: GraphDatabase, projectPath: string): Promise<GenerationContext>;
  buildPrompt(signal: TriageResult, context: GenerationContext): string;
  parseOutput(response: string): GeneratedTest[];
}

export interface GenerateOptions {
  dryRun?: boolean;
  model?: string;
  maxRetries?: number;
  maxSignals?: number;
}

export interface GenerationPlan {
  signal: TriageResult;
  generator: TestGeneratorInterface;
  context: GenerationContext;
}

export interface GenerationResult {
  signal: TriageResult;
  tests: GeneratedTest[];
  verification?: VerificationResult;
  retries: number;
  status: "generated" | "verified" | "needs_fix" | "skipped";
}

// --- Framework detection ---

export type TestFramework = "vitest" | "jest" | "pytest" | "playwright" | "cypress";

export function detectTestFramework(projectPath: string): TestFramework {
  // Check for framework config files, in priority order
  if (existsSync(join(projectPath, "vitest.config.ts")) || existsSync(join(projectPath, "vitest.config.js"))) {
    return "vitest";
  }
  if (existsSync(join(projectPath, "vite.config.ts")) || existsSync(join(projectPath, "vite.config.js"))) {
    return "vitest";
  }
  if (existsSync(join(projectPath, "jest.config.ts")) || existsSync(join(projectPath, "jest.config.js")) || existsSync(join(projectPath, "jest.config.mjs"))) {
    return "jest";
  }
  if (existsSync(join(projectPath, "pyproject.toml"))) {
    return "pytest";
  }
  if (existsSync(join(projectPath, "pytest.ini")) || existsSync(join(projectPath, "setup.cfg"))) {
    return "pytest";
  }
  // Check package.json scripts.test for hints
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8"));
      const testScript = pkg?.scripts?.test ?? "";
      if (testScript.includes("vitest")) return "vitest";
      if (testScript.includes("jest")) return "jest";
    } catch {
      // Ignore parse errors
    }
    return "vitest"; // Default for JS/TS projects
  }
  return "vitest"; // Default
}

export function detectPlaywrightConfig(projectPath: string): boolean {
  return (
    existsSync(join(projectPath, "playwright.config.ts")) ||
    existsSync(join(projectPath, "playwright.config.js"))
  );
}

export type ApiFramework = "fastapi" | "flask" | "express" | "hono" | "elysia" | "unknown";

export function detectApiFramework(sourceCode: string): ApiFramework {
  if (sourceCode.includes("from fastapi import") || sourceCode.includes("from fastapi ")) return "fastapi";
  if (sourceCode.includes("from flask import") || sourceCode.includes("from flask ")) return "flask";
  if (sourceCode.includes("new Hono(") || sourceCode.includes("from hono")) return "hono";
  if (sourceCode.includes("Elysia")) return "elysia";
  if (sourceCode.includes("express()") || sourceCode.includes("Router()") || sourceCode.includes("from 'express'") || sourceCode.includes('from "express"')) return "express";
  return "unknown";
}

// --- Test preferences ---

export interface TestPreferences {
  framework?: string;
  conventions: string[];
  examples: string;
  raw: string;
}

export async function loadTestPreferences(projectPath: string): Promise<TestPreferences> {
  const locations = [
    join(projectPath, ".context", "test-preferences.md"),
    join(projectPath, "test-preferences.md"),
  ];

  // Also check ~/.context/<project>/test-preferences.md
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (home) {
    const projectName = require("node:path").basename(projectPath);
    locations.push(join(home, ".context", projectName, "test-preferences.md"));
  }

  for (const loc of locations) {
    if (existsSync(loc)) {
      try {
        const raw = await readFile(loc, "utf-8");
        return parseTestPreferences(raw);
      } catch {
        continue;
      }
    }
  }

  return { conventions: [], examples: "", raw: "" };
}

function parseTestPreferences(raw: string): TestPreferences {
  const prefs: TestPreferences = { conventions: [], examples: "", raw };

  // Extract framework
  const frameworkMatch = raw.match(/## Framework\s*\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (frameworkMatch) {
    prefs.framework = frameworkMatch[1].trim();
  }

  // Extract conventions
  const conventionsMatch = raw.match(/## Conventions\s*\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (conventionsMatch) {
    prefs.conventions = conventionsMatch[1]
      .split("\n")
      .filter((l) => l.trim().startsWith("-"))
      .map((l) => l.trim().replace(/^-\s*/, ""));
  }

  // Extract examples
  const examplesMatch = raw.match(/## Examples\s*\n([\s\S]*?)$/);
  if (examplesMatch) {
    prefs.examples = examplesMatch[1].trim();
  }

  return prefs;
}

// --- Context building helpers ---

async function readFileContent(filePath: string, maxLen = 4000): Promise<string> {
  try {
    if (!existsSync(filePath)) return "";
    const content = await readFile(filePath, "utf-8");
    if (content.length > maxLen) {
      return content.slice(0, maxLen) + "\n... (truncated)";
    }
    return content;
  } catch {
    return "";
  }
}

async function getSpecContent(db: GraphDatabase, signal: TriageResult, projectPath: string): Promise<string> {
  // Try to find the spec node from the signal's signalId
  const nodeId = signal.signalId.split(":").slice(1).join(":");
  const node = db.getNode(nodeId);
  if (node?.path) {
    return readFileContent(join(projectPath, node.path));
  }
  return "";
}

async function getSourceCode(db: GraphDatabase, signal: TriageResult, projectPath: string): Promise<string> {
  const nodeId = signal.signalId.split(":").slice(1).join(":");
  const node = db.getNode(nodeId);

  // If the signal targets a file node, read it directly
  if (node?.type === "file" && node.path) {
    return readFileContent(join(projectPath, node.path));
  }

  // If it targets a spec, find implementing files
  if (node?.type === "spec") {
    const edges = db.getEdgesTo(nodeId, "implements");
    for (const edge of edges) {
      const implNode = db.getNode(edge.source);
      if (implNode?.path) {
        return readFileContent(join(projectPath, implNode.path));
      }
    }
  }

  return "";
}

async function getExistingTests(db: GraphDatabase, signal: TriageResult, projectPath: string): Promise<string> {
  const nodeId = signal.signalId.split(":").slice(1).join(":");

  // Find tests that cover the same target
  const testEdges = [
    ...db.getEdgesTo(nodeId, "tests"),
    ...db.getEdgesTo(nodeId, "asserts"),
  ];

  const testContents: string[] = [];
  for (const edge of testEdges) {
    const testNode = db.getNode(edge.source);
    if (testNode?.path) {
      const content = await readFileContent(join(projectPath, testNode.path), 2000);
      if (content) {
        testContents.push(`// From: ${testNode.path}\n${content}`);
      }
    }
    if (testContents.length >= 2) break; // Limit to 2 test files
  }

  return testContents.join("\n\n");
}

// --- Unit/Integration Test Generator ---

export class UnitTestGenerator implements TestGeneratorInterface {
  name = "unit";

  canGenerate(signal: TriageResult): boolean {
    return (
      signal.verdict === "actionable" &&
      signal.action === "write_test" &&
      (signal.testHints.testType === "unit" || signal.testHints.testType === "integration")
    );
  }

  async buildContext(signal: TriageResult, db: GraphDatabase, projectPath: string): Promise<GenerationContext> {
    const [specContent, sourceCode, existingTests, preferences] = await Promise.all([
      getSpecContent(db, signal, projectPath),
      getSourceCode(db, signal, projectPath),
      getExistingTests(db, signal, projectPath),
      loadTestPreferences(projectPath).then((p) => p.raw),
    ]);

    return {
      specContent,
      sourceCode,
      existingTests,
      preferences,
      extra: {
        framework: signal.testHints.framework,
        targetPath: signal.testHints.targetPath,
      },
    };
  }

  buildPrompt(signal: TriageResult, context: GenerationContext): string {
    const framework = context.extra.framework ?? "vitest";
    const lang = framework === "pytest" ? "Python" : "TypeScript";
    const specRef = signal.signalId.split(":").slice(1).join(":");
    const targetPath = context.extra.targetPath ?? signal.testHints.targetPath;

    return `You are generating ${framework} tests for a ${lang} project.

## Spec Section
${context.specContent || "(no spec content available)"}

## Code Under Test
${context.sourceCode || "(no source code available)"}

## Existing Test Conventions
${context.existingTests || "(no existing tests found)"}

## Test Preferences
${context.preferences || "(no preferences file)"}

## Instructions
- Write tests that verify the spec section's behavioral claims
- Match the style and patterns of existing tests exactly
- Include a comment on each test referencing the spec: // Spec: ${specRef}
- Use existing fixtures/helpers — do not reinvent them
- Each test should test one specific behavior
- Name tests descriptively: test_{behavior}_when_{condition}_then_{expected}
${signal.testHints.behaviors.map((b) => `- Test: ${b}`).join("\n")}

Output ONLY the test code, no explanation. Start with the file path as a comment:
// File: ${targetPath}`;
  }

  parseOutput(response: string): GeneratedTest[] {
    return parseGeneratedTests(response);
  }
}

// --- Playwright E2E Test Generator ---

export class PlaywrightGenerator implements TestGeneratorInterface {
  name = "playwright";

  canGenerate(signal: TriageResult): boolean {
    return (
      signal.verdict === "actionable" &&
      signal.action === "write_test" &&
      signal.testHints.testType === "e2e"
    );
  }

  async buildContext(signal: TriageResult, db: GraphDatabase, projectPath: string): Promise<GenerationContext> {
    const [specContent, sourceCode, existingTests, preferences] = await Promise.all([
      getSpecContent(db, signal, projectPath),
      getSourceCode(db, signal, projectPath),
      getExistingTests(db, signal, projectPath),
      loadTestPreferences(projectPath).then((p) => p.raw),
    ]);

    // Detect Playwright-specific extras
    const extra: Record<string, string> = {
      framework: "playwright",
      targetPath: signal.testHints.targetPath,
    };

    // Try to extract baseURL from playwright config
    const configPath = join(projectPath, "playwright.config.ts");
    if (existsSync(configPath)) {
      try {
        const configContent = await readFile(configPath, "utf-8");
        const baseUrlMatch = configContent.match(/baseURL:\s*['"]([^'"]+)['"]/);
        if (baseUrlMatch) {
          extra.appUrl = baseUrlMatch[1];
        }
      } catch { /* ignore */ }
    }

    // Detect selector conventions from existing tests
    extra.selectors = detectSelectorConvention(existingTests);

    if (signal.testHints.userActions) {
      extra.userActions = signal.testHints.userActions.join("\n- ");
    }

    return { specContent, sourceCode, existingTests, preferences, extra };
  }

  buildPrompt(signal: TriageResult, context: GenerationContext): string {
    const specRef = signal.signalId.split(":").slice(1).join(":");
    const targetPath = context.extra.targetPath ?? signal.testHints.targetPath;

    return `You are generating Playwright e2e tests for a web application.

## Spec Section (What the UI Should Do)
${context.specContent || "(no spec content available)"}

## Component Code (Implementation)
${context.sourceCode || "(no source code available)"}

## Existing Playwright Tests (Follow These Patterns)
${context.existingTests || "(no existing tests found)"}

## Test Preferences
${context.preferences || "(no preferences file)"}

## App Configuration
- Base URL: ${context.extra.appUrl ?? "http://localhost:3000"}
- Selector convention: ${context.extra.selectors ?? "data-testid preferred"}

## User Actions to Test
${context.extra.userActions ? `- ${context.extra.userActions}` : signal.testHints.behaviors.map((b) => `- ${b}`).join("\n")}

## Instructions
- Write a Playwright test that verifies the spec's behavioral claims through real browser interaction
- Use the SAME selector patterns as existing tests (data-testid preferred, then role selectors)
- Each test should: navigate to the right page, perform the user action, assert the expected outcome
- Use \`test.describe\` to group related assertions under the spec section name
- Include \`// Spec: ${specRef}\` comment on each test
- Prefer \`await expect(locator).toBeVisible()\` over \`waitForSelector\`
- Use \`page.getByRole()\`, \`page.getByTestId()\`, \`page.getByText()\` — never raw CSS selectors unless existing tests do
- If the spec describes a multi-step flow, use \`test.step()\` blocks
- DO NOT use \`page.waitForTimeout()\` — use Playwright's auto-waiting

Output ONLY the test code. Start with:
// File: ${targetPath}`;
  }

  parseOutput(response: string): GeneratedTest[] {
    return parseGeneratedTests(response);
  }
}

// --- API Test Generator ---

export class ApiTestGenerator implements TestGeneratorInterface {
  name = "api";

  canGenerate(signal: TriageResult): boolean {
    return (
      signal.verdict === "actionable" &&
      signal.action === "write_test" &&
      signal.testHints.testType === "api"
    );
  }

  async buildContext(signal: TriageResult, db: GraphDatabase, projectPath: string): Promise<GenerationContext> {
    const [specContent, sourceCode, existingTests, preferences] = await Promise.all([
      getSpecContent(db, signal, projectPath),
      getSourceCode(db, signal, projectPath),
      getExistingTests(db, signal, projectPath),
      loadTestPreferences(projectPath).then((p) => p.raw),
    ]);

    const extra: Record<string, string> = {
      framework: signal.testHints.framework,
      targetPath: signal.testHints.targetPath,
    };

    // Detect API framework from source code
    if (sourceCode) {
      extra.apiFramework = detectApiFramework(sourceCode);
    }

    // Include API contract info
    if (signal.testHints.apiContract) {
      const c = signal.testHints.apiContract;
      extra.apiContract = `${c.method} ${c.path} → [${c.expectedStatuses.join(", ")}]`;
      extra.method = c.method;
      extra.path = c.path;
      extra.expectedStatuses = c.expectedStatuses.join(", ");
    }

    return { specContent, sourceCode, existingTests, preferences, extra };
  }

  buildPrompt(signal: TriageResult, context: GenerationContext): string {
    const framework = context.extra.framework ?? "vitest";
    const apiFramework = context.extra.apiFramework ?? "unknown";
    const specRef = signal.signalId.split(":").slice(1).join(":");
    const targetPath = context.extra.targetPath ?? signal.testHints.targetPath;

    let testClient = "fetch";
    if (apiFramework === "fastapi") testClient = "httpx.AsyncClient + TestClient";
    else if (apiFramework === "flask") testClient = "app.test_client()";
    else if (apiFramework === "hono") testClient = "app.request()";
    else if (apiFramework === "express") testClient = "supertest(app)";
    else if (apiFramework === "elysia") testClient = "app.handle()";

    return `You are generating API tests for a ${apiFramework} application using ${testClient}.

## Spec Section (API Contract)
${context.specContent || "(no spec content available)"}

## Route Handler Code
${context.sourceCode || "(no source code available)"}

## API Contract
${context.extra.apiContract ?? "(no contract info)"}

## Existing API Tests (Follow These Patterns)
${context.existingTests || "(no existing tests found)"}

## Test Preferences
${context.preferences || "(no preferences file)"}

## Instructions
- Write ${framework} tests that verify each behavioral claim in the spec section
- Test the HTTP contract: method, path, status code, response shape, error cases
- Match existing test patterns exactly (client creation, auth, fixtures, assertions)
- Include \`// Spec: ${specRef}\` comment on each test
- Test BOTH success and error paths documented in the spec
${signal.testHints.apiContract ? `- Expected status codes: ${context.extra.expectedStatuses}` : ""}
- For mutations (POST/PUT/DELETE): verify the side effect
- Use the project's existing test fixtures — do not create new ones
${signal.testHints.behaviors.map((b) => `- Test: ${b}`).join("\n")}

Output ONLY the test code. Start with:
// File: ${targetPath}`;
  }

  parseOutput(response: string): GeneratedTest[] {
    return parseGeneratedTests(response);
  }
}

// --- LLM response parsing ---

export function parseGeneratedTests(response: string): GeneratedTest[] {
  const tests: GeneratedTest[] = [];

  // Strip markdown code fences if present
  let code = response.trim();
  const fenceMatch = code.match(/```(?:typescript|python|ts|py|javascript|js)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    code = fenceMatch[1].trim();
  }

  // Extract file path from comment
  const pathMatch = code.match(/^(?:\/\/|#)\s*File:\s*(.+)/m);
  const path = pathMatch?.[1]?.trim() ?? "";

  // Extract spec reference from comment
  const specMatch = code.match(/(?:\/\/|#)\s*Spec:\s*(.+)/m);
  const specRef = specMatch?.[1]?.trim() ?? "";

  // Detect framework from content
  let framework = "vitest";
  let testType = "unit";
  if (code.includes("from playwright") || code.includes("@playwright/test")) {
    framework = "playwright";
    testType = "e2e";
  } else if (code.includes("import pytest") || code.includes("@pytest")) {
    framework = "pytest";
  } else if (code.includes("from vitest") || code.includes("import { describe") || code.includes("import { it") || code.includes("import { test")) {
    framework = "vitest";
  } else if (code.includes("supertest") || code.includes("httpx") || code.includes("TestClient")) {
    testType = "api";
  }

  if (path || code.length > 0) {
    tests.push({
      path,
      content: code,
      specRef,
      testType,
      framework,
    });
  }

  return tests;
}

// --- Selector convention detection ---

function detectSelectorConvention(testCode: string): string {
  if (!testCode) return "data-testid preferred";

  const patterns = {
    testid: (testCode.match(/getByTestId|data-testid/g) ?? []).length,
    role: (testCode.match(/getByRole/g) ?? []).length,
    text: (testCode.match(/getByText/g) ?? []).length,
    css: (testCode.match(/querySelector|page\.\$/g) ?? []).length,
  };

  const sorted = Object.entries(patterns).sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] === 0) return "data-testid preferred";

  const conventions = sorted.filter(([, count]) => count > 0).map(([name]) => name);
  return conventions.join(", then ") + " selectors";
}

// --- Test Generation Engine ---

export const GENERATED_TESTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS generated_tests (
    id          TEXT PRIMARY KEY,
    path        TEXT NOT NULL,
    spec_ref    TEXT,
    test_type   TEXT NOT NULL,
    framework   TEXT NOT NULL,
    status      TEXT NOT NULL,
    feedback    TEXT,
    created_at  TEXT NOT NULL,
    resolved_at TEXT,
    signal_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_generated_tests_status ON generated_tests(status);
CREATE INDEX IF NOT EXISTS idx_generated_tests_signal ON generated_tests(signal_id);
`;

export class TestGenerationEngine {
  private generators: TestGeneratorInterface[];

  constructor(
    private db: GraphDatabase,
    private llm: LLMProvider,
    private projectPath: string,
    private options: GenerateOptions = {},
  ) {
    this.generators = [
      new UnitTestGenerator(),
      new PlaywrightGenerator(),
      new ApiTestGenerator(),
    ];
  }

  async plan(signals: TriageResult[]): Promise<GenerationPlan[]> {
    // Filter to actionable write_test signals
    const actionable = signals.filter(
      (s) => s.verdict === "actionable" && s.action === "write_test",
    );

    // Cap signals
    const max = this.options.maxSignals ?? 10;
    const capped = actionable.slice(0, max);

    const plans: GenerationPlan[] = [];

    for (const signal of capped) {
      const generator = this.generators.find((g) => g.canGenerate(signal));
      if (!generator) continue;

      const context = await generator.buildContext(signal, this.db, this.projectPath);
      plans.push({ signal, generator, context });
    }

    return plans;
  }

  async generate(plans: GenerationPlan[]): Promise<GenerationResult[]> {
    this.ensureSchema();
    const model = this.options.model ?? "claude-sonnet-4-6";
    const maxRetries = this.options.maxRetries ?? 2;
    const results: GenerationResult[] = [];

    for (const plan of plans) {
      const prompt = plan.generator.buildPrompt(plan.signal, plan.context);

      let tests: GeneratedTest[] = [];
      let retries = 0;
      let lastError = "";

      // Initial generation
      try {
        const response = await this.llm.complete(prompt, model);
        tests = plan.generator.parseOutput(response);
      } catch (err) {
        results.push({
          signal: plan.signal,
          tests: [],
          retries: 0,
          status: "skipped",
        });
        continue;
      }

      if (tests.length === 0) {
        results.push({
          signal: plan.signal,
          tests: [],
          retries: 0,
          status: "skipped",
        });
        continue;
      }

      // Store result
      const result: GenerationResult = {
        signal: plan.signal,
        tests,
        retries,
        status: "generated",
      };

      // Record in database
      for (const test of tests) {
        const id = `gen:${test.path}::${plan.signal.signalId}`;
        this.storeGeneratedTest(id, test, plan.signal.signalId, "pending");
      }

      results.push(result);
    }

    return results;
  }

  private ensureSchema(): void {
    try {
      this.db.query("SELECT 1 FROM generated_tests LIMIT 1");
    } catch {
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS generated_tests (
          id          TEXT PRIMARY KEY,
          path        TEXT NOT NULL,
          spec_ref    TEXT,
          test_type   TEXT NOT NULL,
          framework   TEXT NOT NULL,
          status      TEXT NOT NULL,
          feedback    TEXT,
          created_at  TEXT NOT NULL,
          resolved_at TEXT,
          signal_id   TEXT
        )`,
      );
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_generated_tests_status ON generated_tests(status)");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_generated_tests_signal ON generated_tests(signal_id)");
    }
  }

  private storeGeneratedTest(id: string, test: GeneratedTest, signalId: string, status: string): void {
    const now = new Date().toISOString();
    this.db.exec(
      `INSERT OR REPLACE INTO generated_tests (id, path, spec_ref, test_type, framework, status, created_at, signal_id)
       VALUES ('${esc(id)}', '${esc(test.path)}', '${esc(test.specRef)}', '${esc(test.testType)}', '${esc(test.framework)}', '${esc(status)}', '${esc(now)}', '${esc(signalId)}')`,
    );
  }

  getStoredGeneratedTests(): Array<{ id: string; path: string; specRef: string; testType: string; framework: string; status: string; signalId: string }> {
    this.ensureSchema();
    try {
      const result = this.db.query(
        "SELECT id, path, spec_ref, test_type, framework, status, signal_id FROM generated_tests ORDER BY created_at DESC",
      );
      return result.rows.map((row) => ({
        id: row[0] as string,
        path: row[1] as string,
        specRef: row[2] as string,
        testType: row[3] as string,
        framework: row[4] as string,
        status: row[5] as string,
        signalId: row[6] as string,
      }));
    } catch {
      return [];
    }
  }
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}
