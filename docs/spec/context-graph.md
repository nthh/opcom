---
spec: context-graph
status: draft
decided-by: []
---

# Context Graph & AI-Native Testing

## Overview {#overview}

The context graph is a queryable knowledge graph of a codebase — every file, test, spec, ticket, ADR, operation, benchmark, and how they relate. It's built programmatically from static analysis and git history, stored in SQLite, and consumed by agents, opcom, and any tool that needs structural understanding of a project.

On top of the graph sits an AI-native testing layer that detects drift, triages gaps, generates tests, and tracks results over time — implementing the self-improving test loop.

## Architecture {#architecture}

```
Layer 1: GRAPH (programmatic, every commit)
  Analyzers extract nodes + edges from code, specs, tickets, tests
  Commit replay builds temporal data (churn, coupling, file history)
  CI result ingestion tracks test pass/fail/duration as time series
  Output: ~/.context/<project>/graph.db

Layer 2: DRIFT (programmatic queries on the graph)
  Specs without tests, files without coverage, stale ticket links
  Test result regressions (started failing after commit X)
  Churn hotspots (files that change often but lack tests)
  Coupling anomalies (files that change together but aren't tested together)
  Output: drift signals (structured data)

Layer 3: TRIAGE (LLM, triggered by drift signals)
  Rank drift signals by risk
  Classify whether a gap matters or is expected (e.g., __init__.py is fine untested)
  Map each gap to the right action: write test, update spec, close ticket, etc.
  Output: prioritized action items

Layer 4: GENERATION (LLM agent, triggered by triage)
  Write new tests for uncovered specs/code
  Update existing tests when specs change
  Classify test types (assertion/snapshot/benchmark)
  Propose spec updates when code diverges
  Output: code changes (PRs, commits) reviewed by humans

Layer 5: VERIFICATION (existing opcom pipeline)
  Test gate: run tests after agent work
  Oracle: LLM checks diff against spec + acceptance criteria
  Results ingested back into graph → closes the loop
  Output: verified step completions
```

The key insight: **Layers 1-2 are pure programmatic (fast, cheap, every commit). Layers 3-4 use LLMs (expensive, semantic, triggered by drift). Layer 5 already exists in opcom.**

## Phase 1: Graph Foundation {#phase-1}

*Status: DONE*

### P1.1: Core schema + database

SQLite with nodes, edges, build_meta, FTS5 search. Temporal tracking via first_seen/last_seen.

| Aspect | Detail |
|--------|--------|
| Status | done |
| Code | `packages/context-graph/src/core/` |
| Tests | `tests/context-graph/builder.test.ts` (8 passing) |

### P1.2: Language analyzers

Pluggable analyzer interface (detect + analyze, like buildpacks). Built-in: TypeScript imports, Python imports, markdown docs, tickets.

| Aspect | Detail |
|--------|--------|
| Status | done |
| Code | `packages/context-graph/src/analyzers/` |
| Tests | Covered by builder tests |

### P1.3: Builder + CLI

GraphBuilder orchestrates analyzers. CLI: build, update, replay, stats, query, drift, search, install-hooks.

| Aspect | Detail |
|--------|--------|
| Status | done |
| Code | `packages/context-graph/src/core/builder.ts`, `src/cli.ts` |
| Tests | Covered by builder tests |

### P1.4: Git hooks

post-commit: incremental update. pre-push: full rebuild.

| Aspect | Detail |
|--------|--------|
| Status | done (folia Python version), CLI `install-hooks` command for TS version |

## Phase 2: CI Result Ingestion {#phase-2}

*Status: NOT STARTED*

Track test results as time series data. Every CI run (or local test run) produces a snapshot of which tests passed/failed/skipped and how long they took.

### P2.1: Test results schema

```sql
CREATE TABLE test_results (
    test_id     TEXT NOT NULL,     -- node ID: test:tests/test_compute.py
    commit_hash TEXT NOT NULL,
    run_id      TEXT,              -- CI run ID or local run timestamp
    status      TEXT NOT NULL,     -- pass, fail, skip, error
    duration_ms INTEGER,
    error_msg   TEXT,              -- first 500 chars of failure message
    timestamp   TEXT NOT NULL,
    PRIMARY KEY (test_id, commit_hash, run_id)
);

CREATE TABLE run_summary (
    run_id      TEXT PRIMARY KEY,
    commit_hash TEXT NOT NULL,
    timestamp   TEXT NOT NULL,
    framework   TEXT,              -- pytest, vitest, jest, go-test
    total       INTEGER,
    passed      INTEGER,
    failed      INTEGER,
    skipped     INTEGER,
    duration_ms INTEGER,
    meta        TEXT               -- JSON: CI provider, branch, trigger
);
```

