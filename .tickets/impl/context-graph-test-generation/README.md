---
id: context-graph-test-generation
title: "AI Test Generation from Triage Results"
status: open
type: feature
priority: 2
created: 2026-03-05
updated: 2026-03-05
milestone: phase-6
deps:
  - context-graph-llm-triage
links:
  - docs/spec/context-graph.md#phase-6
---

# AI Test Generation from Triage Results

## Goal

When triage identifies a real gap, an LLM agent generates tests. It receives spec content, implementing code, existing tests, and test hints — then writes new tests using the project's framework. Generated tests go through human review.

Three output formats: **unit/integration tests** (pytest, vitest), **e2e browser tests** (Playwright), and **API tests** (httpx, supertest). The generator selects format based on the drift signal type and the project's stack.

## Non-Goals

- We do NOT build a UI crawler or API traffic recorder. Those are external tools (Keploy, etc.) that feed results into Phase 2 ingestion.
- We do NOT maintain persistent browser sessions (no `js_repl`). We generate Playwright test _files_ that the project's test runner executes.
- We do NOT replace manual test writing. Generated tests are proposals for human review.

## Architecture

### Generator Interface

Each generator handles one output format. The CLI dispatches to the right generator based on the triage result's `action` and `testHints.testType` fields.

```
TriageResult (from Phase 5)
    ↓
TestGenerator.canGenerate(signal) → boolean
    ↓
TestGenerator.buildContext(signal, graph) → GenerationContext
    ↓
LLM call (context → test code)
    ↓
TestGenerator.parseOutput(response) → GeneratedTest[]
    ↓
TestGenerator.verify(tests) → VerificationResult
    ↓
Write to file (or --dry-run / --pr)
```

```typescript
interface TestGenerator {
  name: string;
  /** Does this generator handle this signal? */
  canGenerate(signal: TriageResult): boolean;
  /** Assemble the context packet for the LLM. */
  buildContext(signal: TriageResult, graph: GraphDatabase): Promise<GenerationContext>;
  /** Extract test files from LLM response. */
  parseOutput(response: string): GeneratedTest[];
  /** Run generated tests and report results. */
  verify(tests: GeneratedTest[]): Promise<VerificationResult>;
}

interface GeneratedTest {
  /** Where to write the test file (relative to project root). */
  path: string;
  /** The test code. */
  content: string;
  /** What spec section this test covers. */
  specRef: string;
  /** Classification: unit | integration | e2e | api | snapshot | benchmark */
  testType: string;
  /** Framework used: pytest | vitest | playwright | jest | httpx | supertest */
  framework: string;
}

interface VerificationResult {
  passed: boolean;
  /** stdout/stderr from test runner. */
  output: string;
  /** If failed, error context for retry. */
  errors?: string[];
  /** Duration in ms. */
  duration: number;
}

interface GenerationContext {
  /** The spec section content. */
  specContent: string;
  /** The implementing code (function, class, component, route handler). */
  sourceCode: string;
  /** Existing tests in the same module/file for convention matching. */
  existingTests: string;
  /** Project-level test preferences (framework, patterns, fixtures). */
  preferences: string;
  /** Extra context specific to the generator type. */
  extra: Record<string, string>;
}
```

### Three Generators

---

## US1: Unit/Integration Test Generator (P1 — MVP)

**As a** developer reviewing drift signals,
**I want** the agent to generate pytest/vitest tests for uncovered code,
**so that** I get a starting point I can review and merge.

### Context Packet

| Field | Source |
|-------|--------|
| `specContent` | Graph: `spec` node → read file at `path`, extract section matching `specRef` |
| `sourceCode` | Graph: `file` node targeted by drift signal → read implementing code |
| `existingTests` | Graph: edges where `relation = 'tests'` pointing at same source → read those test files |
| `preferences` | `~/.context/<project>/test-preferences.md` (user-maintained, few-shot examples) |

