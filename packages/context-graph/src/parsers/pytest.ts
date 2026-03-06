/**
 * Parser for pytest JSON report output.
 *
 * Expects output from pytest-json-report plugin:
 *   pytest --json-report --json-report-file=results.json
 */

import type { ParsedTestRun, TestResult } from "../core/schema.js";

interface PytestJsonReport {
  created: number;
  duration: number;
  exitcode: number;
  summary: {
    total?: number;
    passed?: number;
    failed?: number;
    skipped?: number;
    error?: number;
  };
  tests: Array<{
    nodeid: string;
    outcome: string; // "passed" | "failed" | "skipped" | "error"
    duration: number; // seconds
    setup?: { outcome: string; duration: number };
    call?: { outcome: string; duration: number; longrepr?: string; crash?: { message: string } };
    teardown?: { outcome: string; duration: number };
  }>;
}

export function parsePytest(content: string): ParsedTestRun {
  const report = JSON.parse(content) as PytestJsonReport;

  const results: TestResult[] = report.tests.map((t) => {
    const status = mapOutcome(t.outcome);
    let errorMsg: string | undefined;
    if (status === "fail" || status === "error") {
      errorMsg = t.call?.longrepr ?? t.call?.crash?.message;
      if (errorMsg && errorMsg.length > 500) {
        errorMsg = errorMsg.slice(0, 500);
      }
    }

    return {
      testId: `test:${t.nodeid}`,
      commitHash: "", // filled by ingestion
      runId: "", // filled by ingestion
      status,
      durationMs: Math.round(t.duration * 1000),
      errorMsg,
      timestamp: "", // filled by ingestion
    };
  });

  const summary = report.summary;
  const passed = summary.passed ?? 0;
  const failed = summary.failed ?? 0;
  const skipped = summary.skipped ?? 0;
  const errored = summary.error ?? 0;

  return {
    framework: "pytest",
    results,
    summary: {
      framework: "pytest",
      total: summary.total ?? results.length,
      passed,
      failed: failed + errored,
      skipped,
      durationMs: Math.round(report.duration * 1000),
    },
  };
}

function mapOutcome(outcome: string): TestResult["status"] {
  switch (outcome) {
    case "passed":
      return "pass";
    case "failed":
      return "fail";
    case "skipped":
      return "skip";
    default:
      return "error";
  }
}
