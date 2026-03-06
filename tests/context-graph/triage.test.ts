import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  GraphDatabase,
  DriftEngine,
  TriageEngine,
  type LLMProvider,
  type DriftSignal,
  type TriageResult,
  buildBatchPrompt,
  parseTriageResponse,
  isExpectedUntested,
} from "@opcom/context-graph";

let contextDir: string;

beforeEach(() => {
  contextDir = mkdtempSync(join(tmpdir(), "cg-triage-ctx-"));
});

afterEach(() => {
  rmSync(contextDir, { recursive: true, force: true });
});

// --- Mock LLM provider ---

function mockLLM(responseMap?: Record<string, string>): LLMProvider & { calls: Array<{ prompt: string; model: string }> } {
  const calls: Array<{ prompt: string; model: string }> = [];

  return {
    calls,
    async complete(prompt: string, model: string): Promise<string> {
      calls.push({ prompt, model });

      // If a specific response map is provided, match by signal type mentioned in prompt
      if (responseMap) {
        for (const [key, val] of Object.entries(responseMap)) {
          if (prompt.includes(key)) return val;
        }
      }

      // Default: parse number of signals from prompt and generate matching responses
      const signalMatches = prompt.match(/### Signal \d+/g);
      const count = signalMatches?.length ?? 1;

      const results = [];
      for (let i = 0; i < count; i++) {
        results.push({
          verdict: "actionable",
          action: "write_test",
          priority: "P2",
          reasoning: "This file has no test coverage and contains business logic.",
          testHints: {
            testType: "unit",
            behaviors: ["verify core functionality", "handle edge cases"],
            targetPath: "tests/test_signal.ts",
            framework: "vitest",
          },
        });
      }
      return JSON.stringify(results);
    },
  };
}

function makeSignal(overrides: Partial<DriftSignal> = {}): DriftSignal {
  return {
    id: "spec_no_tests:spec:auth",
    type: "spec_no_tests",
    severity: 0.6,
    testType: "unit",
    action: "write_test",
    subject: { nodeId: "spec:auth", path: "docs/spec/auth.md", title: "Authentication" },
    context: { scoringReason: "Base severity for spec_no_tests: 0.6" },
    ...overrides,
  };
}

// --- Pre-filter tests ---

describe("isExpectedUntested", () => {
  it("identifies Python init files", () => {
    expect(isExpectedUntested("src/__init__.py")).toBe(true);
  });

  it("identifies conftest files", () => {
    expect(isExpectedUntested("tests/conftest.py")).toBe(true);
  });

  it("identifies TypeScript type files", () => {
    expect(isExpectedUntested("src/types.ts")).toBe(true);
    expect(isExpectedUntested("src/api.d.ts")).toBe(true);
  });

  it("identifies config files", () => {
    expect(isExpectedUntested("vitest.config.ts")).toBe(true);
    expect(isExpectedUntested("eslint.config.mjs")).toBe(true);
  });

  it("identifies migration files", () => {
    expect(isExpectedUntested("db/migrations/001_create_users.sql")).toBe(true);
  });

  it("identifies generated files", () => {
    expect(isExpectedUntested("src/api.generated.ts")).toBe(true);
    expect(isExpectedUntested("src/schema.gen.ts")).toBe(true);
  });

  it("identifies lock files", () => {
    expect(isExpectedUntested("package-lock.json")).toBe(false); // .json not in patterns
    expect(isExpectedUntested("yarn.lock")).toBe(true);
  });

  it("returns false for regular source files", () => {
    expect(isExpectedUntested("src/auth.ts")).toBe(false);
    expect(isExpectedUntested("src/utils.py")).toBe(false);
    expect(isExpectedUntested("src/components/Button.tsx")).toBe(false);
  });
});

// --- Prompt building tests ---

describe("buildBatchPrompt", () => {
  it("includes signal details in prompt", () => {
    const signal = makeSignal();
    const prompt = buildBatchPrompt([signal]);

    expect(prompt).toContain("spec_no_tests");
    expect(prompt).toContain("docs/spec/auth.md");
    expect(prompt).toContain("Authentication");
    expect(prompt).toContain("0.6");
  });

  it("includes spec content when available", () => {
    const signal = makeSignal({
      context: {
        specContent: "Users can log in with email and password",
        scoringReason: "test",
      },
    });
    const prompt = buildBatchPrompt([signal]);
    expect(prompt).toContain("Users can log in with email and password");
  });

  it("includes source code when available", () => {
    const signal = makeSignal({
      context: {
        sourceCode: "export function authenticate() { ... }",
        scoringReason: "test",
      },
    });
    const prompt = buildBatchPrompt([signal]);
    expect(prompt).toContain("export function authenticate()");
  });

  it("includes existing test code when available", () => {
    const signal = makeSignal({
      context: {
        testCode: "it('should authenticate', () => { ... })",
        scoringReason: "test",
      },
    });
    const prompt = buildBatchPrompt([signal]);
    expect(prompt).toContain("should authenticate");
  });

  it("numbers multiple signals correctly", () => {
    const signals = [
      makeSignal({ id: "spec_no_tests:spec:auth" }),
      makeSignal({ id: "file_no_tests:file:utils", type: "file_no_tests" }),
    ];
    const prompt = buildBatchPrompt(signals);
    expect(prompt).toContain("### Signal 1");
    expect(prompt).toContain("### Signal 2");
  });

  it("includes classification rules", () => {
    const prompt = buildBatchPrompt([makeSignal()]);
    expect(prompt).toContain("Classification Rules");
    expect(prompt).toContain("__init__.py");
    expect(prompt).toContain("verdict: expected");
  });

  it("requests JSON array response", () => {
    const prompt = buildBatchPrompt([makeSignal()]);
    expect(prompt).toContain("JSON array");
    expect(prompt).toContain("Return ONLY the JSON array");
  });
});

// --- Response parsing tests ---

describe("parseTriageResponse", () => {
  it("parses valid JSON response", () => {
    const signals = [makeSignal()];
    const response = JSON.stringify([{
      verdict: "actionable",
      action: "write_test",
      priority: "P1",
      reasoning: "Core auth logic needs tests",
      testHints: {
        testType: "unit",
        behaviors: ["login with valid credentials", "reject invalid password"],
        targetPath: "tests/auth.test.ts",
        framework: "vitest",
      },
    }]);

    const results = parseTriageResponse(response, signals);
    expect(results).toHaveLength(1);
    expect(results[0].signalId).toBe("spec_no_tests:spec:auth");
    expect(results[0].signalType).toBe("spec_no_tests");
    expect(results[0].verdict).toBe("actionable");
    expect(results[0].action).toBe("write_test");
    expect(results[0].priority).toBe("P1");
    expect(results[0].reasoning).toBe("Core auth logic needs tests");
    expect(results[0].testHints.behaviors).toEqual(["login with valid credentials", "reject invalid password"]);
  });

  it("parses JSON wrapped in markdown code blocks", () => {
    const signals = [makeSignal()];
    const response = '```json\n[{"verdict":"expected","action":"ignore","priority":"P3","reasoning":"Config file","testHints":{"testType":"unit","behaviors":[],"targetPath":"","framework":"vitest"}}]\n```';

    const results = parseTriageResponse(response, signals);
    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe("expected");
  });

  it("handles e2e signals with userActions", () => {
    const signal = makeSignal({
      id: "ui_spec_no_e2e:spec:dashboard",
      type: "ui_spec_no_e2e",
      testType: "e2e",
    });
    const response = JSON.stringify([{
      verdict: "actionable",
      action: "write_test",
      priority: "P2",
      reasoning: "Dashboard UI needs e2e test",
      testHints: {
        testType: "e2e",
        behaviors: ["toggle sidebar", "verify panel visibility"],
        targetPath: "e2e/dashboard.spec.ts",
        framework: "playwright",
        userActions: ["click sidebar toggle", "verify sidebar is visible", "click toggle again", "verify sidebar is hidden"],
      },
    }]);

    const results = parseTriageResponse(response, [signal]);
    expect(results[0].testHints.testType).toBe("e2e");
    expect(results[0].testHints.userActions).toEqual([
      "click sidebar toggle",
      "verify sidebar is visible",
      "click toggle again",
      "verify sidebar is hidden",
    ]);
  });

  it("handles API signals with apiContract", () => {
    const signal = makeSignal({
      id: "api_spec_no_test:spec:users-api",
      type: "api_spec_no_test",
      testType: "api",
    });
    const response = JSON.stringify([{
      verdict: "actionable",
      action: "write_test",
      priority: "P1",
      reasoning: "Users API endpoint needs tests",
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
    }]);

    const results = parseTriageResponse(response, [signal]);
    expect(results[0].testHints.apiContract).toEqual({
      method: "POST",
      path: "/api/users",
      expectedStatuses: [201, 409, 422],
    });
  });

  it("validates and defaults invalid verdict", () => {
    const response = JSON.stringify([{
      verdict: "banana",
      action: "write_test",
      priority: "P2",
      reasoning: "test",
      testHints: { testType: "unit", behaviors: [], targetPath: "", framework: "vitest" },
    }]);

    const results = parseTriageResponse(response, [makeSignal()]);
    expect(results[0].verdict).toBe("actionable"); // fallback
  });

  it("validates and defaults invalid action", () => {
    const response = JSON.stringify([{
      verdict: "actionable",
      action: "destroy_everything",
      priority: "P2",
      reasoning: "test",
      testHints: { testType: "unit", behaviors: [], targetPath: "", framework: "vitest" },
    }]);

    const results = parseTriageResponse(response, [makeSignal()]);
    expect(results[0].action).toBe("write_test"); // fallback
  });

  it("validates and defaults invalid priority", () => {
    const response = JSON.stringify([{
      verdict: "actionable",
      action: "write_test",
      priority: "P99",
      reasoning: "test",
      testHints: { testType: "unit", behaviors: [], targetPath: "", framework: "vitest" },
    }]);

    const results = parseTriageResponse(response, [makeSignal()]);
    expect(results[0].priority).toBe("P2"); // fallback
  });

  it("throws on non-JSON response", () => {
    expect(() =>
      parseTriageResponse("This is not JSON at all", [makeSignal()]),
    ).toThrow("Failed to parse triage response");
  });

  it("throws on non-array JSON", () => {
    expect(() =>
      parseTriageResponse('{"verdict": "actionable"}', [makeSignal()]),
    ).toThrow("not an array");
  });

  it("handles multiple signals in batch", () => {
    const signals = [
      makeSignal({ id: "s1", type: "spec_no_tests" }),
      makeSignal({ id: "s2", type: "file_no_tests" }),
      makeSignal({ id: "s3", type: "orphan_code" }),
    ];
    const response = JSON.stringify([
      { verdict: "actionable", action: "write_test", priority: "P1", reasoning: "r1", testHints: { testType: "unit", behaviors: ["b1"], targetPath: "t1", framework: "vitest" } },
      { verdict: "expected", action: "ignore", priority: "P3", reasoning: "r2", testHints: { testType: "unit", behaviors: [], targetPath: "", framework: "vitest" } },
      { verdict: "deferred", action: "write_test", priority: "P3", reasoning: "r3", testHints: { testType: "unit", behaviors: [], targetPath: "", framework: "vitest" } },
    ]);

    const results = parseTriageResponse(response, signals);
    expect(results).toHaveLength(3);
    expect(results[0].signalId).toBe("s1");
    expect(results[0].verdict).toBe("actionable");
    expect(results[1].signalId).toBe("s2");
    expect(results[1].verdict).toBe("expected");
    expect(results[2].signalId).toBe("s3");
    expect(results[2].verdict).toBe("deferred");
  });
});

// --- TriageEngine integration tests ---

describe("TriageEngine", () => {
  it("pre-filters expected files without LLM call", async () => {
    const db = new GraphDatabase("triage-prefilter", contextDir);
    const llm = mockLLM();

    // Create drift signals for expected-untested files
    db.upsertNode({ id: "file:src/__init__.py", type: "file", path: "src/__init__.py" });
    db.upsertNode({ id: "file:src/types.ts", type: "file", path: "src/types.ts" });

    const signals: DriftSignal[] = [
      makeSignal({ id: "file_no_tests:file:src/__init__.py", type: "file_no_tests", subject: { nodeId: "file:src/__init__.py", path: "src/__init__.py" } }),
      makeSignal({ id: "file_no_tests:file:src/types.ts", type: "file_no_tests", subject: { nodeId: "file:src/types.ts", path: "src/types.ts" } }),
    ];

    const engine = new TriageEngine(db, llm);
    const results = await engine.triage(signals);

    // Both should be classified as expected without LLM call
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.verdict === "expected")).toBe(true);
    expect(results.every((r) => r.action === "ignore")).toBe(true);
    expect(llm.calls).toHaveLength(0); // No LLM calls made

    db.close();
  });

  it("calls LLM for non-obvious signals", async () => {
    const db = new GraphDatabase("triage-llm", contextDir);
    const llm = mockLLM();

    const signals: DriftSignal[] = [
      makeSignal({
        id: "spec_no_tests:spec:auth",
        subject: { nodeId: "spec:auth", path: "docs/spec/auth.md", title: "Authentication" },
      }),
    ];

    const engine = new TriageEngine(db, llm);
    const results = await engine.triage(signals);

    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe("actionable");
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].prompt).toContain("spec_no_tests");

    db.close();
  });

  it("uses default model (haiku) when not specified", async () => {
    const db = new GraphDatabase("triage-model", contextDir);
    const llm = mockLLM();

    const signals: DriftSignal[] = [makeSignal()];

    const engine = new TriageEngine(db, llm);
    await engine.triage(signals);

    expect(llm.calls[0].model).toBe("claude-haiku-4-5-20251001");

    db.close();
  });

  it("uses custom model when specified", async () => {
    const db = new GraphDatabase("triage-custom-model", contextDir);
    const llm = mockLLM();

    const signals: DriftSignal[] = [makeSignal()];

    const engine = new TriageEngine(db, llm, { model: "claude-sonnet-4-6" });
    await engine.triage(signals);

    expect(llm.calls[0].model).toBe("claude-sonnet-4-6");

    db.close();
  });

  it("filters by test type", async () => {
    const db = new GraphDatabase("triage-filter-type", contextDir);
    const llm = mockLLM();

    const signals: DriftSignal[] = [
      makeSignal({ id: "s1", testType: "unit", subject: { nodeId: "s1", path: "src/auth.ts" } }),
      makeSignal({ id: "s2", testType: "e2e", type: "ui_spec_no_e2e", subject: { nodeId: "s2", path: "docs/spec/ui.md" } }),
      makeSignal({ id: "s3", testType: "api", type: "api_spec_no_test", subject: { nodeId: "s3", path: "docs/spec/api.md" } }),
    ];

    const engine = new TriageEngine(db, llm, { testType: "e2e" });
    const results = await engine.triage(signals);

    expect(results).toHaveLength(1);
    expect(results[0].signalId).toBe("s2");

    db.close();
  });

  it("respects maxSignals limit", async () => {
    const db = new GraphDatabase("triage-max", contextDir);
    const llm = mockLLM();

    const signals: DriftSignal[] = Array.from({ length: 10 }, (_, i) =>
      makeSignal({ id: `s${i}`, subject: { nodeId: `s${i}`, path: `src/file${i}.ts` } }),
    );

    const engine = new TriageEngine(db, llm, { maxSignals: 3 });
    const results = await engine.triage(signals);

    expect(results).toHaveLength(3);

    db.close();
  });

  it("filters by minimum severity", async () => {
    const db = new GraphDatabase("triage-min-sev", contextDir);
    const llm = mockLLM();

    const signals: DriftSignal[] = [
      makeSignal({ id: "s1", severity: 0.9, subject: { nodeId: "s1", path: "src/critical.ts" } }),
      makeSignal({ id: "s2", severity: 0.3, subject: { nodeId: "s2", path: "src/minor.ts" } }),
    ];

    const engine = new TriageEngine(db, llm, { minSeverity: 0.5 });
    const results = await engine.triage(signals);

    expect(results).toHaveLength(1);
    expect(results[0].signalId).toBe("s1");

    db.close();
  });

  it("stores triage results and skips already-triaged signals", async () => {
    const db = new GraphDatabase("triage-store", contextDir);
    const llm = mockLLM();

    const signals: DriftSignal[] = [
      makeSignal({ id: "s1", subject: { nodeId: "s1", path: "src/auth.ts" } }),
      makeSignal({ id: "s2", subject: { nodeId: "s2", path: "src/billing.ts" } }),
    ];

    // First triage
    const engine = new TriageEngine(db, llm);
    const results1 = await engine.triage(signals);
    expect(results1).toHaveLength(2);
    expect(llm.calls).toHaveLength(1);

    // Second triage with same signals — should skip
    const results2 = await engine.triage(signals);
    expect(results2).toHaveLength(0);
    expect(llm.calls).toHaveLength(1); // No additional LLM call

    db.close();
  });

  it("retrieves stored results", async () => {
    const db = new GraphDatabase("triage-retrieve", contextDir);
    const llm = mockLLM();

    const signals: DriftSignal[] = [
      makeSignal({ id: "s1", subject: { nodeId: "s1", path: "src/auth.ts" } }),
    ];

    const engine = new TriageEngine(db, llm);
    await engine.triage(signals);

    const stored = engine.getStoredResults();
    expect(stored).toHaveLength(1);
    expect(stored[0].signalId).toBe("s1");
    expect(stored[0].verdict).toBe("actionable");

    db.close();
  });

  it("handles mixed pre-filtered and LLM signals", async () => {
    const db = new GraphDatabase("triage-mixed", contextDir);
    const llm = mockLLM();

    const signals: DriftSignal[] = [
      makeSignal({ id: "s1", subject: { nodeId: "s1", path: "src/__init__.py" } }),
      makeSignal({ id: "s2", subject: { nodeId: "s2", path: "src/auth.ts", title: "Auth" } }),
      makeSignal({ id: "s3", subject: { nodeId: "s3", path: "vitest.config.ts" } }),
    ];

    const engine = new TriageEngine(db, llm);
    const results = await engine.triage(signals);

    expect(results).toHaveLength(3);

    // Pre-filtered
    const expected = results.filter((r) => r.verdict === "expected");
    expect(expected).toHaveLength(2);
    expect(expected.map((r) => r.signalId).sort()).toEqual(["s1", "s3"]);

    // LLM-triaged
    const actionable = results.filter((r) => r.verdict === "actionable");
    expect(actionable).toHaveLength(1);
    expect(actionable[0].signalId).toBe("s2");

    // Only one LLM call (for the non-prefiltered signal)
    expect(llm.calls).toHaveLength(1);

    db.close();
  });

  it("returns empty array when no signals provided", async () => {
    const db = new GraphDatabase("triage-empty", contextDir);
    const llm = mockLLM();

    const engine = new TriageEngine(db, llm);
    const results = await engine.triage([]);

    expect(results).toEqual([]);
    expect(llm.calls).toHaveLength(0);

    db.close();
  });
});

