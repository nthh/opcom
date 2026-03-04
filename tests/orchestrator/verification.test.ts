import { describe, it, expect } from "vitest";
import { parseTestOutput } from "../../packages/core/src/orchestrator/executor.js";

describe("parseTestOutput", () => {
  it("parses vitest output with all passing", () => {
    const output = `
 Test Files  55 passed (55)
      Tests  857 passed (857)
   Start at  17:37:33
   Duration  19.76s
`;
    const result = parseTestOutput(output);
    expect(result.total).toBe(857);
    expect(result.passed).toBe(857);
    expect(result.failed).toBe(0);
  });

  it("parses vitest output with failures", () => {
    const output = `
 Test Files  1 failed | 54 passed (55)
      Tests  3 failed | 854 passed (857)
   Start at  17:37:33
`;
    const result = parseTestOutput(output);
    expect(result.total).toBe(857);
    expect(result.passed).toBe(854);
    expect(result.failed).toBe(3);
  });

  it("parses jest output with all passing", () => {
    const output = `
Test Suites: 12 passed, 12 total
Tests:       45 passed, 45 total
`;
    const result = parseTestOutput(output);
    expect(result.total).toBe(45);
    expect(result.passed).toBe(45);
    expect(result.failed).toBe(0);
  });

  it("parses jest output with failures", () => {
    const output = `
Test Suites: 2 failed, 10 passed, 12 total
Tests:       5 failed, 40 passed, 45 total
`;
    const result = parseTestOutput(output);
    expect(result.total).toBe(45);
    expect(result.passed).toBe(40);
    expect(result.failed).toBe(5);
  });

  it("parses mocha output", () => {
    const output = `
  30 passing (2s)
  2 failing
`;
    const result = parseTestOutput(output);
    expect(result.total).toBe(32);
    expect(result.passed).toBe(30);
    expect(result.failed).toBe(2);
  });

  it("parses mocha output with only passing", () => {
    const output = `  15 passing (1s)`;
    const result = parseTestOutput(output);
    expect(result.total).toBe(15);
    expect(result.passed).toBe(15);
    expect(result.failed).toBe(0);
  });

  it("returns zeros for unrecognized output", () => {
    const result = parseTestOutput("some random output");
    expect(result.total).toBe(0);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
  });
});
