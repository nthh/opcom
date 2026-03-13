# Config Specification

## Layout

```
~/.opcom/
├── config.yaml              # Global preferences
├── workspaces/
│   └── <id>.yaml            # Workspace: name, projectIds[]
└── projects/
    └── <id>.yaml            # Cached detection + user overrides
```

## Global Config (~/.opcom/config.yaml)

```yaml
defaultWorkspace: personal
```

## Workspace Config (~/.opcom/workspaces/<id>.yaml)

```yaml
id: personal
name: "personal workspace"
description: "My dev projects"
projectIds:
  - mtnmap
  - folia
  - conversi
  - costli
createdAt: "2026-02-27T00:00:00Z"
```

## Project Config (~/.opcom/projects/<id>.yaml)

Stores cached detection results plus user overrides. Re-populated on `opcom scan`.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique project identifier |
| `name` | string | Display name |
| `path` | string | Absolute path to the project directory |
| `lastScannedAt` | ISO 8601 | When detection last ran |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Freeform text describing what the project is about. Primary context for non-code projects; supplemental context for code projects. |
| `stack` | StackInfo | Detected languages, frameworks, package managers, infrastructure, version managers |
| `git` | object | Remote, branch, clean status |
| `workSystem` | object | Work tracking system (trk, GitHub issues, etc.) |
| `services` | Service[] | Runnable services with commands and ports |
| `testing` | object | Test framework, command, test directory |
| `linting` | Linter[] | Configured linters |
| `environments` | object | Environment definitions (dev, staging, prod) |
| `subProjects` | SubProject[] | Nested projects within a monorepo |
| `cloudServices` | object | Cloud service configurations (databases, storage, serverless, hosting) |

All optional fields default to absent. A valid project config needs only the four required fields.

### Hybrid Projects

There is no `kind` or `type` field on ProjectConfig. Projects are hybrid by default — a project can have detected code (stack, testing, linting), operational tasks (workSystem, description), or both. The presence of `stack` info reflects what detection found in the directory, not a categorization of the project.

A project with no `stack` is still a fully valid project. It might be a planning effort, an ops runbook collection, a design project, or anything else that benefits from task tracking and agent orchestration. The `description` field carries the context that `stack` carries for code projects.

### Examples

Code project (detected stack, services, testing):

```yaml
id: folia
name: folia
path: /Users/nathan/projects/folia
lastScannedAt: "2026-02-27T00:00:00Z"
description: "Multi-service app with FastAPI backend and TypeScript frontend, deployed on Vultr K8s"

stack:
  languages:
    - name: python
      version: "3.11"
      sourceFile: .mise.toml
    - name: typescript
      sourceFile: package.json
  frameworks:
    - name: FastAPI
      sourceFile: pyproject.toml
  packageManagers:
    - name: uv
      sourceFile: uv.lock
  infrastructure:
    - name: docker
      sourceFile: docker-compose.yml
    - name: kubernetes
      sourceFile: k8s/
  versionManagers:
    - name: mise
      sourceFile: .mise.toml

git:
  remote: origin
  branch: main
  clean: true

workSystem:
  type: trk
  ticketDir: .tickets/impl

services:
  - name: api
    command: "uv run uvicorn"
    port: 8000
  - name: postgres
    command: "docker compose up postgres"
    port: 5432

testing:
  framework: pytest
  command: "uv run pytest"
  testDir: tests

linting:
  - name: ruff
    sourceFile: pyproject.toml
  - name: mypy
    sourceFile: pyproject.toml
```

## Project Profile {#project-profile}

A project profile captures **operational semantics** that detection can't infer from file existence alone — how to run tests, what ticket fields mean, what agents are forbidden from doing. It lives alongside the existing `testing`, `services`, etc. fields on `ProjectConfig`.

### Schema {#profile-schema}

```yaml
# Inside ~/.opcom/projects/<id>.yaml, alongside existing fields
profile:
  # Build & test commands (override detected testing.command)
  commands:
    test: "make test-smoke"          # fast gate for verification pipeline
    testFull: "make test"            # full suite (optional, used for stage smoke tests)
    build: "make build"             # build command
    deploy: "make deploy"           # deploy command
    lint: "ruff check ."            # lint command
    dev: "flc dev start --only app"  # dev environment startup command

  # Ticket field semantics — how to interpret project-specific frontmatter
  fieldMappings:
    - field: demand                  # frontmatter field name
      type: use-case                 # semantic type: use-case | tag | link | ignore
      pattern: "UC-*"               # optional: validation pattern
    - field: domains
      type: tag
    - field: services
      type: tag
    - field: milestone
      type: tag

  # Agent constraints extracted from project's agent config (CLAUDE.md, AGENTS.md)
  agentConstraints:
    forbiddenCommands:               # shell commands agents must never run
      - "git reset"
      - "git stash"
      - "git checkout ."
    commitRules:
      - "always commit before session end"
      - "two-commit structure for non-trivial changes"
    workflowRules:
      - "spec before ticket"
      - "test before implementation"
      - "never run full test suite — verification pipeline handles it"
```

