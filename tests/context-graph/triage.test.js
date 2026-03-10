"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const context_graph_1 = require("@opcom/context-graph");
let contextDir;
(0, vitest_1.beforeEach)(() => {
    contextDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "cg-triage-ctx-"));
});
(0, vitest_1.afterEach)(() => {
    (0, node_fs_1.rmSync)(contextDir, { recursive: true, force: true });
});
// --- Mock LLM provider ---
function mockLLM(responseMap) {
    const calls = [];
    return {
        calls,
        async complete(prompt, model) {
            calls.push({ prompt, model });
            // If a specific response map is provided, match by signal type mentioned in prompt
            if (responseMap) {
                for (const [key, val] of Object.entries(responseMap)) {
                    if (prompt.includes(key))
                        return val;
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
function makeSignal(overrides = {}) {
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
(0, vitest_1.describe)("isExpectedUntested", () => {
    (0, vitest_1.it)("identifies Python init files", () => {
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("src/__init__.py")).toBe(true);
    });
    (0, vitest_1.it)("identifies conftest files", () => {
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("tests/conftest.py")).toBe(true);
    });
    (0, vitest_1.it)("identifies TypeScript type files", () => {
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("src/types.ts")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("src/api.d.ts")).toBe(true);
    });
    (0, vitest_1.it)("identifies config files", () => {
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("vitest.config.ts")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("eslint.config.mjs")).toBe(true);
    });
    (0, vitest_1.it)("identifies migration files", () => {
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("db/migrations/001_create_users.sql")).toBe(true);
    });
    (0, vitest_1.it)("identifies generated files", () => {
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("src/api.generated.ts")).toBe(true);
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("src/schema.gen.ts")).toBe(true);
    });
    (0, vitest_1.it)("identifies lock files", () => {
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("package-lock.json")).toBe(false); // .json not in patterns
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("yarn.lock")).toBe(true);
    });
    (0, vitest_1.it)("returns false for regular source files", () => {
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("src/auth.ts")).toBe(false);
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("src/utils.py")).toBe(false);
        (0, vitest_1.expect)((0, context_graph_1.isExpectedUntested)("src/components/Button.tsx")).toBe(false);
    });
});
// --- Prompt building tests ---
(0, vitest_1.describe)("buildBatchPrompt", () => {
    (0, vitest_1.it)("includes signal details in prompt", () => {
        const signal = makeSignal();
        const prompt = (0, context_graph_1.buildBatchPrompt)([signal]);
        (0, vitest_1.expect)(prompt).toContain("spec_no_tests");
        (0, vitest_1.expect)(prompt).toContain("docs/spec/auth.md");
        (0, vitest_1.expect)(prompt).toContain("Authentication");
        (0, vitest_1.expect)(prompt).toContain("0.6");
    });
    (0, vitest_1.it)("includes spec content when available", () => {
        const signal = makeSignal({
            context: {
                specContent: "Users can log in with email and password",
                scoringReason: "test",
            },
        });
        const prompt = (0, context_graph_1.buildBatchPrompt)([signal]);
        (0, vitest_1.expect)(prompt).toContain("Users can log in with email and password");
    });
    (0, vitest_1.it)("includes source code when available", () => {
        const signal = makeSignal({
            context: {
                sourceCode: "export function authenticate() { ... }",
                scoringReason: "test",
            },
        });
        const prompt = (0, context_graph_1.buildBatchPrompt)([signal]);
        (0, vitest_1.expect)(prompt).toContain("export function authenticate()");
    });
    (0, vitest_1.it)("includes existing test code when available", () => {
        const signal = makeSignal({
            context: {
                testCode: "it('should authenticate', () => { ... })",
                scoringReason: "test",
            },
        });
        const prompt = (0, context_graph_1.buildBatchPrompt)([signal]);
        (0, vitest_1.expect)(prompt).toContain("should authenticate");
    });
    (0, vitest_1.it)("numbers multiple signals correctly", () => {
        const signals = [
            makeSignal({ id: "spec_no_tests:spec:auth" }),
            makeSignal({ id: "file_no_tests:file:utils", type: "file_no_tests" }),
        ];
        const prompt = (0, context_graph_1.buildBatchPrompt)(signals);
        (0, vitest_1.expect)(prompt).toContain("### Signal 1");
        (0, vitest_1.expect)(prompt).toContain("### Signal 2");
    });
    (0, vitest_1.it)("includes classification rules", () => {
        const prompt = (0, context_graph_1.buildBatchPrompt)([makeSignal()]);
        (0, vitest_1.expect)(prompt).toContain("Classification Rules");
        (0, vitest_1.expect)(prompt).toContain("__init__.py");
        (0, vitest_1.expect)(prompt).toContain("verdict: expected");
    });
    (0, vitest_1.it)("requests JSON array response", () => {
        const prompt = (0, context_graph_1.buildBatchPrompt)([makeSignal()]);
        (0, vitest_1.expect)(prompt).toContain("JSON array");
        (0, vitest_1.expect)(prompt).toContain("Return ONLY the JSON array");
    });
});
// --- Response parsing tests ---
(0, vitest_1.describe)("parseTriageResponse", () => {
    (0, vitest_1.it)("parses valid JSON response", () => {
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
        const results = (0, context_graph_1.parseTriageResponse)(response, signals);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].signalId).toBe("spec_no_tests:spec:auth");
        (0, vitest_1.expect)(results[0].signalType).toBe("spec_no_tests");
        (0, vitest_1.expect)(results[0].verdict).toBe("actionable");
        (0, vitest_1.expect)(results[0].action).toBe("write_test");
        (0, vitest_1.expect)(results[0].priority).toBe("P1");
        (0, vitest_1.expect)(results[0].reasoning).toBe("Core auth logic needs tests");
        (0, vitest_1.expect)(results[0].testHints.behaviors).toEqual(["login with valid credentials", "reject invalid password"]);
    });
    (0, vitest_1.it)("parses JSON wrapped in markdown code blocks", () => {
        const signals = [makeSignal()];
        const response = '```json\n[{"verdict":"expected","action":"ignore","priority":"P3","reasoning":"Config file","testHints":{"testType":"unit","behaviors":[],"targetPath":"","framework":"vitest"}}]\n```';
        const results = (0, context_graph_1.parseTriageResponse)(response, signals);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].verdict).toBe("expected");
    });
    (0, vitest_1.it)("handles e2e signals with userActions", () => {
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
        const results = (0, context_graph_1.parseTriageResponse)(response, [signal]);
        (0, vitest_1.expect)(results[0].testHints.testType).toBe("e2e");
        (0, vitest_1.expect)(results[0].testHints.userActions).toEqual([
            "click sidebar toggle",
            "verify sidebar is visible",
            "click toggle again",
            "verify sidebar is hidden",
        ]);
    });
    (0, vitest_1.it)("handles API signals with apiContract", () => {
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
        const results = (0, context_graph_1.parseTriageResponse)(response, [signal]);
        (0, vitest_1.expect)(results[0].testHints.apiContract).toEqual({
            method: "POST",
            path: "/api/users",
            expectedStatuses: [201, 409, 422],
        });
    });
    (0, vitest_1.it)("validates and defaults invalid verdict", () => {
        const response = JSON.stringify([{
                verdict: "banana",
                action: "write_test",
                priority: "P2",
                reasoning: "test",
                testHints: { testType: "unit", behaviors: [], targetPath: "", framework: "vitest" },
            }]);
        const results = (0, context_graph_1.parseTriageResponse)(response, [makeSignal()]);
        (0, vitest_1.expect)(results[0].verdict).toBe("actionable"); // fallback
    });
    (0, vitest_1.it)("validates and defaults invalid action", () => {
        const response = JSON.stringify([{
                verdict: "actionable",
                action: "destroy_everything",
                priority: "P2",
                reasoning: "test",
                testHints: { testType: "unit", behaviors: [], targetPath: "", framework: "vitest" },
            }]);
        const results = (0, context_graph_1.parseTriageResponse)(response, [makeSignal()]);
        (0, vitest_1.expect)(results[0].action).toBe("write_test"); // fallback
    });
    (0, vitest_1.it)("validates and defaults invalid priority", () => {
        const response = JSON.stringify([{
                verdict: "actionable",
                action: "write_test",
                priority: "P99",
                reasoning: "test",
                testHints: { testType: "unit", behaviors: [], targetPath: "", framework: "vitest" },
            }]);
        const results = (0, context_graph_1.parseTriageResponse)(response, [makeSignal()]);
        (0, vitest_1.expect)(results[0].priority).toBe("P2"); // fallback
    });
    (0, vitest_1.it)("throws on non-JSON response", () => {
        (0, vitest_1.expect)(() => (0, context_graph_1.parseTriageResponse)("This is not JSON at all", [makeSignal()])).toThrow("Failed to parse triage response");
    });
    (0, vitest_1.it)("throws on non-array JSON", () => {
        (0, vitest_1.expect)(() => (0, context_graph_1.parseTriageResponse)('{"verdict": "actionable"}', [makeSignal()])).toThrow("not an array");
    });
    (0, vitest_1.it)("handles multiple signals in batch", () => {
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
        const results = (0, context_graph_1.parseTriageResponse)(response, signals);
        (0, vitest_1.expect)(results).toHaveLength(3);
        (0, vitest_1.expect)(results[0].signalId).toBe("s1");
        (0, vitest_1.expect)(results[0].verdict).toBe("actionable");
        (0, vitest_1.expect)(results[1].signalId).toBe("s2");
        (0, vitest_1.expect)(results[1].verdict).toBe("expected");
        (0, vitest_1.expect)(results[2].signalId).toBe("s3");
        (0, vitest_1.expect)(results[2].verdict).toBe("deferred");
    });
});
// --- TriageEngine integration tests ---
(0, vitest_1.describe)("TriageEngine", () => {
    (0, vitest_1.it)("pre-filters expected files without LLM call", async () => {
        const db = new context_graph_1.GraphDatabase("triage-prefilter", contextDir);
        const llm = mockLLM();
        // Create drift signals for expected-untested files
        db.upsertNode({ id: "file:src/__init__.py", type: "file", path: "src/__init__.py" });
        db.upsertNode({ id: "file:src/types.ts", type: "file", path: "src/types.ts" });
        const signals = [
            makeSignal({ id: "file_no_tests:file:src/__init__.py", type: "file_no_tests", subject: { nodeId: "file:src/__init__.py", path: "src/__init__.py" } }),
            makeSignal({ id: "file_no_tests:file:src/types.ts", type: "file_no_tests", subject: { nodeId: "file:src/types.ts", path: "src/types.ts" } }),
        ];
        const engine = new context_graph_1.TriageEngine(db, llm);
        const results = await engine.triage(signals);
        // Both should be classified as expected without LLM call
        (0, vitest_1.expect)(results).toHaveLength(2);
        (0, vitest_1.expect)(results.every((r) => r.verdict === "expected")).toBe(true);
        (0, vitest_1.expect)(results.every((r) => r.action === "ignore")).toBe(true);
        (0, vitest_1.expect)(llm.calls).toHaveLength(0); // No LLM calls made
        db.close();
    });
    (0, vitest_1.it)("calls LLM for non-obvious signals", async () => {
        const db = new context_graph_1.GraphDatabase("triage-llm", contextDir);
        const llm = mockLLM();
        const signals = [
            makeSignal({
                id: "spec_no_tests:spec:auth",
                subject: { nodeId: "spec:auth", path: "docs/spec/auth.md", title: "Authentication" },
            }),
        ];
        const engine = new context_graph_1.TriageEngine(db, llm);
        const results = await engine.triage(signals);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].verdict).toBe("actionable");
        (0, vitest_1.expect)(llm.calls).toHaveLength(1);
        (0, vitest_1.expect)(llm.calls[0].prompt).toContain("spec_no_tests");
        db.close();
    });
    (0, vitest_1.it)("uses default model (haiku) when not specified", async () => {
        const db = new context_graph_1.GraphDatabase("triage-model", contextDir);
        const llm = mockLLM();
        const signals = [makeSignal()];
        const engine = new context_graph_1.TriageEngine(db, llm);
        await engine.triage(signals);
        (0, vitest_1.expect)(llm.calls[0].model).toBe("claude-haiku-4-5-20251001");
        db.close();
    });
    (0, vitest_1.it)("uses custom model when specified", async () => {
        const db = new context_graph_1.GraphDatabase("triage-custom-model", contextDir);
        const llm = mockLLM();
        const signals = [makeSignal()];
        const engine = new context_graph_1.TriageEngine(db, llm, { model: "claude-sonnet-4-6" });
        await engine.triage(signals);
        (0, vitest_1.expect)(llm.calls[0].model).toBe("claude-sonnet-4-6");
        db.close();
    });
    (0, vitest_1.it)("filters by test type", async () => {
        const db = new context_graph_1.GraphDatabase("triage-filter-type", contextDir);
        const llm = mockLLM();
        const signals = [
            makeSignal({ id: "s1", testType: "unit", subject: { nodeId: "s1", path: "src/auth.ts" } }),
            makeSignal({ id: "s2", testType: "e2e", type: "ui_spec_no_e2e", subject: { nodeId: "s2", path: "docs/spec/ui.md" } }),
            makeSignal({ id: "s3", testType: "api", type: "api_spec_no_test", subject: { nodeId: "s3", path: "docs/spec/api.md" } }),
        ];
        const engine = new context_graph_1.TriageEngine(db, llm, { testType: "e2e" });
        const results = await engine.triage(signals);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].signalId).toBe("s2");
        db.close();
    });
    (0, vitest_1.it)("respects maxSignals limit", async () => {
        const db = new context_graph_1.GraphDatabase("triage-max", contextDir);
        const llm = mockLLM();
        const signals = Array.from({ length: 10 }, (_, i) => makeSignal({ id: `s${i}`, subject: { nodeId: `s${i}`, path: `src/file${i}.ts` } }));
        const engine = new context_graph_1.TriageEngine(db, llm, { maxSignals: 3 });
        const results = await engine.triage(signals);
        (0, vitest_1.expect)(results).toHaveLength(3);
        db.close();
    });
    (0, vitest_1.it)("filters by minimum severity", async () => {
        const db = new context_graph_1.GraphDatabase("triage-min-sev", contextDir);
        const llm = mockLLM();
        const signals = [
            makeSignal({ id: "s1", severity: 0.9, subject: { nodeId: "s1", path: "src/critical.ts" } }),
            makeSignal({ id: "s2", severity: 0.3, subject: { nodeId: "s2", path: "src/minor.ts" } }),
        ];
        const engine = new context_graph_1.TriageEngine(db, llm, { minSeverity: 0.5 });
        const results = await engine.triage(signals);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].signalId).toBe("s1");
        db.close();
    });
    (0, vitest_1.it)("stores triage results and skips already-triaged signals", async () => {
        const db = new context_graph_1.GraphDatabase("triage-store", contextDir);
        const llm = mockLLM();
        const signals = [
            makeSignal({ id: "s1", subject: { nodeId: "s1", path: "src/auth.ts" } }),
            makeSignal({ id: "s2", subject: { nodeId: "s2", path: "src/billing.ts" } }),
        ];
        // First triage
        const engine = new context_graph_1.TriageEngine(db, llm);
        const results1 = await engine.triage(signals);
        (0, vitest_1.expect)(results1).toHaveLength(2);
        (0, vitest_1.expect)(llm.calls).toHaveLength(1);
        // Second triage with same signals — should skip
        const results2 = await engine.triage(signals);
        (0, vitest_1.expect)(results2).toHaveLength(0);
        (0, vitest_1.expect)(llm.calls).toHaveLength(1); // No additional LLM call
        db.close();
    });
    (0, vitest_1.it)("retrieves stored results", async () => {
        const db = new context_graph_1.GraphDatabase("triage-retrieve", contextDir);
        const llm = mockLLM();
        const signals = [
            makeSignal({ id: "s1", subject: { nodeId: "s1", path: "src/auth.ts" } }),
        ];
        const engine = new context_graph_1.TriageEngine(db, llm);
        await engine.triage(signals);
        const stored = engine.getStoredResults();
        (0, vitest_1.expect)(stored).toHaveLength(1);
        (0, vitest_1.expect)(stored[0].signalId).toBe("s1");
        (0, vitest_1.expect)(stored[0].verdict).toBe("actionable");
        db.close();
    });
    (0, vitest_1.it)("handles mixed pre-filtered and LLM signals", async () => {
        const db = new context_graph_1.GraphDatabase("triage-mixed", contextDir);
        const llm = mockLLM();
        const signals = [
            makeSignal({ id: "s1", subject: { nodeId: "s1", path: "src/__init__.py" } }),
            makeSignal({ id: "s2", subject: { nodeId: "s2", path: "src/auth.ts", title: "Auth" } }),
            makeSignal({ id: "s3", subject: { nodeId: "s3", path: "vitest.config.ts" } }),
        ];
        const engine = new context_graph_1.TriageEngine(db, llm);
        const results = await engine.triage(signals);
        (0, vitest_1.expect)(results).toHaveLength(3);
        // Pre-filtered
        const expected = results.filter((r) => r.verdict === "expected");
        (0, vitest_1.expect)(expected).toHaveLength(2);
        (0, vitest_1.expect)(expected.map((r) => r.signalId).sort()).toEqual(["s1", "s3"]);
        // LLM-triaged
        const actionable = results.filter((r) => r.verdict === "actionable");
        (0, vitest_1.expect)(actionable).toHaveLength(1);
        (0, vitest_1.expect)(actionable[0].signalId).toBe("s2");
        // Only one LLM call (for the non-prefiltered signal)
        (0, vitest_1.expect)(llm.calls).toHaveLength(1);
        db.close();
    });
    (0, vitest_1.it)("returns empty array when no signals provided", async () => {
        const db = new context_graph_1.GraphDatabase("triage-empty", contextDir);
        const llm = mockLLM();
        const engine = new context_graph_1.TriageEngine(db, llm);
        const results = await engine.triage([]);
        (0, vitest_1.expect)(results).toEqual([]);
        (0, vitest_1.expect)(llm.calls).toHaveLength(0);
        db.close();
    });
});
// --- Deduplication tests ---
(0, vitest_1.describe)("deduplication", () => {
    (0, vitest_1.it)("marks lower-severity duplicate signals for same file", async () => {
        const db = new context_graph_1.GraphDatabase("triage-dedup", contextDir);
        // Return both as actionable — dedup should mark lower one
        const llm = {
            async complete() {
                return JSON.stringify([
                    { verdict: "actionable", action: "write_test", priority: "P1", reasoning: "r1", testHints: { testType: "unit", behaviors: ["b1"], targetPath: "t1", framework: "vitest" } },
                    { verdict: "actionable", action: "write_test", priority: "P2", reasoning: "r2", testHints: { testType: "unit", behaviors: ["b2"], targetPath: "t2", framework: "vitest" } },
                ]);
            },
        };
        const signals = [
            makeSignal({ id: "spec_no_tests:spec:auth", severity: 0.8, subject: { nodeId: "spec:auth", path: "docs/spec/auth.md" } }),
            makeSignal({ id: "file_no_tests:file:auth", type: "file_no_tests", severity: 0.3, subject: { nodeId: "file:auth", path: "docs/spec/auth.md" } }),
        ];
        const engine = new context_graph_1.TriageEngine(db, llm);
        const results = await engine.triage(signals);
        (0, vitest_1.expect)(results).toHaveLength(2);
        const actionable = results.filter((r) => r.verdict === "actionable");
        const duplicates = results.filter((r) => r.verdict === "duplicate");
        (0, vitest_1.expect)(actionable).toHaveLength(1);
        (0, vitest_1.expect)(duplicates).toHaveLength(1);
        (0, vitest_1.expect)(actionable[0].signalId).toBe("spec_no_tests:spec:auth"); // higher severity kept
        db.close();
    });
});
// --- E2E signal triage tests ---
(0, vitest_1.describe)("e2e signal triage", () => {
    (0, vitest_1.it)("triages UI spec signals with e2e test hints", async () => {
        const db = new context_graph_1.GraphDatabase("triage-e2e", contextDir);
        const llm = {
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
        const signals = [
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
        const engine = new context_graph_1.TriageEngine(db, llm);
        const results = await engine.triage(signals);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].testHints.testType).toBe("e2e");
        (0, vitest_1.expect)(results[0].testHints.framework).toBe("playwright");
        (0, vitest_1.expect)(results[0].testHints.userActions).toBeDefined();
        (0, vitest_1.expect)(results[0].testHints.userActions.length).toBeGreaterThan(0);
        db.close();
    });
});
// --- API signal triage tests ---
(0, vitest_1.describe)("api signal triage", () => {
    (0, vitest_1.it)("triages API spec signals with contract test hints", async () => {
        const db = new context_graph_1.GraphDatabase("triage-api", contextDir);
        const llm = {
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
        const signals = [
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
        const engine = new context_graph_1.TriageEngine(db, llm);
        const results = await engine.triage(signals);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].testHints.testType).toBe("api");
        (0, vitest_1.expect)(results[0].testHints.apiContract).toBeDefined();
        (0, vitest_1.expect)(results[0].testHints.apiContract.method).toBe("POST");
        (0, vitest_1.expect)(results[0].testHints.apiContract.path).toBe("/api/users");
        (0, vitest_1.expect)(results[0].testHints.apiContract.expectedStatuses).toEqual([201, 409, 422]);
        db.close();
    });
    (0, vitest_1.it)("triages route_no_test signals", async () => {
        const db = new context_graph_1.GraphDatabase("triage-route", contextDir);
        const llm = {
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
        const signals = [
            makeSignal({
                id: "route_no_test:file:src/routes/items.ts",
                type: "route_no_test",
                testType: "api",
                subject: { nodeId: "file:src/routes/items.ts", path: "src/routes/items.ts", title: "items route" },
            }),
        ];
        const engine = new context_graph_1.TriageEngine(db, llm);
        const results = await engine.triage(signals);
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].testHints.apiContract).toBeDefined();
        db.close();
    });
});
// --- Full integration with DriftEngine ---
(0, vitest_1.describe)("DriftEngine + TriageEngine integration", () => {
    (0, vitest_1.it)("filters drift signals down to actionable items", async () => {
        const db = new context_graph_1.GraphDatabase("triage-integration", contextDir);
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
        const driftEngine = new context_graph_1.DriftEngine(db);
        const signals = await driftEngine.detect();
        (0, vitest_1.expect)(signals.length).toBeGreaterThan(0);
        // Mock LLM that returns actionable for non-expected signals
        const llm = {
            async complete(prompt) {
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
        const triageEngine = new context_graph_1.TriageEngine(db, llm);
        const results = await triageEngine.triage(signals);
        // Expected files should be pre-filtered
        const expectedResults = results.filter((r) => r.verdict === "expected");
        (0, vitest_1.expect)(expectedResults.length).toBeGreaterThan(0);
        // All results should have valid structure
        for (const r of results) {
            (0, vitest_1.expect)(["actionable", "expected", "deferred", "duplicate"]).toContain(r.verdict);
            (0, vitest_1.expect)(["write_test", "update_test", "fix_test", "update_spec", "ignore"]).toContain(r.action);
            (0, vitest_1.expect)(["P1", "P2", "P3"]).toContain(r.priority);
            (0, vitest_1.expect)(r.reasoning).toBeDefined();
            (0, vitest_1.expect)(r.testHints).toBeDefined();
        }
        db.close();
    });
});
//# sourceMappingURL=triage.test.js.map