### Framework Detection

Detect from project files, in order:
1. `test-preferences.md` declares framework explicitly
2. `pyproject.toml` → `[tool.pytest]` → pytest
3. `vitest.config.ts` / `vite.config.ts` → vitest
4. `jest.config.*` → jest
5. `package.json` `scripts.test` → infer from command

### Prompt Template

```
You are generating {framework} tests for a {language} project.

## Spec Section
{specContent}

## Code Under Test
{sourceCode}

## Existing Test Conventions
{existingTests}

## Test Preferences
{preferences}

## Instructions
- Write tests that verify the spec section's behavioral claims
- Match the style and patterns of existing tests exactly
- Include a comment on each test referencing the spec: # Spec: {specRef}
- Use existing fixtures/helpers — do not reinvent them
- Each test should test one specific behavior
- Name tests descriptively: test_{behavior}_when_{condition}_then_{expected}

Output ONLY the test code, no explanation. Start with the file path as a comment:
# File: {targetPath}
```

### Tasks

- [ ] T1: `GenerationContext` builder — reads graph + files, assembles context packet
- [ ] T2: Unit test prompt template with framework-specific variants (pytest, vitest, jest)
- [ ] T3: Framework auto-detection from project markers
- [ ] T4: LLM response parser — extract file path + code from response
- [ ] T5: `context-graph generate-tests --dry-run` — show plan without writing
- [ ] T6: `context-graph generate-tests` — write test files
- [ ] T7: Verification loop — run test, if fails retry with error (max 2 retries)
- [ ] T8: Test preferences file discovery and loading
- [ ] T9: Tests with mocked LLM + fixture projects (Python + TS)

### Checkpoint

`context-graph generate-tests --dry-run` shows plan for top-5 triage results. `context-graph generate-tests` writes tests that pass on first or second try for at least 60% of signals.

---

## US2: Playwright E2E Test Generator (P1)

**As a** developer with UI specs that lack test coverage,
**I want** the agent to generate Playwright e2e tests from spec descriptions of UI behavior,
**so that** user-facing interactions are verified automatically.

### When This Fires

The drift engine (Phase 4) identifies signals where:
- A spec section describes UI behavior (mentions "click", "button", "page", "navigate", "form", "modal", "display", etc.)
- No existing Playwright test covers that spec section
- The triage agent (Phase 5) classifies as `action: write_test` with `testHints.testType: e2e`

### Context Packet

| Field | Source |
|-------|--------|
| `specContent` | Spec section describing the UI behavior |
| `sourceCode` | Component code (React/Vue/Svelte) that implements the behavior |
| `existingTests` | Existing `*.spec.ts` Playwright tests for pattern/selector conventions |
| `preferences` | Test preferences (base URL, auth setup, page object patterns) |
| `extra.appUrl` | Dev server URL (from `test-preferences.md` or `playwright.config.ts`) |
| `extra.selectors` | Data-testid patterns used in existing tests |
| `extra.pageObjects` | Page object files if the project uses that pattern |

### Playwright Config Detection

