# opcom — Cloud Platform

## Model

opcom is open-core:

- **`npx opcom`** — Free, open source CLI. Project detection, ticket scanning, agent orchestration, TUI. Runs locally, always free.
- **Cloud platform** (remolt.dev / opcom.dev / TBD) — Paid hosted service. Sandboxed cloud environments with opcom pre-installed, templates, deployment pipeline, agent compute.

The split is natural: the expensive parts (compute, agent API calls, storage, deployments) live on the paid side. Users pay for resources, not feature gates.

## Why

opcom has a cold-start problem. Users need to install it, have projects, have tickets, configure things — before they ever see value. The cloud platform inverts this:

1. User opens the site
2. Picks a template (or starts blank)
3. Lands in a running opcom TUI in the browser
4. An agent is already working a ticket
5. User watches, explores the dashboard, starts more agents
6. They learn opcom by using it on a real project with real tasks

Show, don't tell — as a product architecture.

## What Exists Already

**Remolt.dev** is a sandboxed AI coding platform (K8s on Vultr, React + xterm.js frontend, FastAPI backend). It already provides:

- Cloud sandboxes — K8s pods per user, Ubuntu 24.04, isolated networking
- Browser terminal — xterm.js + WebSocket TTY, full color, resize
- Agent plugin system — Claude Code and OpenClaw, extensible via `agents/*/agent.json`
- GitHub OAuth — Token injection into containers, git/gh CLI ready
- Session persistence — tmux survives disconnects, session recovery across restarts
- VS Code in browser — code-server on port 18080
- Warm pool — Pre-warmed pods for fast spin-up
- Security — Network isolation, non-root containers, ephemeral credentials, per-user session limits
- Analytics — Structured JSON event logging

**opcom** provides:

- Project detection — Three-tier stack scanning (manifests → version files → source globs)
- Ticket systems — `.tickets/`, trk, GitHub Issues → normalized work items
- Agent orchestration — Session manager, context builder, message routing
- TUI dashboard — Projects, agents, work items, streaming output
- CI/CD integration — GitHub Actions polling
- Cloud service awareness — Database, storage, serverless, hosting adapters

Remolt solved the hard infrastructure problems. opcom solved the hard product problems. Combining them is integration work, not new invention.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Cloud Platform                  │
│                                                  │
│  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Web Frontend  │  │    Template Registry     │ │
│  │ (React/xterm) │  │  (git repos + .opcom/)   │ │
│  └──────┬───────┘  └───────────┬──────────────┘ │
│         │                      │                 │
│  ┌──────▼──────────────────────▼──────────────┐ │
│  │            Platform API (FastAPI)           │ │
│  │  Sessions · Auth · Billing · Templates     │ │
│  └──────────────────┬─────────────────────────┘ │
│                     │                            │
│  ┌──────────────────▼─────────────────────────┐ │
│  │           K8s Pod (per user session)         │ │
│  │                                             │ │
│  │   ┌─────────────────────────────────────┐   │ │
│  │   │  opcom (TUI as primary interface)   │   │ │
│  │   │  ┌─────────┬──────────┬──────────┐  │   │ │
│  │   │  │ Station │ Agents   │ Context  │  │   │ │
│  │   │  │ Server  │ (Claude) │ Builder  │  │   │ │
│  │   │  └─────────┴──────────┴──────────┘  │   │ │
│  │   └─────────────────────────────────────┘   │ │
│  │                                             │ │
│  │   ~/workspace/  (template or user project)  │ │
│  │   code-server   (VS Code tab)               │ │
│  │   git + gh      (GitHub integration)        │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

## Templates

A template is a git repo with opcom config pre-seeded:

```
saas-starter/
├── .opcom/
│   └── workspace.yaml         # project pre-registered
├── .tickets/
│   ├── auth-system.md         # P0 — "Add user authentication"
│   ├── landing-page.md        # P1 — "Build the landing page"
│   ├── api-endpoints.md       # P1 — "Create REST API"
│   └── deploy-pipeline.md     # P2 — "Set up CI/CD"
├── package.json
├── docker-compose.yml
└── src/
    └── ...
```

When a user picks a template:
1. Pod spins up (from warm pool if available)
2. Template repo cloned into `~/workspace/`
3. opcom starts, detects the project, reads tickets
4. opcom TUI launches as the default interface
5. Agent auto-starts on the first P0 ticket

User lands mid-action: dashboard visible, agent already working. They learn by watching and interacting.

Template categories (examples):
- **SaaS starter** — Next.js + Postgres + Stripe
- **API service** — FastAPI + Docker + tests
- **Mobile app** — Expo + Firebase
- **Full-stack** — React + Node + K8s
- **Blank** — Empty workspace, bring your own repo

## Product Tiers

```
OPEN SOURCE (npx opcom)
  Local CLI, full feature set, always free
  Self-host remolt for your own cloud environments

CLOUD FREE
  Ephemeral sessions (30-min timeout)
  1 agent at a time
  Template access
  No persistence — sandbox destroyed on close

CLOUD PRO
  Persistent environments (survive session close)
  Multiple concurrent agents
  GitHub integration (push, PRs, deploy)
  Deploy targets (preview URLs, production)
  Larger pods (more CPU/RAM)
  Private templates
  Priority warm pool
```

## User Funnel

```
Visit site → live example session (free, ephemeral)
  → sign up → persistent environment
    → use templates → agents build your app
      → deploy from platform → paying customer
        → outgrow cloud → install opcom locally (still free)
          → keep deploying through platform (still paying)
```

The local CLI isn't a downgrade — it's what power users graduate to. They still come back for deployments, environments, and agent compute.

## What Needs Building

### Already done (in remolt or opcom)
- Container orchestration (K8s pods, warm pool, cleanup)
- Browser terminal (xterm.js, WebSocket, tmux persistence)
- Agent plugins (Claude Code, extensible)
- GitHub OAuth + token injection
- Project detection + ticket scanning + agent orchestration
- TUI dashboard

### Integration work
- opcom as default shell in remolt containers (replace blank terminal with opcom TUI)
- Template selector in remolt SetupForm (replace "pick an agent" with "pick a template")
- opcom Station serving the web UI inside pods (Phase 3 server becomes the bridge)

### New work
- Template registry (start as a JSON manifest, evolve later)
- Billing system (Stripe integration, usage metering)
- Persistent storage per user (PVCs that survive session restarts)
- Deploy adapter (Vercel API, Cloudflare Pages, or built-in)
- User dashboard (account, sessions, usage, billing)

## Open Questions

- **Domain**: remolt.dev, opcom.dev, or something new?
- **Template curation**: Community-contributed or first-party only at launch?
- **Deploy targets**: Build our own (like Vercel) or integrate with existing platforms?
- **Pricing model**: Per-minute compute, monthly plans, or hybrid?
