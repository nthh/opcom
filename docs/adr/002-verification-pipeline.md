---
id: "002"
title: Verify agent output with test gate + oracle
status: accepted
date: 2026-03-01
spec: docs/spec/verification.md
tickets: [oracle-verification-gate, executor-test-gate]
---

# ADR-002: Verification Pipeline for Agent Output

## Context

Agents complete steps, but the executor had no way to verify the work was correct. Write-count checking proved unreliable — agents stuck in permission loops generated high write counts with no useful output. We closed tickets that weren't done.

## Decision

After agent exit, run a two-stage verification pipeline:

1. **Test gate** (cheap, fast) — run `npm test`. If tests fail, step fails. No oracle needed.
2. **Oracle** (LLM call, optional) — evaluate git diff against acceptance criteria from the ticket spec. Per-criterion pass/fail with reasoning.

Test gate is on by default. Oracle is off by default (requires LLM config).

## Consequences

- Steps are only marked "done" after real validation, not just write counts
- Test failures are caught before oracle spend
- Oracle results are stored in the event store for historical analysis
- Failed steps include structured feedback that can be fed back to a retry agent
- Oracle adds latency and cost per step — kept optional for cost-sensitive workflows