1. `playwright.config.ts` / `playwright.config.js` → extract `baseURL`, `testDir`, projects
2. If no config exists, skip Playwright generation (project doesn't use it)
3. Parse existing `*.spec.ts` files for selector patterns (`data-testid`, role selectors, CSS)

### Prompt Template

```
You are generating Playwright e2e tests for a web application.

## Spec Section (What the UI Should Do)
{specContent}

## Component Code (Implementation)
{sourceCode}

## Existing Playwright Tests (Follow These Patterns)
{existingTests}

## Test Preferences
{preferences}

## App Configuration
- Base URL: {extra.appUrl}
- Selector convention: {extra.selectors}

## Instructions
- Write a Playwright test that verifies the spec's behavioral claims through real browser interaction
- Use the SAME selector patterns as existing tests (data-testid preferred, then role selectors)
- Each test should: navigate to the right page, perform the user action, assert the expected outcome
- Use `test.describe` to group related assertions under the spec section name
- Include `// Spec: {specRef}` comment on each test
- Prefer `await expect(locator).toBeVisible()` over `waitForSelector`
- Use `page.getByRole()`, `page.getByTestId()`, `page.getByText()` — never raw CSS selectors unless existing tests do
- If the spec describes a multi-step flow, use `test.step()` blocks
- DO NOT use `page.waitForTimeout()` — use Playwright's auto-waiting

Output ONLY the test code. Start with:
// File: {targetPath}
```

### Generated Test Shape

```typescript
// File: tests/e2e/layer-save.spec.ts
// Spec: LAYERS.md#3.2
import { test, expect } from '@playwright/test';

test.describe('Layer Save — LAYERS.md §3.2', () => {
  test('clicking Save persists layer to workspace', async ({ page }) => {
    // Spec: "Users can save a configured layer to their workspace"
    await page.goto('/workspace/test-workspace');

    await test.step('configure a layer', async () => {
      await page.getByTestId('add-layer-button').click();
      await page.getByRole('textbox', { name: 'Layer name' }).fill('My Layer');
      await page.getByTestId('layer-type-select').selectOption('source');
    });

    await test.step('save the layer', async () => {
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Layer saved')).toBeVisible();
    });

    await test.step('verify persistence', async () => {
      await page.reload();
      await expect(page.getByText('My Layer')).toBeVisible();
    });
  });
});
```

### Verification

```bash
# Run just the generated test
npx playwright test tests/e2e/layer-save.spec.ts --reporter=json

# Parse JSON report → pass/fail per test
# On failure: include error + screenshot in retry context
```

**Requires dev server running.** The verify step must:
1. Check if dev server is running at `baseURL` (quick HTTP ping)
2. If not running, warn and skip verification (test is still written, just unverified)
3. If running, execute test, capture JSON report + screenshots on failure

### Tasks

- [ ] T10: Playwright config detection and parsing
- [ ] T11: Existing Playwright test scanner (selector patterns, page objects, conventions)
- [ ] T12: Playwright e2e prompt template
- [ ] T13: Generated test path resolution (`playwright.config.ts testDir` or `tests/e2e/`)
- [ ] T14: Verification runner — `npx playwright test <file> --reporter=json`
- [ ] T15: Dev server liveness check before verification
- [ ] T16: Screenshot capture on failure → include in retry context packet
- [ ] T17: Tests with fixture project (minimal Playwright setup + mock LLM)

### Checkpoint

Given a spec section that says "clicking X does Y", the generator produces a Playwright test that navigates, clicks, and asserts. The test uses the project's existing selector conventions. If the dev server is running, the test executes and passes.

---

## US3: API Test Generator (P1)

**As a** developer with untested API endpoints,
**I want** the agent to generate API tests from spec contracts,
**so that** route handlers are verified against their documented behavior.

### When This Fires

The drift engine identifies signals where:
- A spec section describes an API endpoint (mentions HTTP methods, paths, request/response schemas)
- No existing test covers that endpoint
- Triage classifies as `action: write_test` with `testHints.testType: api`

### Context Packet

| Field | Source |
|-------|--------|
| `specContent` | Spec section describing the API contract |
| `sourceCode` | Route handler code (FastAPI route, Express handler, etc.) |
| `existingTests` | Existing API tests for pattern matching (client setup, auth, fixtures) |
| `preferences` | Test preferences (base URL, auth tokens, test DB setup) |
| `extra.schemas` | Request/response schemas (Pydantic models, Zod schemas, OpenAPI) |
| `extra.framework` | API framework detected (fastapi, express, hono, flask) |
| `extra.clientSetup` | How existing tests create the test client (TestClient, supertest, etc.) |

### API Framework Detection

| Marker | Framework | Test Client |
|--------|-----------|-------------|
| `from fastapi import` in route file | FastAPI | `httpx.AsyncClient` + `TestClient` |
| `from flask import` | Flask | `app.test_client()` |
| `from hono import` or `new Hono()` | Hono | `app.request()` |
| `express()` or `Router()` | Express | `supertest(app)` |
| `Elysia` | Elysia | `app.handle()` |

### Prompt Template

```
You are generating API tests for a {framework} application using {testClient}.

## Spec Section (API Contract)
{specContent}

## Route Handler Code
{sourceCode}

## Request/Response Schemas
{extra.schemas}

## Existing API Tests (Follow These Patterns)
{existingTests}

## Client Setup Pattern
{extra.clientSetup}

## Test Preferences
{preferences}

## Instructions
- Write tests that verify each behavioral claim in the spec section
- Test the HTTP contract: method, path, status code, response shape, error cases
- Match existing test patterns exactly (client creation, auth, fixtures, assertions)
- Include `# Spec: {specRef}` comment on each test
- Test BOTH success and error paths documented in the spec
- For mutations (POST/PUT/DELETE): verify the side effect (GET after POST, etc.)
- Use the project's existing test fixtures for DB setup/teardown — do not create new ones
- If the spec mentions auth requirements, test both authenticated and unauthenticated

Output ONLY the test code. Start with:
# File: {targetPath}
```

### Generated Test Shape (Python/FastAPI)

```python
# File: tests/test_api_layers.py
# Spec: LAYERS.md#4.1
import pytest
from httpx import AsyncClient

# Spec: LAYERS.md §4.1 — Create Layer endpoint
class TestCreateLayer:
    """POST /api/layers — create a new layer in a workspace."""

    @pytest.mark.asyncio
    async def test_create_layer_success(self, client: AsyncClient, workspace):
        # Spec: "Returns 201 with the created layer object"
        resp = await client.post(
            f"/api/workspaces/{workspace.id}/layers",
            json={"name": "test-layer", "type": "source", "uri": "s3://bucket/data.tif"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "test-layer"
        assert body["type"] == "source"
        assert "id" in body

    @pytest.mark.asyncio
    async def test_create_layer_duplicate_name_409(self, client: AsyncClient, workspace):
        # Spec: "Returns 409 if a layer with the same name already exists"
        payload = {"name": "duplicate", "type": "source", "uri": "s3://bucket/a.tif"}
        await client.post(f"/api/workspaces/{workspace.id}/layers", json=payload)
        resp = await client.post(f"/api/workspaces/{workspace.id}/layers", json=payload)
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_create_layer_unauthorized_401(self, anon_client: AsyncClient, workspace):
        # Spec: "Requires authentication"
        resp = await anon_client.post(
            f"/api/workspaces/{workspace.id}/layers",
            json={"name": "x", "type": "source", "uri": "s3://b/c.tif"},
        )
        assert resp.status_code == 401
```

### Generated Test Shape (TypeScript/Hono)

```typescript
// File: tests/api/layers.test.ts
// Spec: LAYERS.md#4.1
import { describe, it, expect } from 'vitest';
import { app } from '../../src/app';

describe('POST /api/layers — LAYERS.md §4.1', () => {
  it('returns 201 with created layer', async () => {
    // Spec: "Returns 201 with the created layer object"
    const resp = await app.request('/api/workspaces/test/layers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-layer', type: 'source' }),
    });
    expect(resp.status).toBe(201);
    const body = await resp.json();
    expect(body.name).toBe('test-layer');
  });
});
```

### Verification

```bash
# Python
uv run pytest tests/test_api_layers.py -v --tb=short -q

