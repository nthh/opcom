import { describe, it, expect } from "vitest";
import {
  formatOraclePrompt,
  parseOracleResponse,
  runOracle,
  extractCriteriaFromMarkdown,
} from "@opcom/core";
import type { OracleInput } from "@opcom/core";
import type { WorkItem } from "@opcom/types";

function makeWorkItem(overrides?: Partial<WorkItem>): WorkItem {
  return {
    id: "ticket-1",
    title: "Add caching layer",
    status: "in-progress",
    priority: 1,
    type: "feature",
    filePath: "/tmp/test/.tickets/ticket-1/README.md",
    deps: [],
    links: [],
    tags: {},
    ...overrides,
  };
}

function makeOracleInput(overrides?: Partial<OracleInput>): OracleInput {
  return {
    ticket: makeWorkItem(),
    gitDiff: `diff --git a/src/cache.ts b/src/cache.ts
new file mode 100644
--- /dev/null
+++ b/src/cache.ts
@@ -0,0 +1,20 @@
+export class Cache {
+  private store = new Map<string, unknown>();
+  get(key: string) { return this.store.get(key); }
+  set(key: string, value: unknown) { this.store.set(key, value); }
+}`,
    acceptanceCriteria: [
      "Cache class is implemented with get/set methods",
      "Cache has TTL support",
      "Unit tests cover cache operations",
    ],
    ...overrides,
  };
}

describe("extractCriteriaFromMarkdown", () => {
  it("extracts from Acceptance Criteria section with checkboxes", () => {
    const content = `# Feature

## Acceptance Criteria

- [ ] First criterion
- [ ] Second criterion
- [x] Third criterion (already done)

## Notes

Some notes here.
`;

    const criteria = extractCriteriaFromMarkdown(content);
    expect(criteria).toHaveLength(3);
    expect(criteria[0]).toBe("First criterion");
    expect(criteria[1]).toBe("Second criterion");
    expect(criteria[2]).toBe("Third criterion (already done)");
  });

  it("extracts from Acceptance Criteria section with plain bullets", () => {
    const content = `# Feature

## Acceptance Criteria

- Cache is implemented
- Tests pass
- Documentation updated
`;

    const criteria = extractCriteriaFromMarkdown(content);
    expect(criteria).toHaveLength(3);
    expect(criteria[0]).toBe("Cache is implemented");
  });

  it("extracts from Oracle (Done When) heading plus task checkboxes", () => {
    const content = `# Phase 5: Commons Data Ingestion

## Overview

Some overview text.

## Oracle (Done When)

- [ ] 6 datasets downloaded + converted to cloud-native format
- [ ] Each has a layer.yaml definition
- [ ] Each validated by DeepValidator

---

## Tasks

- [ ] T001 Download WDPA
- [ ] T002 Convert WDPA
- [ ] T003 Write layer.yaml
`;

    const criteria = extractCriteriaFromMarkdown(content);
    expect(criteria).toHaveLength(6);
    expect(criteria[0]).toBe("6 datasets downloaded + converted to cloud-native format");
    expect(criteria[1]).toBe("Each has a layer.yaml definition");
    expect(criteria[2]).toBe("Each validated by DeepValidator");
    // Task checkboxes also included for granularity
    expect(criteria[3]).toBe("T001 Download WDPA");
    expect(criteria[4]).toBe("T002 Convert WDPA");
    expect(criteria[5]).toBe("T003 Write layer.yaml");
  });

  it("extracts from bare Oracle section", () => {
    const content = `# Feature

## Oracle

- [ ] API endpoint exists
- [ ] Returns JSON
`;

    const criteria = extractCriteriaFromMarkdown(content);
    expect(criteria).toHaveLength(2);
    expect(criteria[0]).toBe("API endpoint exists");
  });

  it("extracts from bold **Oracle (Done When):** and filters gaps/questions", () => {
    const content = `# Phase 5: Commons Data

## Context Packet

**Goal:** 6 datasets available.

**Oracle (Done When):**
- [ ] 6 datasets downloaded
- [ ] Each has a layer.yaml
- [ ] Each validated by DeepValidator

---

## Tasks

- [ ] T001 Download WDPA
- [ ] T002 Convert WDPA
- [ ] T003 Write layer.yaml

## Gaps

- [ ] **Gap**: Something needs manual work
- [ ] **Question**: Should we use X or Y?
`;

    const criteria = extractCriteriaFromMarkdown(content);
    expect(criteria).toHaveLength(6);
    expect(criteria[0]).toBe("6 datasets downloaded");
    expect(criteria[3]).toBe("T001 Download WDPA");
    // Gaps and questions are filtered out
    expect(criteria.every(c => !c.includes("Gap"))).toBe(true);
    expect(criteria.every(c => !c.includes("Question"))).toBe(true);
  });

  it("falls back to standalone checkboxes if no AC section", () => {
    const content = `# Feature

Some description.

- [ ] Must support caching
- [ ] Must have tests
`;

    const criteria = extractCriteriaFromMarkdown(content);
    expect(criteria).toHaveLength(2);
    expect(criteria[0]).toBe("Must support caching");
  });

  it("returns empty array for content with no criteria", () => {
    const content = `# Feature

Just a description with no checkboxes or AC section.
`;

    const criteria = extractCriteriaFromMarkdown(content);
    expect(criteria).toHaveLength(0);
  });
});

