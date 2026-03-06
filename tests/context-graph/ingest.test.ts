import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  GraphDatabase,
  parsePytest,
  parseVitest,
  parseJunit,
  parseTestResults,
  detectFramework,
} from "@opcom/context-graph";

let contextDir: string;

beforeEach(() => {
  contextDir = mkdtempSync(join(tmpdir(), "cg-ingest-test-"));
});

afterEach(() => {
  rmSync(contextDir, { recursive: true, force: true });
});

// --- pytest parser ---

const PYTEST_JSON = JSON.stringify({
  created: 1709640000,
  duration: 2.5,
  exitcode: 1,
  summary: { total: 3, passed: 1, failed: 1, skipped: 1 },
  tests: [
    {
      nodeid: "tests/test_math.py::test_add",
      outcome: "passed",
      duration: 0.01,
      call: { outcome: "passed", duration: 0.01 },
    },
    {
      nodeid: "tests/test_math.py::test_divide",
      outcome: "failed",
      duration: 0.05,
      call: {
        outcome: "failed",
        duration: 0.05,
        longrepr: "AssertionError: expected 2 but got 0",
      },
    },
    {
      nodeid: "tests/test_math.py::test_multiply",
      outcome: "skipped",
      duration: 0.0,
    },
  ],
});

describe("parsePytest", () => {
  it("parses pytest JSON report", () => {
    const result = parsePytest(PYTEST_JSON);

    expect(result.framework).toBe("pytest");
    expect(result.results).toHaveLength(3);
    expect(result.summary.total).toBe(3);
    expect(result.summary.passed).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.skipped).toBe(1);

    const pass = result.results.find((r) => r.testId === "test:tests/test_math.py::test_add");
    expect(pass?.status).toBe("pass");
    expect(pass?.durationMs).toBe(10);

    const fail = result.results.find((r) => r.testId === "test:tests/test_math.py::test_divide");
    expect(fail?.status).toBe("fail");
    expect(fail?.errorMsg).toBe("AssertionError: expected 2 but got 0");

    const skip = result.results.find((r) => r.testId === "test:tests/test_math.py::test_multiply");
    expect(skip?.status).toBe("skip");
  });
});

// --- vitest parser ---

const VITEST_JSON = JSON.stringify({
  numTotalTestSuites: 1,
  numPassedTestSuites: 0,
  numFailedTestSuites: 1,
  numTotalTests: 3,
  numPassedTests: 2,
  numFailedTests: 1,
  numPendingTests: 0,
  startTime: 1709640000000,
  success: false,
  testResults: [
    {
      name: "tests/math.test.ts",
      status: "failed",
      startTime: 1709640000000,
      endTime: 1709640000500,
      assertionResults: [
        {
          ancestorTitles: ["math"],
          fullName: "math > adds numbers",
          status: "passed",
          title: "adds numbers",
          duration: 5,
          failureMessages: [],
        },
        {
          ancestorTitles: ["math"],
          fullName: "math > subtracts numbers",
          status: "passed",
          title: "subtracts numbers",
          duration: 3,
          failureMessages: [],
        },
        {
          ancestorTitles: ["math"],
          fullName: "math > divides by zero",
          status: "failed",
          title: "divides by zero",
          duration: 10,
          failureMessages: ["Error: division by zero"],
        },
      ],
    },
  ],
});

describe("parseVitest", () => {
  it("parses vitest JSON report", () => {
    const result = parseVitest(VITEST_JSON);

    expect(result.framework).toBe("vitest");
    expect(result.results).toHaveLength(3);
    expect(result.summary.total).toBe(3);
    expect(result.summary.passed).toBe(2);
    expect(result.summary.failed).toBe(1);

    const pass = result.results.find((r) => r.testId === "test:math > adds numbers");
    expect(pass?.status).toBe("pass");
    expect(pass?.durationMs).toBe(5);

    const fail = result.results.find((r) => r.testId === "test:math > divides by zero");
    expect(fail?.status).toBe("fail");
    expect(fail?.errorMsg).toBe("Error: division by zero");
  });
});

// --- JUnit XML parser ---