### Field Mapping Types {#profile-field-mappings}

| Type | Meaning | Effect |
|------|---------|--------|
| `use-case` | Values are use-case IDs | Create `implements` edges to `use_case:` nodes in context graph |
| `tag` | Values are categorical labels | Store in `WorkItem.tags` (current behavior) |
| `link` | Values are file paths or URLs | Store in `WorkItem.links` |
| `ignore` | Field has no orchestration meaning | Skip during ingestion |

When no field mapping exists for a frontmatter array field, the default behavior is `tag` — the current behavior. Field mappings only add semantics on top.

### Agent Constraints {#profile-agent-constraints}

Agent constraints are extracted from the project's agent config file (CLAUDE.md, AGENTS.md, .cursorrules). They are injected into the context packet for any agent working on that project, regardless of role.

Constraint categories:
- **forbiddenCommands** — patterns matched against bash tool invocations. The executor can enforce these as hard blocks (reject the command) or soft warnings (log and continue).
- **commitRules** — natural language rules about git behavior. Injected into context, not mechanically enforced.
- **workflowRules** — natural language workflow expectations. Injected into context.

Only `forbiddenCommands` are mechanically enforceable. The rest are context for agent prompts.

### Profile Precedence {#profile-precedence}

Profile values override detected values where they overlap:

1. **Detected** `testing.command` → used if no `profile.commands.test`
2. **Profile** `commands.test` → overrides detected test command in verification pipeline
3. **Plan-level** config → can override profile for specific plans (e.g., `testCommand` in `OrchestratorConfig`)

Non-code project (no stack, description carries context):

```yaml
id: q2-launch
name: "Q2 product launch"
path: /Users/nathan/projects/q2-launch
lastScannedAt: "2026-03-01T00:00:00Z"
description: "Coordinate the Q2 product launch across marketing, docs, and eng. Track deliverables, review copy, manage timeline."

workSystem:
  type: trk
  ticketDir: .tickets/impl
```

## Init Pipeline {#init-pipeline}

Project initialization has multiple entry points (welcome, init, add, auto-setup) that all perform variations of the same pipeline. The init pipeline defines this as a single flow with mode-driven behavior, eliminating duplication and ensuring every entry point produces the same result.

### Pipeline Steps

```
1. resolvePath(input)              → absolute path
2. detectProject(path)             → DetectionResult
3. configureProject(result, mode)  → ProjectConfig
4. saveProject(config)             → persist to ~/.opcom/projects/
5. addToWorkspace(projectId)       → idempotent add to workspace
6. devStartup(config, mode)        → optional: start dev environment
7. postInit(mode)                  → mode-dependent: TUI, print guide, or return
```

### Modes

| Mode | Entry Points | Step 3 Behavior | Step 6 Behavior | Step 7 Behavior |
|------|-------------|-----------------|-----------------|-----------------|
| `interactive` | `opcom` (first run), `opcom init`, `opcom add` | Prompt for specs dir, work system, profile, dev command | Prompt "Start dev environment? [Y/n]" | Launch TUI (welcome) or return (init/add) |
| `agent` | `npx opcom` (non-TTY), `opcom init --auto` | Auto-accept all detected values | Print dev command in guide, don't auto-start | Print command guide |

### Shared Helpers

The pipeline extracts these currently-duplicated operations into shared functions:

```typescript
/** Expand ~, resolve relative paths, validate directory exists */
function resolvePath(input: string): string;

/** Idempotent: load default workspace, add projectId if not present, save */
async function addToWorkspace(projectId: string): Promise<void>;

/** Interactive: prompt for specs, work system, profile, dev command.
 *  Agent: return detection defaults unchanged. */
async function configureProject(
  detection: DetectionResult,
  mode: "interactive" | "agent",
): Promise<ProjectConfig>;

/** Resolve dev command, optionally start via ProcessManager.
 *  Interactive: prompt. Agent: print guide. */
async function devStartup(
  config: ProjectConfig,
  mode: "interactive" | "agent",
): Promise<void>;
```

### Interactive Dev Command Prompt

During `configureProject()` in interactive mode, after profile confirmation:

```
  Dev command: npm run dev               ← auto-detected from package.json
  Customize? [Enter to accept, or type command]: flc dev start --only app --orchestrator production --serve production

  Saved to profile.commands.dev
```

If no dev command is detected, prompt:

```
  No dev command detected.
  How do you start this project? [skip]:
```

The response is saved to `profile.commands.dev`. Empty input (skip) means no dev command.

### Agent Guide Output

After auto-setup, the command guide includes the dev command:

```
  Project configured: folia
    Path: /Users/nathan/projects/folia
    Stack: python, typescript, kubernetes
    Dev command: flc dev start --only app --orchestrator production --serve production

  Start dev environment:
    opcom dev folia

  CLI commands:
    opcom dev folia              # start dev environment
    opcom ticket list folia      # list tickets
    opcom work folia/<ticket>    # start agent on a ticket
```

### Entry Point Mapping

After unification, each entry point becomes a thin wrapper around the pipeline:

| Entry Point | Behavior |
|-------------|----------|
| `opcom` (TTY, first run) | `pipeline(cwd, "interactive")` + loop for more projects + launch TUI |
| `opcom` (non-TTY) | `pipeline(cwd, "agent")` + print guide |
| `opcom init` | Loop: `pipeline(prompted_path, "interactive")` for each project |
| `opcom init --auto [path]` | `pipeline(path, "agent")` |
| `opcom add <path>` | `pipeline(path, "interactive")` |
| `opcom add --auto <path>` | `pipeline(path, "agent")` |
| `opcom init <folder>` | Create folder + scaffold + `pipeline(folder, "interactive")` |

## Ticket Directory Structure {#ticket-directory-structure}

Ticket files live in a flat directory under the project root:

```
.tickets/
  <id>/README.md
```

Previously, tickets were nested under `.tickets/impl/`. The `impl/` subdirectory is removed — the `type` field in frontmatter (`feature`, `bug`, `chore`, `refactor`) handles categorization. Work system detection looks for `.tickets/` first, falling back to `.tickets/impl/` for backwards compatibility.

### Migration

On `opcom scan`, if `.tickets/impl/` exists but `.tickets/` contains no ticket directories, prompt to migrate:

```
  Tickets in .tickets/impl/ — flatten to .tickets/? [Y/n]:
```

In agent mode, print a suggestion but don't auto-migrate (moving files is destructive).

## Agent-Enriched Scaffolding {#scaffold-full}

`opcom scaffold` generates ticket stubs from spec sections. With `--full`, it uses an agent session to generate rich Context Packets instead of minimal stubs.

### Usage

```
opcom scaffold <spec-file> --full [--dry-run]
opcom scaffold --all --full [--dry-run]
```

### Behavior

1. Scan spec file for anchored sections (same as regular scaffold)
2. Skip sections that already have tickets
3. For each new section, start an agent session with:
   - The spec section content as context
   - The project's detection result (stack, services, testing)
   - Existing tickets for dependency inference
4. Agent generates a full Context Packet: Goal, Non-Goals, Constraints, Repo Anchors, Oracle, Tasks
5. Write the ticket file

Without `--full`, behavior is unchanged (minimal stubs).

### Guardrails

- `--dry-run` shows what would be created without writing files
- Agent-generated tickets are marked with `generated: true` in frontmatter so users know to review them
- The agent is given the ticket template (`TEMPLATE.md`) as a format reference

## Monitor Command {#monitor-command}

`opcom monitor` provides a live view of plan execution, agent activity, and errors. It reads from the plan YAML and event store (SQLite) to show what's happening right now.

### Usage

```
opcom monitor                    # live dashboard of current plan
opcom monitor --plan <id>        # specific plan
opcom monitor --agents           # focus on agent activity
opcom monitor --errors           # only failures and stalls
opcom monitor --once             # print once and exit (no live refresh)
```

### Default View

Refreshes every 2 seconds. Shows plan progress, active agents, recent events, and errors:

```
Plan: opcom [executing] 12/43 steps done  3 in-progress  28 ready

AGENTS (3 active)
  a08ca0f5  unified-init-pipeline/audit-all-6...   streaming  2m12s  42 events
  b12de981  dev-command-detection/parse-dev...      streaming  1m03s  18 events
  c44fa123  flatten-ticket-directory/update...      streaming  0m31s   8 events

RECENT EVENTS (last 30s)
  16:42:01  a08ca0f5  tool_end   Write  ✓
  16:42:03  b12de981  tool_end   Bash   ✓
  16:42:05  a08ca0f5  tool_end   Edit   ✓

ERRORS (0)
```

### Data Sources

| Data | Source | Query |
|------|--------|-------|
| Plan progress | Plan YAML (`~/.opcom/plans/<id>.yaml`) | Step status counts |
| Active agents | `sessions` table | `state IN ('streaming', 'waiting')` |
| Recent events | `events` table | Last 30s, grouped by session |
| Errors | `plan_events` + `events` tables | `step_failed` events, `tool_success = 0` runs |
| Stalls | `sessions` + `events` tables | Sessions with no events in last `agentTimeoutMs` |
| Tool stats | `events` table | `type = 'tool_end'` grouped by `tool_name` |

### Agent-Friendly Mode

`opcom monitor --once` prints the current state and exits. Useful for agents checking on plan progress without blocking on a live view.