// --- Deduplication tests ---

describe("deduplication", () => {
  it("marks lower-severity duplicate signals for same file", async () => {
    const db = new GraphDatabase("triage-dedup", contextDir);

    // Return both as actionable — dedup should mark lower one
    const llm: LLMProvider = {
      async complete() {
        return JSON.stringify([
          { verdict: "actionable", action: "write_test", priority: "P1", reasoning: "r1", testHints: { testType: "unit", behaviors: ["b1"], targetPath: "t1", framework: "vitest" } },
          { verdict: "actionable", action: "write_test", priority: "P2", reasoning: "r2", testHints: { testType: "unit", behaviors: ["b2"], targetPath: "t2", framework: "vitest" } },
        ]);
      },
    };

    const signals: DriftSignal[] = [
      makeSignal({ id: "spec_no_tests:spec:auth", severity: 0.8, subject: { nodeId: "spec:auth", path: "docs/spec/auth.md" } }),
      makeSignal({ id: "file_no_tests:file:auth", type: "file_no_tests", severity: 0.3, subject: { nodeId: "file:auth", path: "docs/spec/auth.md" } }),
    ];

    const engine = new TriageEngine(db, llm);
    const results = await engine.triage(signals);

    expect(results).toHaveLength(2);
    const actionable = results.filter((r) => r.verdict === "actionable");
    const duplicates = results.filter((r) => r.verdict === "duplicate");
    expect(actionable).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
    expect(actionable[0].signalId).toBe("spec_no_tests:spec:auth"); // higher severity kept

    db.close();
  });
});

