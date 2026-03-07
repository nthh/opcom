# TUI Specification (Phase 4)

The TUI is the primary interface for opcom. It's tmux if tmux understood your projects — you cycle through projects, see what's being worked on, jump into agent output, spin up work, all from one place.

## Navigation Model

Three levels of depth, vim-style. Esc goes up, Enter goes down.

```
Level 1: Dashboard          Level 2: Project Detail      Level 3: Agent/Ticket Focus
─────────────────           ───────────────────────      ─────────────────────────────
All projects at a glance    One project's full state     Full-screen agent output or
Work queue across all       Its tickets by priority      ticket detail with spec
Running agents summary      Its running agents
                            Its stack, git, services
```

### Level 1: Dashboard (home)

The view you see when you open opcom. Everything at a glance.

```
┌─ opcom ── personal workspace ──────────────────────────────────────────────┐
│                                                                             │
│  PROJECTS                    │  AGENTS (3 running)                          │
│                              │                                              │
│  ▸ mtnmap       main  27u   │  mtnmap/auth-migration                       │
│    Expo+Firebase+CF Workers  │    claude-code  streaming  14m  ctx: 62%     │
│    25 open / 31 total  3h   │    Editing app/src/auth/provider.tsx...       │
│                              │                                              │
│    folia        main  ✓     │  folia/tile-server-perf                       │
│    Python+Docker (trk)       │    claude-code  streaming  3m   ctx: 18%     │
│    35 open / 45 total  14h  │    Running: pytest tests/tiles/ -v            │
│                              │                                              │
│    conversi     main  ✓     │  folia/change-detection                       │
│    FastAPI+Docker            │    pi-opus      idle       22m  ctx: 84%     │
│    0 open  15h              │    Waiting for review                         │
│                              │                                              │
│    costli       (no git)    │                                               │
│    js+ts                    │                                               │
│                              │                                              │
│──────────────────────────────│                                              │
│  WORK QUEUE                  │                                              │
│                              │                                              │
│  P0  auth-migration        🤖│                                              │
│      mtnmap  feature         │                                              │
│  P1  tile-server-perf      🤖│                                              │
│      folia  feature          │                                              │
│  P1  change-detection      🤖│                                              │
│      folia  feature          │                                              │
│  P1  offline-sync            │                                              │
│      mtnmap  feature         │                                              │
│  P1  expo-testing            │                                              │
│      mtnmap  feature         │                                              │
│  P2  api-docs                │                                              │
│      conversi  docs          │                                              │
│                              │                                              │
├──────────────────────────────┴──────────────────────────────────────────────┤
│ enter:open  w:work  s:scan  p:prompt  S:stop  /:search  ?:help  q:quit     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Level 2: Project Detail (Enter on a project)

Everything about one project. Its tickets, agents, stack, git, services.

```
┌─ folia ── main ✓ ── Python+Docker (trk) ──────────────────────────────────┐
│                                                                             │
│  TICKETS (35 open / 45 total)       │  AGENTS (2)                           │
│                                     │                                       │
│  P0  change-detection          🤖   │  change-detection                     │
│      feature · geo, folia-core      │    pi-opus  idle  22m  ctx: 84%       │
│      deps: tile-format-v2           │    Last: "Finished implementation,    │
│                                     │    waiting for review"                 │
│  P1  tile-server-perf          🤖   │                                       │
│      feature · tiles                │  tile-server-perf                      │
│                                     │    claude-code  streaming  3m          │
│  P1  eudr-compliance                │    Running: pytest tests/tiles/ -v     │
│      feature · compliance           │                                       │
│                                     │──────────────────────────────────────  │
│  P1  worker-autoscaling             │  STACK                                │
│      feature · cloud                │    Python 3.10, JS/TS 20 (mise)       │
│                                     │    FastAPI, Click, Pydantic            │
│  P2  monitoring-dashboard           │    Docker, Cloudflare Workers, K8s     │
│      feature · observability        │    uv + hatch                          │
│                                     │    pytest, ruff, mypy                  │
│  P2  batch-processing               │                                       │
│      feature · folia-core            │  SERVICES                             │
│                                     │    postgres     :5432                  │
│  ... 28 more                        │    orchestrator :8000                  │
│                                     │    tiles        :8766                  │
│  CLOSED (10)                        │    agent                               │
│  ✓ tile-format-v2                   │    tests                               │
│  ✓ initial-setup                    │                                       │
│  ✓ geo-indexing                     │  SUB-PROJECTS (10)                     │
│  ...                                │    app, cloud, worker, workers, ...    │
│                                     │                                       │
├─────────────────────────────────────┴───────────────────────────────────────┤
│ enter:detail  w:work  esc:back  p:prompt  d:dev  g:git  ?:help              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Level 3: Agent Focus (Enter on an agent)

