/**
 * Test result parser registry with auto-detection.
 */

import type { ParsedTestRun } from "../core/schema.js";
import { parsePytest } from "./pytest.js";
import { parseVitest } from "./vitest.js";
import { parseJunit } from "./junit.js";

export { parsePytest } from "./pytest.js";
export { parseVitest } from "./vitest.js";
export { parseJunit } from "./junit.js";

export type Framework = "pytest" | "vitest" | "jest" | "junit";

const parsers: Record<Framework, (content: string) => ParsedTestRun> = {
  pytest: parsePytest,
  vitest: parseVitest,
  jest: parseVitest, // Jest and vitest share the same JSON format
  junit: parseJunit,
};

/** Detect the framework from file content. */
export function detectFramework(content: string): Framework | undefined {
  const trimmed = content.trimStart();

  // XML → JUnit
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<testsuites") || trimmed.startsWith("<testsuite")) {
    return "junit";
  }

  // JSON formats
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(content);
      // pytest-json-report has a "tests" array with "nodeid" fields
      if (Array.isArray(obj.tests) && obj.tests[0]?.nodeid !== undefined) {
        return "pytest";
      }
      // vitest/jest have testResults with assertionResults
      if (Array.isArray(obj.testResults) && obj.numTotalTests !== undefined) {
        return "vitest";
      }
    } catch {
      // not valid JSON
    }
  }

  return undefined;
}

/** Parse test results, auto-detecting framework if not specified. */
export function parseTestResults(content: string, framework?: Framework): ParsedTestRun {
  const detected = framework ?? detectFramework(content);
  if (!detected) {
    throw new Error("Could not detect test result format. Use --framework to specify.");
  }

  const parser = parsers[detected];
  return parser(content);
}
