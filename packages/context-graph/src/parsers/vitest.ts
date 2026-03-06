/**
 * Parser for vitest JSON reporter output.
 *
 * Expects output from: vitest run --reporter=json
 */

import type { ParsedTestRun, TestResult } from "../core/schema.js";

interface VitestJsonReport {
  numTotalTestSuites: number;
  numPassedTestSuites: number;
  numFailedTestSuites: number;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  startTime: number;
  success: boolean;
  testResults: Array<{
    name: string; // file path
    status: string;
    startTime: number;
    endTime: number;
    assertionResults: Array<{
      ancestorTitles: string[];
      fullName: string;
      status: string; // "passed" | "failed" | "pending" | "skipped"
      title: string;
      duration: number | null;
      failureMessages: string[];
    }>;
  }>;
}

export function parseVitest(content: string): ParsedTestRun {
  const report = JSON.parse(content) as VitestJsonReport;

  const results: TestResult[] = [];

  for (const suite of report.testResults) {
    for (const test of suite.assertionResults) {
      const status = mapStatus(test.status);
      let errorMsg: string | undefined;
      if (status === "fail" && test.failureMessages.length > 0) {
        errorMsg = test.failureMessages[0];
        if (errorMsg && errorMsg.length > 500) {
          errorMsg = errorMsg.slice(0, 500);
        }
      }

      results.push({
        testId: `test:${test.fullName}`,
        commitHash: "",
        runId: "",
        status,
        durationMs: test.duration ?? undefined,
        errorMsg,
        timestamp: "",
      });
    }
  }

  const totalDuration = report.testResults.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);

  return {
    framework: "vitest",
    results,
    summary: {
      framework: "vitest",
      total: report.numTotalTests,
      passed: report.numPassedTests,
      failed: report.numFailedTests,
      skipped: report.numPendingTests,
      durationMs: totalDuration,
    },
  };
}

function mapStatus(status: string): TestResult["status"] {
  switch (status) {
    case "passed":
      return "pass";
    case "failed":
      return "fail";
    case "pending":
    case "skipped":
      return "skip";
    default:
      return "error";
  }
}