Full-screen streaming agent output. Like reading one tmux pane, but you can prompt it.

```
┌─ folia/tile-server-perf ── claude-code ── streaming ── ctx: 42% ───────────┐
│                                                                             │
│  I'll optimize the tile serving pipeline by adding a Redis caching layer.   │
│  Let me check the current test coverage first.                              │
│                                                                             │
│  > Read packages/tiles/src/server.py (245 lines)                           │
│                                                                             │
│  The current implementation fetches from PostGIS on every request. I'll     │
│  add a cache check before the database query.                               │
│                                                                             │
│  > Edit packages/tiles/src/server.py                                       │
│    + import redis                                                           │
│    + cache = redis.Redis(host="localhost", port=6379)                       │
│    ...                                                                      │
│                                                                             │
│  > Running: pytest tests/tiles/ -v                                         │
│    tests/tiles/test_server.py::test_tile_fetch PASSED                      │
│    tests/tiles/test_server.py::test_cache_hit PASSED                       │
│    tests/tiles/test_server.py::test_cache_miss PASSED                      │
│    tests/tiles/test_server.py::test_invalid_coords PASSED                  │
│    12 passed, 0 failed                                                      │
│                                                                             │
│  All tests pass. The caching layer reduces average response time from       │
│  ~200ms to ~15ms for cached tiles. Ready for review.                        │
│                                                                             │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░ ctx: 42%                         │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ esc:back  p:prompt  S:stop  m:merge  r:review  j/k:scroll  G:bottom        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Level 3: Ticket Focus (Enter on a ticket without an agent)

See the ticket detail, linked spec, then decide to start an agent.

```
┌─ folia/eudr-compliance ── P1 feature ── open ──────────────────────────────┐
│                                                                             │
│  EUDR Compliance Operation                                                  │
│                                                                             │
│  Status: open          Priority: P1                                         │
│  Type: feature         Services: folia-core, geo                            │
│  Deps: change-detection (open, agent running)                               │
│                                                                             │
│  ─── SPEC (docs/spec/OPERATIONS.md) ─────────────────────────────────────  │
│                                                                             │
│  ## EUDR Compliance                                                         │
│                                                                             │
│  The EU Deforestation Regulation requires supply chain actors to verify     │
│  that commodities are not produced on deforested land. This operation       │
│  compares satellite imagery across two time periods to detect forest        │
│  cover changes within specified geofenced areas.                            │
│                                                                             │
│  ### User Stories                                                           │
│  - US1 (P1): As a compliance officer, I can upload a geofenced area and    │
│    receive a deforestation risk assessment                                   │
│  - US2 (P2): As a compliance officer, I can view historical imagery        │
│    comparisons for any flagged area                                         │
│                                                                             │
│  ### Acceptance Scenarios                                                   │
│  - Given a GeoJSON polygon, When I run the EUDR check...                   │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ w:start agent  esc:back  ?:help                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## What makes this better than tmux

| tmux | opcom TUI |
|------|-----------|
| Panes are dumb rectangles | Panes know what project they show |
| You name sessions manually | Projects auto-detected with full context |
| `git status` in each pane | Git state shown inline, refreshed automatically |
| Scroll through terminal output to find status | Status dashboard with priority-sorted work queue |
| Start a new Claude session, re-explain everything | `w` on a ticket → agent starts with full context packet |
| Alt-tab between 6 panes to check agents | All agents listed with state + context usage |
| No idea which agent is working on what | Each agent linked to a specific work item |
| Agents can't talk to each other | Message routing between agents (worker → merger) |

## Panels

### Projects Panel (L1, left top)
- All workspace projects with one-line summary
- Git branch + dirty indicator + uncommitted count
- Ticket counts (open / total)
- Last commit age
- Running agent count per project

### Work Queue Panel (L1, left bottom)
- Priority-sorted tickets across ALL projects
- Filterable by priority (1-4 keys), project, type
- 🤖 icon on tickets with active agents
- Searchable with `/`

### Agents Panel (L1, right)
- All running agents with:
  - Project/ticket they're working on
  - Backend (claude-code, pi-opus, etc.)
  - State (streaming, idle, waiting, error)
  - Duration
  - Context window usage percentage
  - Last action summary (one line)

### Ticket List Panel (L2, left)
- All tickets for one project, grouped by status
- Shows: priority, title, type, services/domains, deps
- Deps shown with status (blocked if dep is open)

