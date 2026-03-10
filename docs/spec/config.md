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