describe("formatOraclePrompt", () => {
  it("includes ticket information", () => {
    const input = makeOracleInput();
    const prompt = formatOraclePrompt(input);

    expect(prompt).toContain("ticket-1");
    expect(prompt).toContain("Add caching layer");
    expect(prompt).toContain("in-progress");
  });

  it("includes acceptance criteria", () => {
    const input = makeOracleInput();
    const prompt = formatOraclePrompt(input);

    expect(prompt).toContain("Cache class is implemented");
    expect(prompt).toContain("Cache has TTL support");
    expect(prompt).toContain("Unit tests cover cache operations");
  });

  it("includes git diff", () => {
    const input = makeOracleInput();
    const prompt = formatOraclePrompt(input);

    expect(prompt).toContain("class Cache");
    expect(prompt).toContain("src/cache.ts");
  });

  it("includes spec when provided", () => {
    const input = makeOracleInput({
      spec: "# Cache Specification\n\nThe cache must support TTL and LRU eviction.",
    });
    const prompt = formatOraclePrompt(input);

    expect(prompt).toContain("# Specification");
    expect(prompt).toContain("TTL and LRU eviction");
  });

  it("includes test results when provided", () => {
    const input = makeOracleInput({
      testResults: "PASS src/cache.test.ts\n  3 tests passed",
    });
    const prompt = formatOraclePrompt(input);

    expect(prompt).toContain("# Test Results");
    expect(prompt).toContain("3 tests passed");
  });

  it("handles empty diff", () => {
    const input = makeOracleInput({ gitDiff: "" });
    const prompt = formatOraclePrompt(input);

    expect(prompt).toContain("No changes detected");
  });

  it("includes file listing when provided", () => {
    const input = makeOracleInput({
      fileListing: "src/cache.ts\nsrc/index.ts\ndemos/solar-siting-utah/folia.yaml\ntests/cache.test.ts",
    });
    const prompt = formatOraclePrompt(input);

    expect(prompt).toContain("# Repository File Listing");
    expect(prompt).toContain("demos/solar-siting-utah/folia.yaml");
    expect(prompt).toContain("not just changed files");
  });

  it("omits file listing section when not provided", () => {
    const input = makeOracleInput();
    const prompt = formatOraclePrompt(input);

    expect(prompt).not.toContain("# Repository File Listing");
  });

  it("truncates very long file listings", () => {
    const longListing = "file.ts\n".repeat(5000);
    const input = makeOracleInput({ fileListing: longListing });
    const prompt = formatOraclePrompt(input);

    expect(prompt).toContain("truncated");
  });

  it("truncates very long diffs", () => {
    const longDiff = "x".repeat(60000);
    const input = makeOracleInput({ gitDiff: longDiff });
    const prompt = formatOraclePrompt(input);

    expect(prompt).toContain("truncated");
    expect(prompt).toContain("10000 chars omitted");
  });

  it("includes response format instructions", () => {
    const input = makeOracleInput();
    const prompt = formatOraclePrompt(input);

    expect(prompt).toContain("## Criteria");
    expect(prompt).toContain("**Met**: YES or NO");
    expect(prompt).toContain("## Concerns");
  });
});

