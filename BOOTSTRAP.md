You are building opcom, a developer workspace manager at ~/projects/opcom.
Phase 1 (detection, types, config, CLI) is complete. Build everything else.

## Step 1: Understand the project

Read in this order:
1. ~/projects/opcom/CLAUDE.md — overview, conventions, commands
2. ~/projects/opcom/docs/VISION.md — full vision, user story, architecture, prior art
3. ~/projects/opcom/docs/ROADMAP.md — all phases
4. ~/projects/opcom/docs/spec/adapters.md — agent + project adapters, context packets, message routing
5. ~/projects/opcom/docs/spec/normalized-events.md — event normalization
6. ~/projects/opcom/docs/spec/server-api.md — REST + WebSocket protocol
7. ~/projects/opcom/docs/spec/tui.md — TUI spec with three-level navigation
8. ~/projects/opcom/docs/spec/detection.md — detection system (already built)
9. ~/projects/opcom/docs/spec/config.md — config format (already built)

Read ALL tickets — these are your work items with dependency chains:
  ls ~/projects/opcom/.tickets/impl/
  Read the README.md in each directory.

Read the existing code to understand patterns:
  ~/projects/opcom/packages/types/src/ (all files)
  ~/projects/opcom/packages/core/src/ (index.ts, detection/detect.ts, config/loader.ts, detection/tickets.ts)
  ~/projects/opcom/packages/cli/src/ (index.ts, commands/, ui/format.ts)
  ~/projects/opcom/vitest.config.ts

Run: cd ~/projects/opcom && npm test
Verify: 44 tests pass.

## Step 2: Build everything

Follow the ticket dependency chain. The tickets have deps fields — respect them.
Here is the recommended order:

PHASE 2 — Agent layer
  1. phase-2-agent-adapters (P0, no deps) — AgentAdapter interface + Claude Code adapter
  2. phase-2-opencode-adapter (P1, deps: agent-adapters) — OpenCode HTTP/SDK adapter
  3. phase-2-session-manager (P0, deps: agent-adapters) — track sessions, persist state
  4. phase-2-context-builder (P1, deps: session-manager) — assemble context packets
  5. phase-2-message-routing (P2, deps: session-manager) — inter-agent messaging
  6. phase-2-cli-work (P1, deps: context-builder) — opcom work + agent commands
  7. phase-2-jira-adapter (P1, no deps) — Jira as project adapter (can be parallel with above)

PHASE 3 — Server + infrastructure
  8. phase-3-server (P0, deps: session-manager, message-routing) — station daemon
  9. phase-3-channel-adapters (P1, deps: server) — Slack, WhatsApp, Telegram
  10. phase-3-merge-coordination (P1, deps: server, message-routing) — merge queue
  11. phase-3-process-manager (P2, deps: server) — dev services

PHASE 4 — TUI
  12. phase-4-tui-foundation (P0, deps: server) — framework, layout, WebSocket client
  13. phase-4-tui-navigation (P0, deps: tui-foundation) — three-level drill-down
  14. phase-4-tui-agent-view (P1, deps: tui-navigation) — streaming output + interaction

PHASE 5 — Web
  15. phase-5-web-ui (P2, deps: server)

PHASE 6 — LLM skills
  16. phase-6-briefings (P2, deps: server)
  17. phase-6-triage (P2, deps: briefings)
  18. phase-6-oracle (P3, deps: triage)

PHASE 7 — Automation
  19. phase-7-scheduling (P3, deps: server)
  20. phase-7-integrations (P3, deps: server, scheduling)

## Conventions (CRITICAL)

- Follow existing patterns. Read how detection/ and config/ are structured before writing new code.
- Pure ESM, TypeScript strict, Node16 module resolution
- Tests use vitest with path aliases (see vitest.config.ts)
- Do NOT spawn real agent processes in unit tests — use fixture data and mocks
- Keep packages/core for runtime logic, packages/types for pure types, packages/cli for CLI
- New domains go in packages/core/src/<domain>/ (e.g., packages/core/src/agents/)
- Run npm test frequently. Run npx tsc -b to verify builds.
- When adding dependencies, prefer small focused packages. The project uses yaml, smol-toml already.
- Update packages/core/src/index.ts exports as you add modules
- Update ticket status in .tickets/ README.md frontmatter as you complete work (status: closed)

## What success looks like

- All ticket acceptance criteria met
- npm test passes with comprehensive test coverage
- npx tsc -b compiles clean
- opcom work <project>/<ticket> starts an agent with context
- opcom serve runs a daemon that TUI connects to
- TUI shows projects, agents, work queue with three-level navigation
- Agent output streams in real-time
- The whole system works end-to-end

Build as far as you can. Prioritize working software over completeness — a working Phase 2+3+4 is better than a half-built Phase 2-7.
