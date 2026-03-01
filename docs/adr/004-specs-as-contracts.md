---
id: "004"
title: Specs are executable contracts, not aspirational docs
status: accepted
date: 2026-03-01
---

# ADR-004: Specs as Executable Contracts

## Context

opcom has 12 spec files in `docs/spec/` defining types, interfaces, and behavior. These are consumed by both humans and agents (via the context builder). The question: how formal should they be, and how do they relate to tickets and tests?

## Decision

Specs define **contracts** — the types, interfaces, and behavior that implementations must satisfy. They are:

- **Loaded into agent context** via `ticket.links` → context builder reads the spec file
- **Validated by the oracle** — oracle checks agent output against the spec's acceptance criteria
- **Referenced by tickets** — each ticket links to the spec section it implements
- **Not duplicated in tickets** — tickets say "what to build", specs say "how it should work"

The hierarchy:
```
Spec (contract)  →  Ticket (work item)  →  Agent (implementer)  →  Oracle (verifier)
                                                                      ↑
                                                                 Spec + criteria
```

ADRs record **why** decisions were made. Specs record **what** the system does. Tickets record **what to build next**.

## Consequences

- Agents get full spec context, not just ticket descriptions
- Oracle can verify against both acceptance criteria and spec invariants
- Specs must be kept up to date — stale specs cause oracle false positives
- New features require spec updates before (or alongside) ticket creation