const JUNIT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="math" tests="3" failures="1" errors="0" skipped="1" time="0.5">
    <testcase classname="math" name="test_add" time="0.01" />
    <testcase classname="math" name="test_divide" time="0.05">
      <failure message="expected 2 got 0">AssertionError: expected 2 got 0</failure>
    </testcase>
    <testcase classname="math" name="test_skipped" time="0.0">
      <skipped />
    </testcase>
  </testsuite>
</testsuites>`;

describe("parseJunit", () => {
  it("parses JUnit XML", () => {
    const result = parseJunit(JUNIT_XML);

    expect(result.framework).toBe("junit");
    expect(result.results).toHaveLength(3);
    expect(result.summary.total).toBe(3);
    expect(result.summary.passed).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.skipped).toBe(1);

    const pass = result.results.find((r) => r.testId === "test:math::test_add");
    expect(pass?.status).toBe("pass");

    const fail = result.results.find((r) => r.testId === "test:math::test_divide");
    expect(fail?.status).toBe("fail");
    expect(fail?.errorMsg).toBe("expected 2 got 0");

    const skip = result.results.find((r) => r.testId === "test:math::test_skipped");
    expect(skip?.status).toBe("skip");
  });
});

// --- Auto-detection ---

describe("detectFramework", () => {
  it("detects pytest JSON", () => {
    expect(detectFramework(PYTEST_JSON)).toBe("pytest");
  });

  it("detects vitest JSON", () => {
    expect(detectFramework(VITEST_JSON)).toBe("vitest");
  });

  it("detects JUnit XML", () => {
    expect(detectFramework(JUNIT_XML)).toBe("junit");
  });

  it("returns undefined for unknown format", () => {
    expect(detectFramework("random text")).toBeUndefined();
  });
});

describe("parseTestResults", () => {
  it("auto-detects and parses pytest", () => {
    const result = parseTestResults(PYTEST_JSON);
    expect(result.framework).toBe("pytest");
    expect(result.results).toHaveLength(3);
  });

  it("uses explicit framework override", () => {
    const result = parseTestResults(VITEST_JSON, "vitest");
    expect(result.framework).toBe("vitest");
  });

  it("throws on undetectable format", () => {
    expect(() => parseTestResults("not valid")).toThrow("Could not detect");
  });
});

// --- Database ingestion ---

describe("database ingestion", () => {
  it("ingests test results and creates test nodes", () => {
    const db = new GraphDatabase("ingest-test", contextDir);

    db.ingestTestRun(
      [
        { testId: "test:math::add", commitHash: "abc123", runId: "run-1", status: "pass", durationMs: 10, timestamp: "2026-03-05T00:00:00Z" },
        { testId: "test:math::divide", commitHash: "abc123", runId: "run-1", status: "fail", durationMs: 50, errorMsg: "div by zero", timestamp: "2026-03-05T00:00:00Z" },
      ],
      {
        runId: "run-1",
        commitHash: "abc123",
        timestamp: "2026-03-05T00:00:00Z",
        framework: "pytest",
        total: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        durationMs: 60,
      },
    );

    // Test nodes exist
    const node = db.getNode("test:math::add");
    expect(node).toBeDefined();
    expect(node?.type).toBe("test");
    expect(node?.status).toBe("pass");

    // Can query test_results
    const failing = db.query("SELECT * FROM test_results WHERE status = 'fail'");
    expect(failing.rows).toHaveLength(1);

    // Run summary exists
    const summary = db.query("SELECT * FROM run_summary WHERE run_id = 'run-1'");
    expect(summary.rows).toHaveLength(1);

    db.close();
  });

  it("is idempotent — ingesting same run twice doesn't duplicate", () => {
    const db = new GraphDatabase("idempotent-test", contextDir);

    const results = [
      { testId: "test:a", commitHash: "abc", runId: "run-1", status: "pass" as const, durationMs: 10, timestamp: "2026-03-05T00:00:00Z" },
    ];
    const summary = {
      runId: "run-1",
      commitHash: "abc",
      timestamp: "2026-03-05T00:00:00Z",
      framework: "vitest",
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
    };

    db.ingestTestRun(results, summary);
    db.ingestTestRun(results, summary);

    const rows = db.query("SELECT * FROM test_results");
    expect(rows.rows).toHaveLength(1);

    const summaryRows = db.query("SELECT * FROM run_summary");
    expect(summaryRows.rows).toHaveLength(1);

    db.close();
  });

  it("tracks flaky tests", () => {
    const db = new GraphDatabase("flaky-test", contextDir);

    // Run 1: test passes
    db.ingestTestRun(
      [{ testId: "test:flaky", commitHash: "aaa", runId: "run-1", status: "pass", durationMs: 10, timestamp: new Date().toISOString() }],
      { runId: "run-1", commitHash: "aaa", timestamp: new Date().toISOString(), total: 1, passed: 1, failed: 0, skipped: 0 },
    );

    // Run 2: same test fails
    db.ingestTestRun(
      [{ testId: "test:flaky", commitHash: "bbb", runId: "run-2", status: "fail", durationMs: 15, timestamp: new Date().toISOString() }],
      { runId: "run-2", commitHash: "bbb", timestamp: new Date().toISOString(), total: 1, passed: 0, failed: 1, skipped: 0 },
    );

    const flaky = db.flakyTests(7);
    expect(flaky).toHaveLength(1);
    expect(flaky[0].testId).toBe("test:flaky");
    expect(flaky[0].passCount).toBe(1);
    expect(flaky[0].failCount).toBe(1);

    db.close();
  });

  it("tracks slowest tests", () => {
    const db = new GraphDatabase("slow-test", contextDir);

    db.ingestTestRun(
      [
        { testId: "test:fast", commitHash: "aaa", runId: "run-1", status: "pass", durationMs: 5, timestamp: "2026-03-05T00:00:00Z" },
        { testId: "test:slow", commitHash: "aaa", runId: "run-1", status: "pass", durationMs: 5000, timestamp: "2026-03-05T00:00:00Z" },
      ],
      { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-05T00:00:00Z", total: 2, passed: 2, failed: 0, skipped: 0 },
    );

    const slowest = db.slowestTests(10);
    expect(slowest).toHaveLength(2);
    expect(slowest[0].testId).toBe("test:slow");
    expect(slowest[0].avgMs).toBe(5000);

    db.close();
  });

  it("tracks coverage trend across runs", () => {
    const db = new GraphDatabase("trend-test", contextDir);

    db.ingestTestRun(
      [{ testId: "test:a", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" }],
      { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 1, passed: 1, failed: 0, skipped: 0 },
    );

    db.ingestTestRun(
      [
        { testId: "test:a", commitHash: "bbb", runId: "run-2", status: "pass", timestamp: "2026-03-02T00:00:00Z" },
        { testId: "test:b", commitHash: "bbb", runId: "run-2", status: "fail", timestamp: "2026-03-02T00:00:00Z" },
      ],
      { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 2, passed: 1, failed: 1, skipped: 0 },
    );

    const trend = db.coverageTrend();
    expect(trend).toHaveLength(2);
    // Most recent first
    expect(trend[0].runId).toBe("run-2");
    expect(trend[0].passed).toBe(1);
    expect(trend[0].failed).toBe(1);
    expect(trend[1].runId).toBe("run-1");
    expect(trend[1].passed).toBe(1);

    db.close();
  });

  it("detects new failures between runs", () => {
    const db = new GraphDatabase("new-fail-test", contextDir);

    // Run 1: both pass
    db.ingestTestRun(
      [
        { testId: "test:a", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" },
        { testId: "test:b", commitHash: "aaa", runId: "run-1", status: "pass", timestamp: "2026-03-01T00:00:00Z" },
      ],
      { runId: "run-1", commitHash: "aaa", timestamp: "2026-03-01T00:00:00Z", total: 2, passed: 2, failed: 0, skipped: 0 },
    );

    // Run 2: test:b fails
    db.ingestTestRun(
      [
        { testId: "test:a", commitHash: "bbb", runId: "run-2", status: "pass", timestamp: "2026-03-02T00:00:00Z" },
        { testId: "test:b", commitHash: "bbb", runId: "run-2", status: "fail", errorMsg: "broken", timestamp: "2026-03-02T00:00:00Z" },
      ],
      { runId: "run-2", commitHash: "bbb", timestamp: "2026-03-02T00:00:00Z", total: 2, passed: 1, failed: 1, skipped: 0 },
    );

    const newFails = db.newFailures("run-2");
    expect(newFails).toHaveLength(1);
    expect(newFails[0].testId).toBe("test:b");
    expect(newFails[0].errorMsg).toBe("broken");

    db.close();
  });
});