# TypeScript
npx vitest run tests/api/layers.test.ts --reporter=json
```

**No running server needed** for most API frameworks — test clients (TestClient, supertest, app.request()) run in-process. This is a key advantage over Keploy's approach.

### Schema Extraction

For assembling `extra.schemas`, scan the route handler for:
- **Python:** Pydantic model references in type hints (`def create_layer(body: CreateLayerRequest)`)
- **TypeScript:** Zod schemas, TypeScript interfaces in request validation
- **OpenAPI:** If `openapi.json` / `openapi.yaml` exists, extract the endpoint's schema

Read the referenced schema files and include them verbatim in the context packet.

### Tasks

- [ ] T18: API framework detection from route handler imports
- [ ] T19: Schema extraction — find Pydantic/Zod/OpenAPI schemas referenced by route
- [ ] T20: Client setup pattern extraction from existing API tests
- [ ] T21: API test prompt template with framework-specific variants
- [ ] T22: Verification runner — `pytest`/`vitest` with JSON output parsing
- [ ] T23: Tests with fixture project (FastAPI + Hono, mock LLM)

### Checkpoint

Given a spec section describing "POST /api/layers returns 201", the generator produces a test that creates a test client, sends the request, and asserts status + response shape. Tests use existing fixtures and pass without manual editing for simple CRUD endpoints.

---

## US4: PR Workflow & Feedback Loop (P2)

**As a** developer,
**I want** generated tests submitted as a PR I can review,
**so that** I can approve, modify, or reject them with feedback that improves future generation.

### Tasks

- [ ] T24: `context-graph generate-tests --pr` — create branch + commit + open PR via `gh`
- [ ] T25: PR description includes: drift signal, spec reference, triage reasoning, test plan
- [ ] T26: Feedback recording — when PR is merged/closed, record outcome in graph
- [ ] T27: `generated_tests` table in schema: path, specRef, testType, framework, status (pending/approved/modified/rejected), feedback
- [ ] T28: Rejection reasons stored as few-shot negative examples for triage refinement
- [ ] T29: Integration with opcom work items — generation creates tickets that agents work on

### Checkpoint

`--pr` creates a reviewable PR. Merged PRs update the graph to show coverage improved. Rejected PRs store feedback that reduces future false positives.

---

## US5: Test Preferences & Few-Shot Learning (P2)

**As a** developer,
**I want** to configure test generation preferences per project,
**so that** generated tests match my team's conventions without manual editing.

### Preferences File

Location: `~/.context/<project>/test-preferences.md` (or `.context/test-preferences.md` in project root)

```markdown
# Test Preferences

