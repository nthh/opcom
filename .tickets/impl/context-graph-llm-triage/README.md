---
id: context-graph-llm-triage
title: "LLM Drift Triage Agent"
status: open
type: feature
priority: 2
created: 2026-03-05
updated: 2026-03-05
milestone: phase-5
deps:
  - context-graph-drift-engine
links:
  - docs/spec/context-graph.md#phase-5
---

# LLM Drift Triage Agent

## Goal

When drift signals exceed a threshold, an LLM triages them: is this gap real or expected? What's the right action? What priority? This filters the noise (34 "untested files" becomes 5 actionable test gaps) and produces structured output for test generation.

The triage agent must handle all signal types including UI behavior and API contract signals, classifying the correct test type and providing framework-specific test hints.

## TriageResult Interface

```typescript
interface TriageResult {
  /** The drift signal being triaged. */
  signalId: string;
  signalType: DriftSignalType;
  /** LLM's verdict. */
  verdict: 'actionable' | 'expected' | 'deferred' | 'duplicate';
  /** Recommended action (may differ from signal's suggested action). */
  action: 'write_test' | 'update_test' | 'fix_test' | 'update_spec' | 'ignore';
  /** Priority for the action. */
  priority: 'P1' | 'P2' | 'P3';
  /** LLM's reasoning (human-readable). */
  reasoning: string;
  /** Concrete hints for the test generator. */
  testHints: {
    /** What type of test to generate. */
    testType: 'unit' | 'integration' | 'e2e' | 'api';
    /** What specifically to test (not just "write a test"). */
    behaviors: string[];
    /** Suggested test file path. */
    targetPath: string;
    /** Framework to use. */
    framework: string;
    /** For e2e: user actions to simulate. */
    userActions?: string[];
    /** For api: HTTP method + path + expected status codes. */
    apiContract?: {
      method: string;
      path: string;
      expectedStatuses: number[];
    };
  };
}
```

## Triage Prompt

The prompt includes the drift signal with full context and asks for structured JSON output:

```
You are triaging test coverage drift signals for a software project.

For each signal, determine:
1. Is this gap real (actionable) or expected (e.g., __init__.py, config files, type-only files)?
2. What kind of test would close this gap?
3. What specifically should the test verify?

## Signal
Type: {signal.type}
Severity: {signal.severity}
Test Type Hint: {signal.testType}
Subject: {signal.subject.path}

## Spec Content
{signal.context.specContent}

## Source Code
{signal.context.sourceCode}

## Existing Tests
{signal.context.testCode}

## Classification Rules
- `__init__.py`, `conftest.py`, `types.py`, pure type files → verdict: expected
- Config files, migrations, generated code → verdict: expected
- UI spec with no e2e test but existing unit test that covers the logic → verdict: deferred (unit test sufficient for now)
- API endpoint with existing integration test → verdict: expected (already covered)
- Same file flagged by multiple signals → mark duplicates, keep highest severity

Respond with JSON:
{
  "verdict": "actionable" | "expected" | "deferred" | "duplicate",
  "action": "write_test" | "update_test" | "fix_test" | "update_spec" | "ignore",
  "priority": "P1" | "P2" | "P3",
  "reasoning": "one sentence explaining why",
  "testHints": {
    "testType": "unit" | "integration" | "e2e" | "api",
    "behaviors": ["specific behavior 1", "specific behavior 2"],
    "targetPath": "tests/test_foo.py",
    "framework": "pytest",
    "userActions": ["click save button", "verify toast appears"],
    "apiContract": { "method": "POST", "path": "/api/layers", "expectedStatuses": [201, 409, 422] }
  }
}
```

## Tasks

- [ ] T1: Triage prompt template with signal type-specific classification rules
- [ ] T2: `TriageResult` interface with testHints including e2e and API fields
- [ ] T3: `context-graph triage` command — reads drift, calls LLM, outputs results
- [ ] T4: Model selection: Haiku for classification, configurable via `--model`
- [ ] T5: Batch processing — triage top N signals in one LLM call (cheaper than N calls)
- [ ] T6: Triage → ticket creation (P1 results auto-create opcom tickets)
- [ ] T7: Triage history — `triage_results` table, don't re-triage already-triaged signals
- [ ] T8: `--test-type` filter — only triage signals of a specific test type
- [ ] T9: Tests with mocked LLM responses (unit, e2e, and API signal types)

## Acceptance Criteria

- `context-graph triage` filters 34 drift signals down to ~5 actionable items
- `__init__.py` and similar expected-untested files are correctly classified as "expected"
- P1 triage results include concrete test hints (what to test, not just "write a test")
- E2E signals include `userActions` in test hints (e.g., "click save button", "verify modal closes")
- API signals include `apiContract` in test hints (method, path, expected statuses)
- Triage results are stored and don't re-trigger for already-triaged signals
- `context-graph triage --test-type e2e` only triages UI-related signals
- Works with Anthropic API (ANTHROPIC_API_KEY env var)