### P2.2: Result parsers

Each test framework outputs results differently. Parsers normalize to the schema above.

| Framework | Input format | Parser |
|-----------|-------------|--------|
| pytest | `--json-report` (pytest-json-report plugin) or JUnit XML | `parsers/pytest.ts` |
| vitest | `--reporter=json` | `parsers/vitest.ts` |
| Jest | `--json` | `parsers/jest.ts` |
| JUnit XML | Universal format from any Java/Go/etc framework | `parsers/junit.ts` |
| Generic | TAP format or exit-code-only | `parsers/generic.ts` |

### P2.3: Ingestion command

```bash
# After CI or local test run:
context-graph ingest <results-file> [--framework pytest|vitest|jest|junit]
# Auto-detects format if not specified

# Or pipe directly:
pytest --json-report --json-report-file=- | context-graph ingest --framework pytest

# From CI (GitHub Actions example):
- run: npm test -- --reporter=json > test-results.json
- run: npx context-graph ingest test-results.json
```

### P2.4: Queries enabled

```sql
-- Tests that started failing after a specific commit
SELECT tr.test_id, tr.error_msg
FROM test_results tr
WHERE tr.status = 'fail'
AND tr.commit_hash = '<recent>'
AND tr.test_id NOT IN (
    SELECT test_id FROM test_results WHERE commit_hash = '<previous>' AND status = 'fail'
);

-- Flaky tests (alternating pass/fail in recent runs)
SELECT test_id, COUNT(DISTINCT status) as status_count
FROM test_results
WHERE timestamp > datetime('now', '-7 days')
GROUP BY test_id
HAVING status_count > 1;

-- Slowest tests (p95 duration)
SELECT test_id,
       AVG(duration_ms) as avg_ms,
       MAX(duration_ms) as max_ms
FROM test_results
GROUP BY test_id
ORDER BY avg_ms DESC LIMIT 20;

-- Coverage trend: % of specs with passing assertion tests per run
SELECT rs.run_id, rs.timestamp,
       COUNT(DISTINCT e.target) as specs_covered
FROM run_summary rs
JOIN test_results tr ON tr.run_id = rs.run_id AND tr.status = 'pass'
JOIN edges e ON e.source = tr.test_id AND e.relation = 'asserts'
GROUP BY rs.run_id;
```

## Phase 3: Commit Replay & Temporal Analysis {#phase-3}

*Status: PARTIAL (replay() exists but not wired to analysis queries)*

### P3.1: Churn analysis

```sql
-- Files that change most often (last 90 days)
SELECT file_path, COUNT(*) as changes
FROM file_history fh
JOIN commit_log cl ON cl.hash = fh.commit_hash
WHERE cl.timestamp > datetime('now', '-90 days')
GROUP BY file_path
ORDER BY changes DESC;
```

Churn × no-test-coverage = highest-risk files. This is the priority list for test generation.

### P3.2: Coupling analysis

Files that change together in the same commit should be tested together.

```sql
-- Files that co-change (appear in the same commit)
SELECT a.file_path as file_a, b.file_path as file_b, COUNT(*) as co_changes
FROM file_history a
JOIN file_history b ON a.commit_hash = b.commit_hash AND a.file_path < b.file_path
GROUP BY a.file_path, b.file_path
HAVING co_changes >= 3
ORDER BY co_changes DESC;
```

Coupling without shared tests = integration test gap.

### P3.3: Velocity tracking

```sql
-- Tickets closed per week
SELECT strftime('%Y-W%W', cl.timestamp) as week,
       COUNT(DISTINCT fh.file_path) as tickets_closed
FROM file_history fh
JOIN commit_log cl ON cl.hash = fh.commit_hash
WHERE fh.file_path LIKE '.tickets/%'
AND cl.message LIKE '%status: closed%'
GROUP BY week;
```

### P3.4: Coverage regression detection

When replay + test results are combined:

```sql
-- Specs that lost test coverage (had passing tests before, don't now)
SELECT e.target as spec_id
FROM edges e
JOIN test_results tr_old ON tr_old.test_id = e.source AND tr_old.status = 'pass'
WHERE e.relation = 'asserts'
AND e.target NOT IN (
    SELECT e2.target FROM edges e2
    JOIN test_results tr_new ON tr_new.test_id = e2.source AND tr_new.status = 'pass'
    WHERE e2.relation = 'asserts'
    AND tr_new.run_id = (SELECT run_id FROM run_summary ORDER BY timestamp DESC LIMIT 1)
);
```