// --- E2E signal triage tests ---

describe("e2e signal triage", () => {
  it("triages UI spec signals with e2e test hints", async () => {
    const db = new GraphDatabase("triage-e2e", contextDir);

    const llm: LLMProvider = {
      async complete() {
        return JSON.stringify([{
          verdict: "actionable",
          action: "write_test",
          priority: "P2",
          reasoning: "Dashboard UI behavior needs e2e coverage",
          testHints: {
            testType: "e2e",
            behaviors: ["sidebar toggle", "panel visibility"],
            targetPath: "e2e/dashboard.spec.ts",
            framework: "playwright",
            userActions: ["click sidebar toggle button", "verify sidebar panel is visible"],
          },
        }]);
      },
    };

    const signals: DriftSignal[] = [
      makeSignal({
        id: "ui_spec_no_e2e:spec:dashboard",
        type: "ui_spec_no_e2e",
        testType: "e2e",
        subject: { nodeId: "spec:dashboard", path: "docs/spec/dashboard.md", title: "Dashboard UI" },
        context: {
          specContent: "Users click the sidebar toggle button to show/hide the navigation panel",
          scoringReason: "UI behavior detected",
        },
      }),
    ];

    const engine = new TriageEngine(db, llm);
    const results = await engine.triage(signals);

    expect(results).toHaveLength(1);
    expect(results[0].testHints.testType).toBe("e2e");
    expect(results[0].testHints.framework).toBe("playwright");
    expect(results[0].testHints.userActions).toBeDefined();
    expect(results[0].testHints.userActions!.length).toBeGreaterThan(0);

    db.close();
  });
});