describe("parseOracleResponse", () => {
  it("parses well-formed oracle response with all criteria met", () => {
    const response = `## Criteria
- **Criterion**: Cache class is implemented with get/set methods
  - **Met**: YES
  - **Reasoning**: The Cache class has both get and set methods

- **Criterion**: Cache has TTL support
  - **Met**: YES
  - **Reasoning**: TTL is implemented via setTimeout in the set method

- **Criterion**: Unit tests cover cache operations
  - **Met**: YES
  - **Reasoning**: Test file includes tests for get, set, and TTL

## Concerns
None.
`;

    const result = parseOracleResponse(response);

    expect(result.passed).toBe(true);
    expect(result.criteria).toHaveLength(3);
    expect(result.criteria[0].met).toBe(true);
    expect(result.criteria[1].met).toBe(true);
    expect(result.criteria[2].met).toBe(true);
    expect(result.concerns).toHaveLength(0);
  });

  it("parses response with some criteria not met", () => {
    const response = `## Criteria
- **Criterion**: Cache class is implemented with get/set methods
  - **Met**: YES
  - **Reasoning**: Implementation looks correct

- **Criterion**: Cache has TTL support
  - **Met**: NO
  - **Reasoning**: No TTL logic found in the implementation

- **Criterion**: Unit tests cover cache operations
  - **Met**: NO
  - **Reasoning**: No test file found

## Concerns
- The cache implementation does not handle concurrent access
- No error handling for invalid keys
`;

    const result = parseOracleResponse(response);

    expect(result.passed).toBe(false);
    expect(result.criteria).toHaveLength(3);
    expect(result.criteria[0].met).toBe(true);
    expect(result.criteria[1].met).toBe(false);
    expect(result.criteria[2].met).toBe(false);
    expect(result.concerns).toHaveLength(2);
    expect(result.concerns[0]).toContain("concurrent access");
    expect(result.concerns[1]).toContain("error handling");
  });

  it("returns passed=false when no criteria are parsed", () => {
    const response = "Unable to evaluate the changes.";
    const result = parseOracleResponse(response);

    expect(result.passed).toBe(false);
    expect(result.criteria).toHaveLength(0);
  });
});

describe("runOracle", () => {
  it("orchestrates prompt formatting and response parsing", async () => {
    const input = makeOracleInput();

    const mockLlmCall = async (prompt: string): Promise<string> => {
      expect(prompt).toContain("ticket-1");
      expect(prompt).toContain("Cache class is implemented");
      return `## Criteria
- **Criterion**: Cache class is implemented with get/set methods
  - **Met**: YES
  - **Reasoning**: Both methods present

- **Criterion**: Cache has TTL support
  - **Met**: NO
  - **Reasoning**: TTL not implemented

- **Criterion**: Unit tests cover cache operations
  - **Met**: YES
  - **Reasoning**: Tests found

## Concerns
- Missing TTL implementation
`;
    };

    const result = await runOracle(input, mockLlmCall);

    expect(result.passed).toBe(false);
    expect(result.criteria).toHaveLength(3);
    expect(result.criteria[0].met).toBe(true);
    expect(result.criteria[1].met).toBe(false);
    expect(result.criteria[2].met).toBe(true);
    expect(result.concerns).toHaveLength(1);
  });

  it("returns passed=true when all criteria are met", async () => {
    const input = makeOracleInput({
      acceptanceCriteria: ["Simple criterion"],
    });

    const mockLlmCall = async (): Promise<string> => {
      return `## Criteria
- **Criterion**: Simple criterion
  - **Met**: YES
  - **Reasoning**: Fully implemented

## Concerns
None.
`;
    };

    const result = await runOracle(input, mockLlmCall);
    expect(result.passed).toBe(true);
    expect(result.criteria).toHaveLength(1);
    expect(result.concerns).toHaveLength(0);
  });
});
