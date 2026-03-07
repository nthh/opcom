---
id: context-graph-drift-engine
title: "Composite Drift Detection Engine"
status: closed
type: feature
priority: 1
created: 2026-03-05
updated: 2026-03-05
milestone: phase-4
deps:
  - context-graph-ci-ingestion
  - context-graph-temporal-analysis
links:
  - docs/spec/context-graph.md#phase-4
---

# Composite Drift Detection Engine

## Goal

Upgrade drift detection from simple queries to a scored, prioritized engine. Each drift signal gets a severity score combining multiple factors (churn, test results, spec importance). Output is a ranked list of actionable gaps — the input for LLM triage.

Signals are classified by **test type** (unit, e2e, api) so downstream generators know what kind of test to produce.

## Signal Types

### Existing (from Phase 1 drift command)

| ID | Signal | Description | Suggested Action |
|----|--------|-------------|-----------------|
| `spec_no_tests` | Spec section with no test coverage | Graph has spec node, no `asserts` edges | `write_test` |
| `file_no_tests` | Source file with no test coverage | Graph has file node, no `tests` edges | `write_test` |
| `orphan_code` | Code file not referenced by any spec or ticket | No `implements` edges pointing at it | `update_spec` or `ignore` |
| `ticket_no_spec` | Ticket without spec linkage | Ticket node has no `links_to` spec edges | `update_spec` |

### New: Test Quality Signals (from Phase 2 CI ingestion)

| ID | Signal | Description | Suggested Action |
|----|--------|-------------|-----------------|
| `test_regression` | Test that was passing, now failing | `test_results` shows pass→fail transition | `fix_test` |
| `flaky_test` | Test with alternating pass/fail | 3+ status changes in last N runs | `fix_test` |
| `stale_assertion` | Test exists but spec section was modified after test was last updated | `last_seen` on asserts edge < spec node `last_seen` | `update_test` |
| `coupling_gap` | Files that co-change but aren't tested together | High co-change frequency, no shared test | `write_test` |
| `churn_untested` | High-churn file with no tests | `file_history` shows frequent changes, no `tests` edges | `write_test` |

### New: UI Behavior Signals

| ID | Signal | Description | Test Type |
|----|--------|-------------|-----------|
| `ui_spec_no_e2e` | Spec section describes UI behavior, no Playwright test covers it | `e2e` |
| `component_no_e2e` | Component file exists with user interactions, no e2e test | `e2e` |

**UI behavior detection heuristics** (applied to spec section content):
- Contains keywords: "click", "button", "form", "modal", "dialog", "navigate", "page", "tab", "toggle", "dropdown", "select", "input", "checkbox", "drag", "hover", "tooltip", "sidebar", "panel"
- References component files (`.tsx`, `.vue`, `.svelte`)
- Section is under a heading containing "UI", "Interface", "Interaction", "User Flow", "Workbench"

**Component interaction detection** (applied to source code):
- Contains `onClick`, `onSubmit`, `onChange`, `onKeyDown` or framework equivalents
- Is a React/Vue/Svelte component file (not a utility)
- Has user-facing JSX (not a provider/context/hook-only file)

### New: API Contract Signals

| ID | Signal | Description | Test Type |
|----|--------|-------------|-----------|
| `api_spec_no_test` | Spec section describes API endpoint, no API test covers it | `api` |
| `route_no_test` | Route handler file exists, no test imports it | `api` |

**API behavior detection heuristics** (applied to spec section content):
- Contains HTTP methods: "GET", "POST", "PUT", "DELETE", "PATCH"
- Contains URL patterns: `/api/`, `/v1/`, `endpoint`
- Mentions status codes: "200", "201", "400", "401", "404", "409", "422"
- References request/response schemas

**Route handler detection** (applied to source code):
- Python: `@app.get`, `@app.post`, `@router.get`, `@app.route` decorators
- TypeScript: `.get(`, `.post(`, `app.route(` method calls
- File path contains `routes/`, `api/`, `handlers/`, `endpoints/`

## DriftSignal Interface

```typescript
interface DriftSignal {
  /** Unique ID for this signal instance. */
  id: string;
  /** Signal type from the table above. */
  type: DriftSignalType;
  /** Composite severity score (0.0 - 1.0). */
  severity: number;
  /** What kind of test would address this. */
  testType: 'unit' | 'integration' | 'e2e' | 'api';
  /** Suggested action. */
  action: 'write_test' | 'update_test' | 'fix_test' | 'update_spec' | 'ignore';
  /** The spec section or file this signal is about. */
  subject: {
    nodeId: string;
    path: string;
    title?: string;
  };
  /** Context for LLM consumption. */
  context: {
    specContent?: string;
    sourceCode?: string;
    testCode?: string;
    /** Why this signal has its severity score. */
    scoringReason: string;
  };
}
```

## Severity Scoring

```
severity = base_severity × churn_multiplier × spec_importance × recency_multiplier
```

| Factor | Calculation |
|--------|-------------|
| `base_severity` | Per signal type: `test_regression` = 1.0, `flaky_test` = 0.8, `api_spec_no_test` = 0.7, `ui_spec_no_e2e` = 0.7, `spec_no_tests` = 0.6, `churn_untested` = 0.5, `file_no_tests` = 0.3, `orphan_code` = 0.2 |
| `churn_multiplier` | 1.0 + (changes_last_90d / 10), capped at 3.0 |
| `spec_importance` | 1.0 + (0.1 × number of edges to/from spec node). More connected = more important |
| `recency_multiplier` | 1.5 if changed in last 7d, 1.2 if last 30d, 1.0 otherwise |

Final severity is clamped to [0.0, 1.0].

## Tasks

- [ ] T1: `DriftSignal` interface and `DriftSignalType` enum
- [ ] T2: Signal detectors for original 4 types (spec_no_tests, file_no_tests, orphan_code, ticket_no_spec)
- [ ] T3: Signal detectors for test quality types (test_regression, flaky_test, stale_assertion, coupling_gap, churn_untested)
- [ ] T4: Signal detectors for UI types (ui_spec_no_e2e, component_no_e2e) with keyword heuristics
- [ ] T5: Signal detectors for API types (api_spec_no_test, route_no_test) with keyword/decorator heuristics
- [ ] T6: Composite severity scoring with multipliers
- [ ] T7: Context attachment — read spec content + source code + test code into each signal
- [ ] T8: `context-graph drift --json` for machine-readable output
- [ ] T9: `context-graph drift --type <type> --min-severity <N> --test-type <unit|e2e|api>` filtering
- [ ] T10: Tests for scoring, ranking, all 13 signal types, and heuristic detection

## Acceptance Criteria

- `context-graph drift` outputs signals ranked by composite severity score
- Each signal has a `testType` field indicating what kind of test should be generated
- UI behavior heuristics correctly identify spec sections mentioning clicks/forms/navigation
- API contract heuristics correctly identify spec sections mentioning HTTP methods/endpoints
- High-churn untested files rank higher than low-churn untested files
- Test regressions always rank as high severity
- `--json` output includes full context for each signal (for LLM consumption)
- `--test-type e2e` filters to only UI-related signals
- `--test-type api` filters to only API-related signals
