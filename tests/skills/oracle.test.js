"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const core_1 = require("@opcom/core");
function makeWorkItem(overrides) {
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
function makeOracleInput(overrides) {
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
(0, vitest_1.describe)("extractCriteriaFromMarkdown", () => {
    (0, vitest_1.it)("extracts from Acceptance Criteria section with checkboxes", () => {
        const content = `# Feature

## Acceptance Criteria

- [ ] First criterion
- [ ] Second criterion
- [x] Third criterion (already done)

## Notes

Some notes here.
`;
        const criteria = (0, core_1.extractCriteriaFromMarkdown)(content);
        (0, vitest_1.expect)(criteria).toHaveLength(3);
        (0, vitest_1.expect)(criteria[0]).toBe("First criterion");
        (0, vitest_1.expect)(criteria[1]).toBe("Second criterion");
        (0, vitest_1.expect)(criteria[2]).toBe("Third criterion (already done)");
    });
    (0, vitest_1.it)("extracts from Acceptance Criteria section with plain bullets", () => {
        const content = `# Feature

## Acceptance Criteria

- Cache is implemented
- Tests pass
- Documentation updated
`;
        const criteria = (0, core_1.extractCriteriaFromMarkdown)(content);
        (0, vitest_1.expect)(criteria).toHaveLength(3);
        (0, vitest_1.expect)(criteria[0]).toBe("Cache is implemented");
    });
    (0, vitest_1.it)("falls back to standalone checkboxes if no AC section", () => {
        const content = `# Feature

Some description.

- [ ] Must support caching
- [ ] Must have tests
`;
        const criteria = (0, core_1.extractCriteriaFromMarkdown)(content);
        (0, vitest_1.expect)(criteria).toHaveLength(2);
        (0, vitest_1.expect)(criteria[0]).toBe("Must support caching");
    });
    (0, vitest_1.it)("returns empty array for content with no criteria", () => {
        const content = `# Feature

Just a description with no checkboxes or AC section.
`;
        const criteria = (0, core_1.extractCriteriaFromMarkdown)(content);
        (0, vitest_1.expect)(criteria).toHaveLength(0);
    });
});
(0, vitest_1.describe)("formatOraclePrompt", () => {
    (0, vitest_1.it)("includes ticket information", () => {
        const input = makeOracleInput();
        const prompt = (0, core_1.formatOraclePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("ticket-1");
        (0, vitest_1.expect)(prompt).toContain("Add caching layer");
        (0, vitest_1.expect)(prompt).toContain("in-progress");
    });
    (0, vitest_1.it)("includes acceptance criteria", () => {
        const input = makeOracleInput();
        const prompt = (0, core_1.formatOraclePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("Cache class is implemented");
        (0, vitest_1.expect)(prompt).toContain("Cache has TTL support");
        (0, vitest_1.expect)(prompt).toContain("Unit tests cover cache operations");
    });
    (0, vitest_1.it)("includes git diff", () => {
        const input = makeOracleInput();
        const prompt = (0, core_1.formatOraclePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("class Cache");
        (0, vitest_1.expect)(prompt).toContain("src/cache.ts");
    });
    (0, vitest_1.it)("includes spec when provided", () => {
        const input = makeOracleInput({
            spec: "# Cache Specification\n\nThe cache must support TTL and LRU eviction.",
        });
        const prompt = (0, core_1.formatOraclePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("# Specification");
        (0, vitest_1.expect)(prompt).toContain("TTL and LRU eviction");
    });
    (0, vitest_1.it)("includes test results when provided", () => {
        const input = makeOracleInput({
            testResults: "PASS src/cache.test.ts\n  3 tests passed",
        });
        const prompt = (0, core_1.formatOraclePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("# Test Results");
        (0, vitest_1.expect)(prompt).toContain("3 tests passed");
    });
    (0, vitest_1.it)("handles empty diff", () => {
        const input = makeOracleInput({ gitDiff: "" });
        const prompt = (0, core_1.formatOraclePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("No changes detected");
    });
    (0, vitest_1.it)("truncates very long diffs", () => {
        const longDiff = "x".repeat(60000);
        const input = makeOracleInput({ gitDiff: longDiff });
        const prompt = (0, core_1.formatOraclePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("truncated");
        (0, vitest_1.expect)(prompt).toContain("10000 chars omitted");
    });
    (0, vitest_1.it)("includes response format instructions", () => {
        const input = makeOracleInput();
        const prompt = (0, core_1.formatOraclePrompt)(input);
        (0, vitest_1.expect)(prompt).toContain("## Criteria");
        (0, vitest_1.expect)(prompt).toContain("**Met**: YES or NO");
        (0, vitest_1.expect)(prompt).toContain("## Concerns");
    });
});
(0, vitest_1.describe)("parseOracleResponse", () => {
    (0, vitest_1.it)("parses well-formed oracle response with all criteria met", () => {
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
        const result = (0, core_1.parseOracleResponse)(response);
        (0, vitest_1.expect)(result.passed).toBe(true);
        (0, vitest_1.expect)(result.criteria).toHaveLength(3);
        (0, vitest_1.expect)(result.criteria[0].met).toBe(true);
        (0, vitest_1.expect)(result.criteria[1].met).toBe(true);
        (0, vitest_1.expect)(result.criteria[2].met).toBe(true);
        (0, vitest_1.expect)(result.concerns).toHaveLength(0);
    });
    (0, vitest_1.it)("parses response with some criteria not met", () => {
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
        const result = (0, core_1.parseOracleResponse)(response);
        (0, vitest_1.expect)(result.passed).toBe(false);
        (0, vitest_1.expect)(result.criteria).toHaveLength(3);
        (0, vitest_1.expect)(result.criteria[0].met).toBe(true);
        (0, vitest_1.expect)(result.criteria[1].met).toBe(false);
        (0, vitest_1.expect)(result.criteria[2].met).toBe(false);
        (0, vitest_1.expect)(result.concerns).toHaveLength(2);
        (0, vitest_1.expect)(result.concerns[0]).toContain("concurrent access");
        (0, vitest_1.expect)(result.concerns[1]).toContain("error handling");
    });
    (0, vitest_1.it)("returns passed=false when no criteria are parsed", () => {
        const response = "Unable to evaluate the changes.";
        const result = (0, core_1.parseOracleResponse)(response);
        (0, vitest_1.expect)(result.passed).toBe(false);
        (0, vitest_1.expect)(result.criteria).toHaveLength(0);
    });
});
(0, vitest_1.describe)("runOracle", () => {
    (0, vitest_1.it)("orchestrates prompt formatting and response parsing", async () => {
        const input = makeOracleInput();
        const mockLlmCall = async (prompt) => {
            (0, vitest_1.expect)(prompt).toContain("ticket-1");
            (0, vitest_1.expect)(prompt).toContain("Cache class is implemented");
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
        const result = await (0, core_1.runOracle)(input, mockLlmCall);
        (0, vitest_1.expect)(result.passed).toBe(false);
        (0, vitest_1.expect)(result.criteria).toHaveLength(3);
        (0, vitest_1.expect)(result.criteria[0].met).toBe(true);
        (0, vitest_1.expect)(result.criteria[1].met).toBe(false);
        (0, vitest_1.expect)(result.criteria[2].met).toBe(true);
        (0, vitest_1.expect)(result.concerns).toHaveLength(1);
    });
    (0, vitest_1.it)("returns passed=true when all criteria are met", async () => {
        const input = makeOracleInput({
            acceptanceCriteria: ["Simple criterion"],
        });
        const mockLlmCall = async () => {
            return `## Criteria
- **Criterion**: Simple criterion
  - **Met**: YES
  - **Reasoning**: Fully implemented

## Concerns
None.
`;
        };
        const result = await (0, core_1.runOracle)(input, mockLlmCall);
        (0, vitest_1.expect)(result.passed).toBe(true);
        (0, vitest_1.expect)(result.criteria).toHaveLength(1);
        (0, vitest_1.expect)(result.concerns).toHaveLength(0);
    });
});
//# sourceMappingURL=oracle.test.js.map