---
id: add-logger-jsdoc
title: "Add unit test for createLogger namespace"
status: closed
type: chore
priority: 3
deps: []
links: []
---

# Add unit test for createLogger namespace

## Goal

Add a simple unit test that verifies `createLogger` returns a logger with the correct namespace prefix.

## Tasks

- [ ] Create `packages/core/src/logger.test.ts` with one test:
  - Call `createLogger("test-ns")` and verify the returned object has `debug`, `info`, `warn`, `error` methods
- [ ] Run `npx vitest run packages/core/src/logger.test.ts` to verify it passes
- [ ] Run the full test suite with `npx vitest run` to verify no regressions

## Acceptance Criteria

- New test file exists at `packages/core/src/logger.test.ts`
- Test passes when run with vitest
- Full test suite still passes
