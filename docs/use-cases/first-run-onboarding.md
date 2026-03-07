---
id: UC-001
title: "First-Run Onboarding"
status: partial
priority: P0
persona: "Solo developer managing multiple projects with coding agents"
requires:
  specs:
    - detection
    - config
    - adapters
    - integrations
    - cicd
    - tui
  features:
    - project-detection
    - stack-detection
    - ticket-scanning
    - cli-status-dashboard
    - agent-context-packets
    - integration-auto-detect
    - cicd-dashboard-status
  tickets:
    - modular-integrations
---

# Use Case: First-Run Onboarding

## Persona

**Solo developer** managing 2-6 projects with coding agents. Uses `.tickets/`, GitHub Issues, or trk for task tracking. Has CI/CD via GitHub Actions. Deploys to a mix of cloud platforms (K8s, Firebase, Cloudflare, Vercel). Currently managing agents manually across terminal sessions.

## Scenario

User runs `npx opcom` for the first time. opcom detects their project, integrates with their existing tools, and gives them a dashboard — all in under 2 minutes.

## Flow

### Step 1: First run detection

```
$ cd ~/projects/myapp
$ npx opcom

  No workspace found.

  opcom init — workspace setup

  Workspace name [personal]: personal

  Detected project in current directory:
    myapp — TypeScript, Next.js, Tailwind
    Package manager: pnpm
    Testing: vitest
    Git: main branch, clean, remote: github.com/user/myapp

  Add this project? [Y/n]: y
  Added myapp

  Add another project path (empty to finish): ~/projects/api
  Scanning...
    api — Python, FastAPI, Docker
    Package manager: uv
    Testing: pytest
    Git: main branch, 2 uncommitted, remote: github.com/user/api

  Add this project? [Y/n]: y
  Added api

  Add another project path (empty to finish):

  Workspace "personal" created with 2 projects.
```

### Step 2: Auto-detect integrations

After project setup, opcom detects available integrations:

```
  Checking integrations...

  Work sources:
    [auto] .tickets/ found in myapp (12 open tickets)
    [auto] .tickets/ found in api (5 open tickets)
    [ ? ]  GitHub Issues available for both repos. Enable? [y/N]: n

  CI/CD:
    [auto] .github/workflows/ found in myapp (3 workflows)
    [auto] .github/workflows/ found in api (1 workflow)
    GitHub Actions enabled. Auth: using `gh auth token`

  Notifications:
    Terminal bell enabled (default)
    [ ? ]  Slack webhook URL (empty to skip):

  Run 'opcom integrations' to change these later.
```

### Step 3: Dashboard

```
$ opcom status

  PROJECTS (2)

    myapp                                     main  clean    CI passing
      TypeScript, Next.js, pnpm, vitest
      Tickets: 12 open
      Top: P0 auth-migration, P1 dark-mode, P1 perf-audit

    api                                       main  2 dirty  CI failing
      Python, FastAPI, Docker, uv, pytest
      Tickets: 5 open
      Top: P1 rate-limiting, P1 pagination

  Run 'opcom tui' for the interactive dashboard.
  Run 'opcom work myapp/auth-migration' to start an agent.
```

### Step 4: Day-to-day

```
$ opcom                    # shows status (or TUI if daemon is running)
$ opcom tui                # interactive dashboard
$ opcom work myapp/auth-migration --worktree   # agent with full context
$ opcom plan create --scope open               # plan all open tickets
$ opcom ci                 # pipeline status across all projects
```

## Requirements

### Must have (for this use case to work end-to-end)

| Requirement | Spec | Status |
|---|---|---|
| Detect cwd project on first `npx opcom` | `docs/spec/config.md` | Not implemented |
| Project detection + stack scan | `docs/spec/detection.md` | Implemented |
| Ticket scanning (.tickets/) | `docs/spec/adapters.md` | Implemented |
| `opcom status` dashboard | `docs/spec/tui.md` | Implemented |
| Agent start with context packet | `docs/spec/adapters.md#context-packets` | Implemented |
| Integration auto-detection in init | `docs/spec/integrations.md` | Not implemented |
| CI/CD status on dashboard | `docs/spec/cicd.md#dashboard-l1` | Not implemented |

### Nice to have

| Requirement | Spec | Status |
|---|---|---|
| Deploy status on dashboard | `docs/spec/cicd.md#dashboard-deploy-column-l1` | Not implemented |
| GitHub Issues adapter | `docs/spec/adapters.md` | Implemented (not in init flow) |
| Plan creation from init | `docs/spec/orchestrator.md` | Implemented (separate command) |
| Context graph build | `docs/spec/context-graph.md` | Implemented (separate command) |

## Readiness

**75%** — The core loop works (detect project, scan tickets, start agents). The main gap is that `init` doesn't discover and configure integrations, so CI/CD and notifications require manual setup after the initial flow.

## Gap: Smart first-run

The biggest UX gap is that `npx opcom` with no workspace should be smarter:

1. Detect that cwd is a git repo
2. Offer to scan it as a project
3. Run integration detection (CI/CD, ticket system, deployment targets)
4. Create workspace + project in one step
5. Show the dashboard immediately

This turns the first experience from "run `opcom init`, answer prompts, then run `opcom status`" into "run `npx opcom`, see your project."
