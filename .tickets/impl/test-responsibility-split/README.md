---
id: test-responsibility-split
title: "Test responsibility split: agent runs relevant tests, verifier runs full suite"
status: closed
type: feature
priority: 1
deps:
  - executor-test-gate
  - agent-roles
links:
  - docs/spec/verification.md
  - docs/spec/roles.md
services:
  - core
---

# Test responsibility split: agent runs relevant tests, verifier runs full suite

## Goal

Separate testing responsibilities between the agent and the verification pipeline. Agents run only the tests relevant to their changes during development (fast feedback loop). The verifier runs the full project test suite after the agent exits (authoritative gate). This avoids redundant compute and prevents agents from entering long, counterproductive fix cycles on unrelated test failures.

## Tasks

- [x] Update engineer role instructions in `packages/core/src/config/roles.ts`
  - [x] Replace "Run the project's test command before finishing" with "Run tests relevant to your changes during development (specific test files, not the full suite)"
  - [x] Add instruction: "The full test suite will be run by the verification pipeline after you finish. Do not run it yourself."
  - [x] Update doneCriteria to "Code committed. Relevant tests passing."
- [x] Update QA role instructions in `packages/core/src/config/roles.ts`
  - [x] "Run the test files you wrote to verify they pass. Do not run the full test suite."
- [x] Update default (no-role) instructions in `packages/core/src/agents/context-builder.ts`
  - [x] Match the engineer role's test responsibility language
- [x] Tests for role instruction content

## Acceptance Criteria

- Engineer role instructions tell agents to run relevant tests only, not the full suite
- Engineer doneCriteria says "Relevant tests passing" (not "All tests passing")
- QA role instructions say "Run the test files you wrote"
- Default (no-role) context builder instructions match the engineer role's test split language
- Engineer instructions do NOT contain "Run the project's test command before finishing"