// --- API signal triage tests ---

describe("api signal triage", () => {
  it("triages API spec signals with contract test hints", async () => {
    const db = new GraphDatabase("triage-api", contextDir);

    const llm: LLMProvider = {
      async complete() {
        return JSON.stringify([{
          verdict: "actionable",
          action: "write_test",
          priority: "P1",
          reasoning: "Users API endpoint has no test coverage",
          testHints: {
            testType: "api",
            behaviors: ["create user with valid data", "reject duplicate email", "validate required fields"],
            targetPath: "tests/api/users.test.ts",
            framework: "vitest",
            apiContract: {
              method: "POST",
              path: "/api/users",
              expectedStatuses: [201, 409, 422],
            },
          },
        }]);
      },
    };

    const signals: DriftSignal[] = [
      makeSignal({
        id: "api_spec_no_test:spec:users-api",
        type: "api_spec_no_test",
        testType: "api",
        severity: 0.7,
        subject: { nodeId: "spec:users-api", path: "docs/spec/users-api.md", title: "Users API" },
        context: {
          specContent: "POST /api/users creates a new user. Returns 201 on success, 409 if email exists, 422 for validation errors.",
          scoringReason: "API behavior detected",
        },
      }),
    ];

    const engine = new TriageEngine(db, llm);
    const results = await engine.triage(signals);

    expect(results).toHaveLength(1);
    expect(results[0].testHints.testType).toBe("api");
    expect(results[0].testHints.apiContract).toBeDefined();
    expect(results[0].testHints.apiContract!.method).toBe("POST");
    expect(results[0].testHints.apiContract!.path).toBe("/api/users");
    expect(results[0].testHints.apiContract!.expectedStatuses).toEqual([201, 409, 422]);

    db.close();
  });

  it("triages route_no_test signals", async () => {
    const db = new GraphDatabase("triage-route", contextDir);

    const llm: LLMProvider = {
      async complete() {
        return JSON.stringify([{
          verdict: "actionable",
          action: "write_test",
          priority: "P2",
          reasoning: "Route handler needs integration test",
          testHints: {
            testType: "api",
            behaviors: ["GET returns list of items", "handles pagination"],
            targetPath: "tests/routes/items.test.ts",
            framework: "vitest",
            apiContract: {
              method: "GET",
              path: "/api/items",
              expectedStatuses: [200],
            },
          },
        }]);
      },
    };

    const signals: DriftSignal[] = [
      makeSignal({
        id: "route_no_test:file:src/routes/items.ts",
        type: "route_no_test",
        testType: "api",
        subject: { nodeId: "file:src/routes/items.ts", path: "src/routes/items.ts", title: "items route" },
      }),
    ];

    const engine = new TriageEngine(db, llm);
    const results = await engine.triage(signals);

    expect(results).toHaveLength(1);
    expect(results[0].testHints.apiContract).toBeDefined();

    db.close();
  });
});