## Framework
- Python: pytest with pytest-asyncio
- TypeScript: vitest

## Conventions
- Use `client` fixture from conftest.py for API tests
- Use `workspace` fixture for tests needing a workspace
- Never use `unittest.TestCase` — always plain functions
- Group related tests in classes (Python) or describe blocks (TS)

## Playwright
- Base URL: http://localhost:3000
- Selector convention: data-testid preferred
- No page objects — inline selectors
- Use `test.step()` for multi-step flows

## API Testing
- Use `httpx.AsyncClient` with `app` fixture
- Always test 401 for authenticated endpoints
- Always test 422 for invalid input

## Examples

### Good test (copy this style)
```python
@pytest.mark.asyncio
async def test_list_layers_returns_workspace_layers(self, client, workspace):
    resp = await client.get(f"/api/workspaces/{workspace.id}/layers")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
```

### Bad test (avoid this)
```python
# Too vague, no spec reference, hardcoded values
def test_it_works():
    assert True
```
```

### Tasks

- [ ] T30: Preferences file discovery (project root, then ~/.context/)
- [ ] T31: Preferences parsing into structured config
- [ ] T32: Few-shot example extraction from preferences for prompt injection
- [ ] T33: Auto-generate initial preferences from existing test analysis

### Checkpoint

`context-graph generate-tests --init-preferences` analyzes existing tests and produces a starter `test-preferences.md`. Subsequent generation uses these preferences to match project style.

---

## Verification Loop (All Generators)

All generators share the same verification flow:

```
1. Write test to temp file (e.g., /tmp/context-graph-gen/test_foo.py)
2. Run test runner against temp file
3. If PASS → move to target location, record in graph as status=pending
4. If FAIL (attempt 1) → include error in retry context, re-prompt LLM
5. If FAIL (attempt 2) → include error in retry context, re-prompt LLM
6. If FAIL (attempt 3) → write to target with `@pytest.mark.skip(reason="generated: needs manual fix")`
                          record in graph as status=needs_fix
