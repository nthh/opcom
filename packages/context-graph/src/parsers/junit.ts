/**
 * Parser for JUnit XML output.
 *
 * Universal format supported by most test frameworks:
 *   pytest --junitxml=results.xml
 *   go test -v 2>&1 | go-junit-report
 *   mvn test (surefire plugin)
 */

import type { ParsedTestRun, TestResult } from "../core/schema.js";

export function parseJunit(content: string): ParsedTestRun {
  const results: TestResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalDuration = 0;

  // Parse <testsuite> elements
  const suiteRegex = /<testsuite\s[^>]*>/g;
  const testcaseRegex = /<testcase\s[^>]*?(?:\/>|>[\s\S]*?<\/testcase>)/g;

  // Get all testcases
  const testcases = content.match(testcaseRegex) ?? [];

  for (const tc of testcases) {
    const name = getAttr(tc, "name") ?? "unknown";
    const classname = getAttr(tc, "classname") ?? "";
    const time = getAttr(tc, "time");
    const durationMs = time ? Math.round(parseFloat(time) * 1000) : undefined;

    if (durationMs !== undefined) {
      totalDuration += durationMs;
    }

    const testId = classname ? `test:${classname}::${name}` : `test:${name}`;

    // Determine status from child elements
    let status: TestResult["status"] = "pass";
    let errorMsg: string | undefined;

    if (/<failure[\s>]/i.test(tc)) {
      status = "fail";
      totalFailed++;
      errorMsg = extractElementText(tc, "failure");
    } else if (/<error[\s>]/i.test(tc)) {
      status = "error";
      totalErrors++;
      errorMsg = extractElementText(tc, "error");
    } else if (/<skipped[\s>/]/i.test(tc)) {
      status = "skip";
      totalSkipped++;
    } else {
      totalPassed++;
    }

    if (errorMsg && errorMsg.length > 500) {
      errorMsg = errorMsg.slice(0, 500);
    }

    results.push({
      testId,
      commitHash: "",
      runId: "",
      status,
      durationMs,
      errorMsg,
      timestamp: "",
    });
  }

  // Also try to get summary from testsuite attributes
  const suiteMatch = suiteRegex.exec(content);
  if (suiteMatch) {
    const suiteTag = suiteMatch[0];
    const suiteDuration = getAttr(suiteTag, "time");
    if (suiteDuration) {
      totalDuration = Math.round(parseFloat(suiteDuration) * 1000);
    }
  }

  return {
    framework: "junit",
    results,
    summary: {
      framework: "junit",
      total: results.length,
      passed: totalPassed,
      failed: totalFailed + totalErrors,
      skipped: totalSkipped,
      durationMs: totalDuration,
    },
  };
}

function getAttr(xml: string, name: string): string | undefined {
  const regex = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i");
  const match = regex.exec(xml);
  return match?.[1];
}

function extractElementText(xml: string, element: string): string | undefined {
  // Try message attribute first
  const msgAttrRegex = new RegExp(`<${element}[^>]*?message="([^"]*)"`, "i");
  const msgAttr = msgAttrRegex.exec(xml);

  // Try text content
  const textRegex = new RegExp(`<${element}[^>]*>([\\s\\S]*?)</${element}>`, "i");
  const textMatch = textRegex.exec(xml);

  return msgAttr?.[1] ?? textMatch?.[1]?.trim();
}