// --- Full integration with DriftEngine ---

describe("DriftEngine + TriageEngine integration", () => {
  it("filters drift signals down to actionable items", async () => {
    const db = new GraphDatabase("triage-integration", contextDir);

    // Set up a graph with mixed signals
    // Expected-untested files
    db.upsertNode({ id: "file:src/__init__.py", type: "file", path: "src/__init__.py" });
    db.upsertNode({ id: "file:src/types.ts", type: "file", path: "src/types.ts" });

    // Actionable: spec without tests
    db.upsertNode({ id: "spec:auth", type: "spec", title: "Authentication" });

    // Actionable: file without tests
    db.upsertNode({ id: "file:src/auth.ts", type: "file", path: "src/auth.ts" });

    // Covered file (should not appear in drift)
    db.upsertNode({ id: "file:src/utils.ts", type: "file", path: "src/utils.ts" });
    db.upsertNode({ id: "test:utils-test", type: "test", title: "utils-test" });
    db.upsertEdge({ source: "test:utils-test", target: "file:src/utils.ts", relation: "tests" });

    // Detect drift
    const driftEngine = new DriftEngine(db);
    const signals = await driftEngine.detect();
    expect(signals.length).toBeGreaterThan(0);

    // Mock LLM that returns actionable for non-expected signals
    const llm: LLMProvider = {
      async complete(prompt: string) {
        const signalCount = (prompt.match(/### Signal \d+/g) || []).length;
        const results = Array.from({ length: signalCount }, () => ({
          verdict: "actionable",
          action: "write_test",
          priority: "P2",
          reasoning: "Needs test coverage",
          testHints: {
            testType: "unit",
            behaviors: ["verify functionality"],
            targetPath: "tests/test.ts",
            framework: "vitest",
          },
        }));
        return JSON.stringify(results);
      },
    };

    const triageEngine = new TriageEngine(db, llm);
    const results = await triageEngine.triage(signals);

    // Expected files should be pre-filtered
    const expectedResults = results.filter((r) => r.verdict === "expected");
    expect(expectedResults.length).toBeGreaterThan(0);

    // All results should have valid structure
    for (const r of results) {
      expect(["actionable", "expected", "deferred", "duplicate"]).toContain(r.verdict);
      expect(["write_test", "update_test", "fix_test", "update_spec", "ignore"]).toContain(r.action);
      expect(["P1", "P2", "P3"]).toContain(r.priority);
      expect(r.reasoning).toBeDefined();
      expect(r.testHints).toBeDefined();
    }

    db.close();
  });
});