### Stack Panel (L2, right bottom)
- Full detected stack for one project
- Languages with versions, frameworks, package managers
- Infrastructure, version managers
- Testing framework, linting tools
- Services with ports
- Sub-projects

### Agent Output Panel (L3)
- Full streaming output from one agent
- Tool calls shown as collapsible sections
- File edits shown as diffs
- Test runs shown with pass/fail counts
- Context usage bar at bottom
- Scrollable history

## Keybindings

### Global
| Key | Action |
|-----|--------|
| `Esc` | Go up one level (L3→L2→L1) |
| `q` | Quit (from L1) or go up (from L2/L3) |
| `?` | Help overlay (includes spec-driven workflow guide) |
| `r` | Refresh status |

### Help Overlay (?): Workflow Guide

The `?` help overlay includes a brief workflow guide so the process is always one keystroke away:

```
  WORKFLOW

  1. Write spec        docs/spec/<feature>.md  (## Section {#anchor})
  2. Scaffold tickets   opcom scaffold <spec>   (or H → scaffold from TUI)
  3. Check health       H                       (audit + coverage)
  4. Assign agents      w                       (on a ticket)
  5. Track use cases    U                       (cross-cutting readiness)

  Spec-driven: every ticket links to a spec. Run `opcom audit` to check.
```

### Level 1: Dashboard
| Key | Action |
|-----|--------|
| `j/k` | Navigate project or work queue list |
| `Tab` | Switch focus: projects → work queue → agents |
| `Enter` | Drill into selected project, ticket, or agent |
| `w` | Start agent on selected work item |
| `s` | Rescan selected project |
| `S` | Stop selected agent |
| `p` | Prompt selected agent (inline input) |
| `/` | Search/filter work items |
| `1-4` | Filter work queue by priority |
| `a` | Toggle agents panel width (collapsed/expanded) |

### Level 2: Project Detail
| Key | Action |
|-----|--------|
| `j/k` | Navigate ticket list |
| `Tab` | Switch focus: tickets → agents → stack |
| `Enter` | Drill into selected ticket or agent |
| `w` | Start agent on selected ticket |
| `d` | Start dev services for this project |
| `s` | Rescan this project |
| `g` | Show git log |

### Level 3: Agent Focus
| Key | Action |
|-----|--------|
| `j/k` | Scroll output |
| `G` | Jump to bottom (latest output) |
| `g` | Jump to top |
| `p` | Prompt agent (input bar appears) |
| `S` | Stop agent |
| `m` | Request merge to target branch |
| `n/N` | Next/previous agent (cycle through running agents) |

### Level 3: Ticket Focus
| Key | Action |
|-----|--------|
| `j/k` | Scroll spec content |
| `w` | Start agent on this ticket |
| `e` | Open ticket file in $EDITOR |

## Traceability & Health {#traceability--health}

The TUI surfaces spec-driven development health at every level. The principle: you shouldn't need to run CLI commands to know if specs are covered, tickets are linked, or use cases are ready.

### Level 1: Health Bar

The status bar at the bottom of the dashboard shows workspace health at a glance:

