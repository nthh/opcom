# opcom — Vision

## Problem

You're managing multiple projects with coding agents. You've got Claude Code in three terminals, worktrees everywhere, tickets in `.tickets/` and trk, git branches piling up. You're not coding anymore — you're a manager doing standups with five agents all day.

The two things eating your time:
1. **What needs doing?** — Checking tickets, figuring out priority, understanding project state across repos
2. **What are my agents doing?** — Context-switching between terminals, checking if agents are stuck, feeding them the right context

Today these are fully manual. You onboard each agent conversationally, track work in your head, and alt-tab between sessions. Every new session starts cold.

## Solution

opcom is a developer workspace manager that eliminates the meta-work:

1. **Project Control Plane** — Auto-detects your projects, knows the stack, reads your tickets, tracks git state. Surfaces what needs doing by priority.
2. **Agent Control Plane** — Starts agents against specific work items, gives them context packets (project profile + spec + ticket), monitors progress, tracks output.

### User Story

```
$ opcom init
  Workspace name [personal]: personal

  Add project path: ~/projects/mtnmap
  Scanning... Expo + Firebase + Cloudflare Workers
  Tickets: 25 open / 31 total
  Added mtnmap

  Add project path: ~/projects/folia
  Scanning... FastAPI + Docker, trk (35 open / 45 total)
  Added folia

  ...

$ opcom status
  PROJECTS (4)

    mtnmap                                    main  clean
      Expo + Firebase + Cloudflare Workers
      Tickets: 12 open / 31 total
      Top: P0 auth-migration, P1 offline-sync, P1 expo-testing

    folia                                     main  2 uncommitted
      FastAPI + Docker (K8s)
      Tickets: 18 open / 45 total (trk)
      Top: P0 change-detection, P1 tile-server-perf

  AGENTS (2)
    claude-code  mtnmap/auth-migration        streaming  12m
    claude-code  folia/change-detection        idle       3m

$ opcom work folia/tile-server-perf
  Starting claude-code on folia...
  Context: FastAPI project, pytest, ruff
  Ticket: tile-server-perf (P1, open)
  Spec: docs/spec/TILE_SERVER.md
  Agent ready, streaming...
```

You never manually explain the project to an agent. opcom assembles the context from what it detected. You point agents at work items, not at directories.

## Entity Model

```
Workspace
  └── Project
       ├── Repo(s)              # 1 repo, monorepo, or multi-repo
       ├── Stack                # languages, frameworks, infra, detected
       ├── Work Items           # specs, tickets, tasks (priority-sorted)
       ├── Agent Sessions       # running coding agents, linked to work items
       ├── Processes            # dev server, watchers, tests
       ├── Environments         # dev on :3000, staging on remote
       └── Services             # startable units: api, web, db, workers
```

## Architecture

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│   TUI    │  │   Web    │  │  Voice   │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │              │
     ▼             ▼              ▼
┌─────────────────────────────────────┐
│           OpcomClient               │
└──────────────────┬──────────────────┘
                   │
┌──────────────────▼──────────────────┐
│             Station                  │
│  ┌──────────┬─────────┬──────────┐  │
│  │ Session  │ Project │ Context  │  │
│  │ Manager  │ Manager │ Builder  │  │
│  └────┬─────┴────┬────┴────┬─────┘  │
└───────│──────────│─────────│────────┘
   ┌────┴──┐  ┌────┴────┐  ┌┴────────┐
   │ Agent │  │ Project │  │ Message  │
   │Adapter│  │ Adapter │  │ Router   │
   └───────┘  └─────────┘  └─────────┘
```

Three normalization layers:
- **Agent adapters**: Claude Code NDJSON / Pi RPC events → NormalizedEvent
- **Project adapters**: trk / .tickets / GitHub Issues → NormalizedWorkItem
- **Context builder**: Project profile + work item + spec → agent context packet

## Design Decisions

- **Detection is code-based** — Pattern matching on config files (inspired by CNB buildpack detection), no LLM. Deterministic, fast, predictable. Three-tier: manifests → version files → source file globs.
- **YAML for config** — Human-readable, supports comments, easy to hand-edit.
- **Monorepo packages** — types (pure), core (runtime), cli (interface) stay cleanly separated.
- **Adapters are pluggable** — New agent backends and ticket systems added without changing core.
- **Agents get context, not conversation** — Unlike middleman-style systems where you onboard an agent via chat, opcom assembles structured context packets from detected project data. No cold starts.
- **Work items are the unit of agent assignment** — You don't say "work on folia." You say "work on folia/tile-server-perf." The agent gets the ticket, the spec, and the project profile.
- **Message routing between agents** — Learned from middleman: agents need to communicate (worker → merger, worker → reviewer). opcom's session manager handles routing with delivery modes (prompt/followUp/steer).

## Prior Art

- **Cloud Native Buildpacks** — Detection pattern: scan for marker files, extract stack info. opcom's three-tier detection (manifest → version file → source glob) is directly inspired by Google Cloud's buildpack implementation.
- **middleman (SawyerHood)** — Agent orchestration: persistent manager, worker spawning, message routing, merge queue, memory files. opcom learns from this but replaces conversational onboarding with auto-detection.
- **trk** — Spec-to-code traceability. opcom normalizes trk's ticket format alongside other work systems.