```

**Runner commands by framework:**

| Framework | Command | Report Flag |
|-----------|---------|-------------|
| pytest | `uv run pytest {file} -v --tb=short -q` | `--json-report --json-report-file=report.json` |
| vitest | `npx vitest run {file}` | `--reporter=json` |
| playwright | `npx playwright test {file}` | `--reporter=json` |
| jest | `npx jest {file}` | `--json --outputFile=report.json` |

---

## Graph Integration

### New Node Type

```
generated_test — a test the system proposed
```

### New Edge Relations

```
generated_test --covers--> spec      (which spec section)
generated_test --tests-->  file      (which source file)
generated_test --from-->   drift     (which drift signal triggered it)
```

### Schema Addition (Phase 6)

```sql
CREATE TABLE IF NOT EXISTS generated_tests (
    id          TEXT PRIMARY KEY,   -- gen:test_api_layers::test_create_layer
    path        TEXT NOT NULL,      -- tests/test_api_layers.py
    spec_ref    TEXT,               -- LAYERS.md#4.1
    test_type   TEXT NOT NULL,      -- unit | e2e | api
    framework   TEXT NOT NULL,      -- pytest | playwright | vitest
    status      TEXT NOT NULL,      -- pending | approved | modified | rejected | needs_fix
    feedback    TEXT,               -- rejection reason (for few-shot learning)
    created_at  TEXT NOT NULL,
    resolved_at TEXT,
    signal_id   TEXT                -- drift signal that triggered generation
);
```

---

## Acceptance Criteria

### Unit/Integration (US1)
- [ ] Generated tests use the correct framework (auto-detected from project)
- [ ] Each test includes `# Spec: <section>` comment
- [ ] `--dry-run` shows the plan without writing files
- [ ] Generated tests pass on first or second try for >= 60% of signals
- [ ] Tests use existing fixtures — no new conftest.py boilerplate

### Playwright E2E (US2)
- [ ] Generator only activates when `playwright.config.ts` exists in project
- [ ] Generated tests use the project's selector convention (auto-detected)
- [ ] Tests use `test.describe` + `test.step` for multi-step flows
- [ ] Dev server liveness check before running verification
- [ ] Screenshots captured on failure and included in retry context

### API Tests (US3)
- [ ] Framework auto-detected from route handler imports
- [ ] Request/response schemas extracted and included in context
- [ ] Both success AND error paths tested (status codes from spec)
- [ ] Test client setup matches existing test patterns
- [ ] No running server needed — in-process test clients

### Cross-Cutting
- [ ] `--pr` creates a branch and opens a PR with spec references in description
- [ ] Rejected test feedback stored in graph for triage refinement
- [ ] `test-preferences.md` respected when present
- [ ] Generated tests actually pass when run (verified by test gate)
- [ ] Results recorded in `generated_tests` table for tracking

## Risks

- **LLM hallucinating selectors/routes:** Mitigated by including actual component/handler code in context. Verification loop catches bad selectors.
- **Flaky Playwright tests:** Generated tests should use auto-waiting, never `waitForTimeout`. Preferences file can include anti-patterns to avoid.
- **Fixture drift:** If the project's fixtures change, generated tests may use stale patterns. The `existingTests` context is always fresh from disk.
- **Cost:** Each generation = 1 LLM call + up to 2 retries. Batch similar signals to reduce calls. Use Haiku for simple unit tests, Sonnet for e2e/API.