```
┌─ opcom ── personal workspace ────────────────────────────────────────────┐
│  ...                                                                     │
├──────────────────────────────────────────────────────────────────────────┤
│ 16 specs (88% covered)  68 tickets (78% linked)  UC-001: 50%  0 broken  │
│ enter:open  w:work  H:health  U:use-cases  ?:help  q:quit               │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Specs covered**: how many specs have implementing tickets (from `opcom coverage`)
- **Tickets linked**: how many tickets link to a spec (from `opcom audit`)
- **UC readiness**: summary of use-case satisfaction (from `opcom uc`)
- **Broken links**: count of broken spec/ticket links (from `opcom audit`)

A red indicator appears if broken links > 0 or if tickets without spec links > 25%.

### Level 1: Health View (H key)

Pressing `H` from the dashboard opens a full-screen health overlay — the TUI equivalent of `opcom audit` + `opcom coverage`:

```
┌─ Workspace Health ───────────────────────────────────────────────────────┐
│                                                                           │
│  SPEC COVERAGE (16 specs)                                                │
│                                                                           │
│    Spec                  Tickets  Status                                  │
│    detection                 4    ● covered                               │
│    config                    0    ○ no tickets                             │
│    adapters                  6    ● covered                               │
│    orchestrator              8    ● covered                               │
│    tui                       9    ● covered                               │
│    cicd                      2    ● covered                               │
│    context-graph             7    ◐ partial                               │
│    integrations              1    ● covered                               │
│    ...                                                                    │
│                                                                           │
│  TICKET HEALTH                                                           │
│    With spec links:    53/68 (78%)                                        │
│    Without spec links: 15 tickets                                         │
│                                                                           │
│  BROKEN LINKS                                                            │
│    None                                                                   │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│ esc:back  Enter:drill into spec  ?:help                                   │
└───────────────────────────────────────────────────────────────────────────┘
```

Pressing `Enter` on a spec drills into section-level coverage (the `opcom coverage <spec>` view).

### Level 1: Use Cases View (U key)

Pressing `U` from the dashboard shows use-case readiness — the TUI equivalent of `opcom uc ls`:

```
┌─ Use Cases ──────────────────────────────────────────────────────────────┐
│                                                                           │
│  ID         Title                          Pri   Status    Done  Gaps     │
│  UC-001     First-Run Onboarding           P0    partial   7/14   7      │
│  UC-002     Agent Orchestration            P1    ready    12/12   0      │
│  UC-003     Multi-Project Planning         P2    blocked   4/9    5      │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│ esc:back  Enter:show details  g:gaps only  ?:help                         │
└───────────────────────────────────────────────────────────────────────────┘
```

Pressing `Enter` drills into the use case detail with per-requirement status (the `opcom uc show` view). Pressing `g` shows only unmet requirements (the `opcom uc gaps` view).

### Level 2: Project Specs Section

The L2 project detail view gains a SPECS section alongside STACK, showing which specs cover this project:

```
┌─ opcom ── main ✓ ── TypeScript ──────────────────────────────────────────┐
│                                                                           │
│  TICKETS (68)                  │  SPECS (covering this project)           │
│  ...                           │                                          │
│                                │    orchestrator     8 tickets  ● covered │
│                                │    tui              9 tickets  ● covered │
│                                │    context-graph    7 tickets  ◐ partial │
│                                │    adapters         6 tickets  ● covered │
│                                │    cicd             2 tickets  ● covered │
│                                │    config           0 tickets  ○ missing │
│                                │                                          │
│                                │  STACK                                   │
│                                │    TypeScript (Node16, ES2022)           │
│                                │    vitest, ESM                           │
│                                │    ...                                   │
```

### Level 3: Ticket Focus Enhancement

The existing L3 ticket focus view already shows the linked spec content. Traceability adds:
- **Coverage indicator** — does this ticket link to a spec? (green check or red warning)
- **Related tickets** — other tickets implementing the same spec section
- **Related tests** — test files covering the spec (from `opcom trace`)

```
┌─ opcom/plan-stages ── P2 feature ── open ────────────────────────────────┐
│                                                                           │
│  Plan stages: sequential rounds with approval gates                       │
│                                                                           │
│  Status: open          Priority: P2                                       │
│  Spec: orchestrator.md#plan-stages  ✓ linked                             │
│  Deps: orchestrator-plan-engine (closed), modular-integrations (closed)   │
│  Related: plan-overview-screen (same spec)                                │
│  Tests: tests/orchestrator/executor.test.ts (partial)                     │
│                                                                           │
│  ─── SPEC (docs/spec/orchestrator.md § Plan Stages) ──────────────────  │
│  ...                                                                      │
```

### Keybindings (additions)

#### Level 1: Dashboard
| Key | Action |
|-----|--------|
| `H` | Open health view (audit + coverage) |
| `U` | Open use cases view |

#### Health View
| Key | Action |
|-----|--------|
| `j/k` | Navigate spec or ticket list |
| `Enter` | Drill into spec section coverage |
| `Esc` | Back to dashboard |

#### Use Cases View
| Key | Action |
|-----|--------|
| `j/k` | Navigate use case list |
| `Enter` | Show use case detail |
| `g` | Show gaps only for selected use case |
| `Esc` | Back to dashboard |

## State Updates

- Git state: refreshed when entering project view, every 30s background poll
- Ticket counts: refreshed on scan, on agent completion event
- Agent status: real-time via WebSocket from station daemon
- Work queue: re-sorted when tickets change or agents start/stop
- Context usage: updated with each agent event
- Health data: refreshed on ticket/spec change, cached between views

## Technology Candidates

- **Ink** (React for CLI) — familiar React model, good for component composition
- **blessed / neo-blessed** — more traditional, lower level, better for complex layouts
- **terminal-kit** — good input handling, less layout tooling
- WebSocket client to opcom station daemon for real-time updates
- Falls back to direct file reads (polling) if no daemon running