## Phase 4: Drift Detection Engine {#phase-4}

*Status: BASIC (simple queries exist), NEEDS: composite scoring*

### P4.1: Drift signal types

| Signal | Source | Severity calc |
|--------|--------|--------------|
| `spec_no_tests` | Spec has no assertion edges | Base severity × spec importance (# tickets referencing it) |
| `file_no_tests` | Source file has no test edges | Base severity × churn rate (changes in last 90 days) |
| `test_regression` | Test went from pass → fail | High (always actionable) |
| `flaky_test` | Test alternates pass/fail | Medium (noisy but important) |
| `stale_assertion` | Test asserts spec but spec changed since test was last modified | Medium (potential false positives) |
| `coupling_gap` | Files co-change but no shared test | Severity × co-change frequency |
| `churn_untested` | High-churn file with no tests | High (highest risk) |
| `ticket_no_spec` | Open ticket with no spec links | Low (process issue) |
| `orphan_code` | Source file not linked from any ticket | Low unless high churn |

### P4.2: Composite drift score

Each signal gets a severity score (0-100). The drift engine ranks signals and produces a prioritized list:

```typescript
interface DriftSignal {
  type: string;
  entityId: string;        // node ID
  severity: number;        // 0-100
  message: string;         // human-readable
  context: {               // data for LLM triage
    specContent?: string;
    codeContent?: string;
    testContent?: string;
    churnRate?: number;
    lastModified?: string;
  };
  suggestedAction: string; // write_test, update_spec, update_test, close_ticket
}
```

### P4.3: Drift command enhancement

```bash
context-graph drift                    # All signals, ranked by severity
context-graph drift --type spec_no_tests   # Filter by type
context-graph drift --min-severity 50      # Only high-severity
context-graph drift --json                 # Machine-readable for LLM consumption
```

## Phase 5: LLM Triage Agent {#phase-5}

*Status: NOT STARTED*

### P5.1: Triage prompt

When drift signals exceed a threshold, the triage agent receives:

```
Here are the top N drift signals from {project}:

1. [spec_no_tests] Spec "Query Planner" has no test coverage
   - 3 tickets reference this spec
   - Spec has 12 sections, 0 tested
   - Related code: folia/views/info.py (14 changes in 90 days)

2. [churn_untested] folia/connectors/stac.py changed 22 times, no tests
   - Imported by: catalog/registry.py, connectors/__init__.py
   - Part of spec: SOURCES_CATALOGS

For each signal:
- Is this a real gap or expected? (e.g., __init__.py is fine without tests)
- What's the right action: write_test, update_spec, update_test, ignore?
- If write_test: what should the test cover? (1-3 bullet points)
- Priority: P1 (do now), P2 (do soon), P3 (backlog)
```

### P5.2: Triage output

```typescript
interface TriageResult {
  signal: DriftSignal;
  verdict: "actionable" | "expected" | "defer";
  action: "write_test" | "update_spec" | "update_test" | "ignore";
  priority: 1 | 2 | 3;
  reasoning: string;
  testHints?: string[];    // what the test should cover
}
```

### P5.3: Triage → ticket creation

P1 triage results can automatically create opcom tickets:

```
opcom ticket create <project> "Add tests for STAC connector"
  --links docs/spec/SOURCES_CATALOGS.md
  --priority 2
  --body "Generated by context-graph triage. Drift signal: churn_untested on folia/connectors/stac.py (22 changes, 0 tests)."
```

### P5.4: Model selection

- **Triage:** Fast/cheap model (Haiku 4.5). It's classification + ranking, not generation.
- **Test generation (Phase 6):** Smart model (Sonnet 4.6 or Opus 4.6). It's writing code.
- **Oracle verification:** Already configured in opcom orchestrator config.

## Phase 6: Test Generation Agent {#phase-6}

*Status: NOT STARTED*

### P6.1: Test generation context packet

When a triage result has `action: write_test`, the generation agent receives:

```
# Task: Write tests for {spec_section}

## Spec
{spec content from the linked spec file}

## Implementation
{source code of the file(s) that implement this spec section}

## Existing Tests
{any tests that already partially cover this area}

## Test Hints (from triage)
{bullet points of what to test}

## Requirements
- Use the project's test framework ({framework})
- Write {assertion|snapshot|benchmark} tests as appropriate
- Each test should reference the spec section it covers (comment with spec ID)
- Do not modify existing test files unless extending them
- Run {test_command} to verify
```

### P6.2: Test type classification

The generation agent classifies each test it writes:

| Type | When | Example |
|------|------|---------|
| **assertion** | Deterministic pass/fail | `expect(compute(input)).toEqual(expected)` |
| **snapshot** | Versioned data structure comparison | `expect(output).toMatchSnapshot()` |
| **benchmark** | Performance metric tracked over time | `bench("zonal_stats", () => { ... })` |

Classification is stored as metadata on the test node in the graph.

### P6.3: Human review loop

Generated tests go through review before merging:

```
context-graph generate-tests --dry-run   # Show what would be generated
context-graph generate-tests             # Generate and create branch
context-graph generate-tests --pr        # Generate and open PR
```

In opcom integration:
1. Triage creates ticket with `type: test-generation`
2. opcom assigns agent to ticket with context packet
3. Agent writes tests
4. Verification pipeline runs (test gate + oracle)
5. Human reviews PR

### P6.4: Feedback loop

When generated tests are reviewed:
- **Approved:** Tests merge. Graph updated. Drift signal resolved.
- **Modified:** Human edits are captured. LLM learns preferences via few-shot examples stored in `~/.context/<project>/test-preferences.md`.
- **Rejected:** Reason recorded. Triage model fine-tuned to avoid similar suggestions.

## Phase 7: opcom Integration {#phase-7}

*Status: NOT STARTED*

### P7.1: Graph build on project add/scan

```typescript
// In Station.handleCommand():
case "add_project":
  const result = await detectProject(path);
  saveProject(result);
  // NEW: Build context graph in background
  const builder = createBuilder(result.name, path);
  builder.build().then(() => {
    this.broadcast({ type: "graph_built", projectId: result.id });
  });
  break;
```

### P7.2: Enhanced context packets

```typescript
// In context-builder.ts:
export async function buildContextPacket(project, workItem) {
  const packet = { /* ... existing ... */ };

  // NEW: Pull structural data from context graph
  const graphDb = openGraph(project.name);
  if (graphDb && workItem) {
    // Find all files related to this ticket's spec
    const relatedFiles = graphDb.query(`
      SELECT DISTINCT n.path FROM nodes n
      JOIN edges e ON n.id = e.target
      WHERE e.source IN (
        SELECT target FROM edges WHERE source = 'ticket:${workItem.id}' AND relation = 'implements'
      )
      AND e.relation = 'asserts' AND n.type = 'file'
    `);
    packet.relatedFiles = relatedFiles.rows.map(r => r[0]);

    // Find tests that cover those files
    const relatedTests = graphDb.query(`...`);
    packet.relatedTests = relatedTests.rows.map(r => r[0]);

    // Drift signals for this ticket's domain
    packet.driftSignals = getDriftForTicket(graphDb, workItem.id);
  }

  return packet;
}
```

### P7.3: `opcom graph` commands

```bash
opcom graph build [project]        # Build/rebuild graph
opcom graph stats [project]        # Show graph stats
opcom graph drift [project]        # Show drift signals
opcom graph query <sql> [project]  # Raw SQL query
opcom graph triage [project]       # Run LLM triage on drift
opcom graph generate [project]     # Generate tests from triage results
```

### P7.4: TUI integration

L2 project detail view gains a GRAPH section:

```
GRAPH
  Nodes: 1145 (428 files, 94 tests, 55 ops, ...)
  Edges: 1036 (273 imports, 215 asserts, ...)
  Drift: 3 high, 8 medium, 15 low
  Last build: 2m ago (commit ede4cd8)
```

L3 drill-down shows drift signals and test coverage map.

### P7.5: Traceability commands {#traceability}

Inspired by trk (`~/projects/folia/scripts/trk.py`), opcom gains traceability commands that enforce spec-driven development and provide visibility into spec-ticket-code-test coverage.

#### `opcom scaffold <spec-file>`

Generates tickets from spec section anchors. This mechanically enforces the specs-before-tickets rule — you write a spec with `## Section {#anchor}` headings, then scaffold creates the tickets.

```bash
opcom scaffold docs/spec/integrations.md           # create tickets for each section
opcom scaffold docs/spec/integrations.md --dry-run  # preview what would be created
opcom scaffold --all                                # scaffold all specs with unlinked sections
```

**Anchor extraction:**
Parse spec for `## Title {#anchor-id}` headings (Pandoc-style). Skip non-actionable sections (overview, summary, non-goals, architecture, references).

```typescript
const SECTION_PATTERN = /^##\s+(.+?)\s*\{#([a-z0-9-]+)\}\s*$/gm;
const SKIP_ANCHORS = new Set([
  "overview", "summary", "architecture", "non-goals",
  "references", "dependencies", "related-docs",
]);

interface SpecSection {
  title: string;
  anchor: string;
  specFile: string;
}

function extractSections(specPath: string): SpecSection[] {
  const content = readFileSync(specPath, "utf-8");
  const sections: SpecSection[] = [];
  for (const match of content.matchAll(SECTION_PATTERN)) {
    if (!SKIP_ANCHORS.has(match[2])) {
      sections.push({ title: match[1], anchor: match[2], specFile: specPath });
    }
  }
  return sections;
}
```

**Ticket generation:**
For each section without an existing ticket, create `.tickets/impl/<anchor>/README.md`:

```yaml
---
id: <anchor>
title: "<Spec Title>: <Section Title>"
status: open
type: feature
priority: 2
created: <today>
links:
  - <specFile>#<anchor>
---

# <Section Title>

Implement the <section title> section of the <spec name> spec.

See [spec](<specFile>#<anchor>) for requirements.
```

**Skip logic:**
- Skip sections that already have a ticket (scan `.tickets/impl/` for matching `links:` entries)
- Skip sections with anchors in SKIP_ANCHORS
- `--dry-run` prints what would be created without writing files

#### `opcom audit`

Traceability audit report. Shows spec coverage, orphan tickets, and link health across the workspace.

```bash
opcom audit                    # full audit across all projects
opcom audit --project opcom    # single project
opcom audit --verbose          # include file-level detail
```

**Output:**

```
TRACEABILITY AUDIT — opcom
============================================================

SPEC COVERAGE:
  Specs:              16
  With tickets:       14 (88%)
  With tests:          8 (50%)
  Fully covered:       6 (38%)    # has both tickets AND tests

TICKET HEALTH:
  Total tickets:      63
  With spec links:    51 (81%)    # have links: to a spec
  Without spec links: 12 (19%)   # VIOLATION: specs-before-tickets rule
  Closed with code:   28 (44%)
  Closed with tests:  22 (35%)

ORPHAN CODE:
  Source files:       142
  Covered by tickets:  98 (69%)
  Orphan files:        44 (31%)

  Top orphan directories:
    packages/core/src/cloud/     8 files
    packages/cli/src/commands/   6 files
    ...

LINK VALIDATION:
  Total links:        127
  Valid:              124
  Broken:               3
    - dashboard-deploy-status → docs/spec/cicd.md#dashboard-l1 (anchor not found)
    ...
```

**Data sources:**
- Without context-graph: scan `.tickets/impl/` for frontmatter, scan `docs/spec/` for files, validate link paths exist
- With context-graph: additionally check file-level coverage via graph edges, test assertions

#### `opcom trace <path>`

Reverse lookup: given a file path, show what specs and tickets cover it.

```bash
opcom trace packages/core/src/orchestrator/executor.ts
```

```
Coverage for: packages/core/src/orchestrator/executor.ts
============================================================

Specs:
  orchestrator.md         § Executor
  orchestrator.md         § Plan Stages
  verification.md         § Test Gate

Tickets:
  orchestrator-executor     [closed]
  plan-stages               [open]
  executor-test-gate        [closed]

Tests:
  tests/orchestrator/executor.test.ts
  tests/orchestrator/executor-worktree.test.ts

Total: 3 specs, 3 tickets, 2 test files
```

**Without graph:** Walk `.tickets/impl/*/README.md` for `code:` and `links:` fields matching the path. Walk `docs/spec/` for references.
**With graph:** `getEdgesTo(fileNodeId)` → follow `implements`, `asserts`, `links_to` edges.

#### `opcom coverage`

Spec-level coverage report — which specs are implemented, tested, and which have gaps.

```bash
opcom coverage                     # all specs
opcom coverage docs/spec/cicd.md   # one spec with section detail
```

```
SPEC COVERAGE
============================================================

 Spec                Sections  Tickets  Tests   Status
 detection              —        4        3    ✓ covered
 config                 —        2        2    ✓ covered
 adapters               —        8        5    ◐ partial
 orchestrator           12       8        4    ◐ partial
 tui                    —        6        2    ◐ partial
 cicd                   5        2        0    ○ no tests
 context-graph          8        7        1    ○ needs work
 integrations           7        1        0    ○ needs work
 verification           —        3        3    ✓ covered
 ...

 Summary: 16 specs, 10 covered (63%), 4 partial, 2 uncovered
```

With `--sections` or a specific spec file, drill into section-level coverage:

```
docs/spec/orchestrator.md — 12 sections, 8 tickets, 4 test files

 Section                     Ticket                    Tests
 § planner                   orchestrator-plan-engine   ✓ 2
 § executor                  orchestrator-executor      ✓ 2
 § planning-sessions         orchestrator-planning-…    ○ 0
 § ticket-hygiene            ticket-hygiene             ✓ 1
 § plan-overview-screen      plan-overview-screen       ○ 0
 § plan-stages               plan-stages                ○ 0
 ...
```

#### `opcom uc`

Use-case management with automated readiness checking.

```bash
opcom uc ls                    # list use cases with readiness %
opcom uc show UC-001           # show one use case with requirement status
opcom uc gaps UC-001           # show only unmet requirements
```

**Readiness checkers:**

Each `requires:` category has a checker that validates against project state:

```typescript
const UC_CHECKERS: Record<string, (item: string) => boolean> = {
  specs:    (name) => existsSync(`docs/spec/${name}.md`),
  features: (name) => checkFeatureImplemented(name),  // grep for key exports/types
  tickets:  (id)   => getTicketStatus(id) === "closed",
};

function computeReadiness(requires: Record<string, string[]>): {
  total: number;
  satisfied: number;
  details: Record<string, Array<{ item: string; ok: boolean }>>;
} {
  // For each category, run the checker on each item
}
```

**Output:**

```
UC-001: First-Run Onboarding
Status: partial  Priority: P0
Persona: Solo developer managing multiple projects with coding agents

Requirements: 8/11 satisfied (73%)

  specs: (6/6)
    [x] detection
    [x] config
    [x] adapters
    [x] integrations
    [x] cicd
    [x] tui

  features: (2/4)
    [x] project-detection
    [x] stack-detection
    [x] ticket-scanning
    [ ] integration-auto-detect
    [ ] cicd-dashboard-status

  tickets: (0/1)
    [ ] modular-integrations
```

## Phase 8: Multi-Project & Cross-Project Analysis {#phase-8}

*Status: NOT STARTED*

### P8.1: Cross-project graph

When opcom manages multiple projects, the graphs can be linked:

```sql
-- opcom knows folia uses types defined in @opcom/types
-- If both projects have graphs, cross-project edges are possible
INSERT INTO edges (source, target, relation, meta)
VALUES ('file:packages/core/src/agents/context-builder.ts',
        'ext:folia/folia/types.py',
        'references',
        '{"cross_project": true}');
```

### P8.2: Workspace-level drift

```bash
opcom graph drift --all    # Drift across all projects
opcom graph triage --all   # Cross-project triage
```

### P8.3: Shared pattern detection

When the same drift pattern appears across multiple projects (e.g., "connector files are never tested"), the triage agent can suggest a shared test template.

## Dependencies

```
Phase 1 ← DONE
Phase 2 ← P1 (graph exists to link results to)
Phase 3 ← P1 (replay exists, needs analysis queries)
Phase 4 ← P2 + P3 (drift needs test results + temporal data)
Phase 5 ← P4 (triage needs drift signals)
Phase 6 ← P5 (generation needs triage output)
Phase 7 ← P1 + P2 (opcom integration can start with just graph + results)
Phase 8 ← P7 (needs multi-project opcom)
```

Recommended build order: **P2 → P3 → P7.1-7.2 → P4 → P5 → P6 → P7.3-7.4 → P8**

P7.1-7.2 (opcom wiring) can happen early because it only needs the base graph.

## Non-Goals

- **Replacing test frameworks** — context-graph tracks and generates, doesn't run. Tests run via existing frameworks (pytest, vitest, etc.)
- **Real-time traffic recording** — the Keploy/API observation vector is a separate tool. Context-graph can ingest its output but doesn't capture traffic.
- **UI crawling** — same as above. A separate agent can crawl and feed results into the graph.
- **Replacing opcom scan** — scan is fast stack detection. Graph is deep structural analysis. Complementary.
- **Code coverage (line-level)** — we track spec-level and file-level coverage via graph edges, not line-by-line instrumentation. Istanbul/coverage.py output could be ingested later.
