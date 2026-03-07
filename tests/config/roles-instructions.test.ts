import { describe, it, expect } from "vitest";
import { BUILTIN_ROLES } from "@opcom/core";

describe("Engineer role instructions (test responsibility split)", () => {
  const engineer = BUILTIN_ROLES.engineer;

  it("contains instruction to run relevant tests only", () => {
    expect(engineer.instructions).toContain("relevant to your changes");
  });

  it("contains instruction telling agent not to run the full suite", () => {
    expect(engineer.instructions).toContain("Do not run it yourself");
  });

  it("mentions the verification pipeline runs the full suite", () => {
    expect(engineer.instructions).toContain("verification pipeline");
    expect(engineer.instructions).toContain("full test suite");
  });

  it("has doneCriteria mentioning relevant tests passing", () => {
    expect(engineer.doneCriteria).toContain("Relevant tests passing");
  });

  it("does NOT contain old instruction to run the full test command", () => {
    expect(engineer.instructions).not.toContain("Run the project's test command before finishing");
  });

  it("requires all changes include tests", () => {
    expect(engineer.instructions).toContain("All changes MUST include tests");
  });
});

describe("QA role instructions (test responsibility split)", () => {
  const qa = BUILTIN_ROLES.qa;

  it("instructs QA to run the test files they wrote", () => {
    expect(qa.instructions).toContain("Run the test files you wrote");
  });

  it("instructs QA not to run the full test suite", () => {
    expect(qa.instructions).toContain("Do not run the full test suite");
  });

  it("restricts QA to test files only", () => {
    expect(qa.instructions).toContain("Do NOT modify production source code");
    expect(qa.instructions).toContain("Only create or edit test files");
  });
});

describe("Other roles have appropriate test settings", () => {
  it("reviewer does not run tests", () => {
    expect(BUILTIN_ROLES.reviewer.runTests).toBe(false);
  });

  it("researcher does not run tests", () => {
    expect(BUILTIN_ROLES.researcher.runTests).toBe(false);
  });

  it("devops does not run tests", () => {
    expect(BUILTIN_ROLES.devops.runTests).toBe(false);
  });

  it("engineer runs tests", () => {
    expect(BUILTIN_ROLES.engineer.runTests).toBe(true);
  });

  it("qa runs tests", () => {
    expect(BUILTIN_ROLES.qa.runTests).toBe(true);
  });
});
