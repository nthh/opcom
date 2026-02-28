# opcom — Roadmap

## Phase 1: Foundation ✓ DONE
Core types, auto-detection, config persistence, CLI skeleton.
- Types for all entity layers (workspace, project, work items, agents, detection)
- Three-tier detection: manifests → version files → source file globs
- Config file parsers for package.json, pyproject.toml, requirements.txt, docker-compose, firebase, wrangler, mise, go.mod, Cargo.toml, Gemfile
- Version file detection (.python-version, .nvmrc, .node-version, etc.)
- Monorepo tool detection (turbo, nx, lerna, pnpm workspaces)
- Ticket system detection and frontmatter parsing (.tickets/, trk)
- Git state extraction (branch, dirty, remote, last commit)
- Sub-project detection for monorepos
- YAML config persistence in ~/.opcom/
- CLI: init, add, scan, status
- 44 tests passing

## Phase 2: Agent Adapters + Session Manager
Wire up agents to projects and work items.

- **Claude Code adapter** — Spawn claude-code subprocess, NDJSON stream parsing, NormalizedEvent emission
- **Pi coding agent adapter** — JSON-line RPC, event subscription (from pi-mono reference)
- **Session Manager** — Track running sessions, link to projects + work items, persist session state
- **Context Builder** — Assemble context packets from project profile + ticket + spec for agent cold-start
- **Message routing** — Agent-to-agent messaging with delivery modes (prompt/followUp/steer), learned from middleman
- **Agent memory** — Per-session markdown memory files (~/.opcom/memory/<sessionId>.md), auto-loaded into context
- CLI: `opcom work <project>/<ticket>`, `opcom agent list/stop/prompt`

## Phase 3: Server + Process Manager
Persistent daemon for TUI/Web clients.

- **REST API** — Workspace, project, agent, work-item CRUD
- **WebSocket** — Streaming agent events, status changes, real-time updates
- **Process manager** — Start/stop project services (`opcom dev <project>`)
- **Merge coordination** — Dedicated merger role: serialize branch merges, run validation, resolve conflicts (middleman pattern)
- CLI: `opcom serve`, `opcom dev <project>`

## Phase 4: TUI
Terminal dashboard — the primary interface.

- **Split-pane layout** — Projects list | agent output | work items
- **Project view** — Stack summary, git state, ticket list sorted by priority
- **Agent view** — Streaming output, tool calls, status indicators
- **Work queue** — Priority-sorted tickets across all projects, filterable
- **Quick actions** — Start agent on ticket, stop agent, rescan, prompt
- **Keyboard-driven** — vim-style navigation, command palette

## Phase 5: Web UI
Browser dashboard for when you want more screen real estate.

- Served from opcom server (Phase 3)
- Same data as TUI, richer rendering (markdown, diffs, artifacts)
- Multi-agent split view (like middleman's chat UI)

## Phase 6: LLM Skills
Intelligence layer on top of structured data.

- **Briefing generation** — "What happened since yesterday?" across all projects
- **Triage** — "What should I work on next?" using ticket priority + git staleness + spec coverage
- **Context packets** — LLM-enhanced project summaries for agent onboarding (beyond what detection provides)
- **Oracle checking** — Verify agent output against specs and acceptance criteria
- **Work item generation** — Analyze codebase, suggest tickets for tech debt, missing tests, etc.

## Phase 7: Scheduling + Integrations
Automation and external connections.

- **Cron triggers** — Scheduled scans, status checks, agent tasks (middleman pattern)
- **Heartbeats** — Agent health monitoring, auto-restart on failure
- **Notifications** — Slack/Discord/Telegram when agents complete or need attention
- **GitHub integration** — Sync issues ↔ work items, auto-create PRs from agent work

## Phase 8: Operational Awareness
Full-stack visibility into deployed services and infrastructure.

- **Event store** — SQLite-backed agent event persistence, queryable analytics, historical session replay
- **CI/CD integration** — GitHub Actions pipeline tracking via CICDAdapter, polling + optional webhooks
- **K8s monitoring** — Kubernetes pod/deployment/service status via InfraAdapter, watch mode + log streaming
- **Dev environments** — Port registry, service health checks, dependency-ordered startup
- **Cloud service adapters** — Database (Turso, Neon, Prisma migrations), storage (R2, GCS), serverless (CF Workers, Firebase Functions), hosting (Firebase Hosting), mobile (Expo/EAS OTA)
- **TUI cloud sections** — L2 project detail gains DATABASES, STORAGE, SERVERLESS, HOSTING, MOBILE sections. L3 drill-down for service detail + logs
- CLI: `opcom cloud`, `opcom db`, `opcom deploy`, `opcom publish`, `opcom ci`, `opcom infra`
