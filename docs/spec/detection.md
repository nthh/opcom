# Detection Specification

## Overview

Detection scans a project directory for known config files and extracts stack information. It is purely code-based — no LLM calls, no network requests.

Inspired by Cloud Native Buildpack detection patterns (particularly Google Cloud's three-tier approach), but adapted for developer workspace profiling rather than container builds.

## Three-Tier Detection

### Tier 1: Manifest files (high confidence)
Parse structured config files for languages, frameworks, dependencies, and tools.

### Tier 2: Version files & config (medium confidence)
Read version pinning files and tool-specific configs.

### Tier 3: Source file glob fallback (low confidence)
Scan for source files (`*.py`, `*.go`, `*.rs`, etc.) when no manifests found. Excludes dependency directories (`node_modules`, `.venv`, `vendor`, etc.).

## Manifest Matcher Table

| File | Detects | Deep Parsing |
|------|---------|-------------|
| `package.json` | JS/TS language, frameworks (from deps), package manager, engines.node version | deps, devDeps, engines, packageManager field |
| `pyproject.toml` | Python language, frameworks (from deps), package manager, testing, linting | [project] deps, [tool.poetry], [tool.uv], [tool.ruff], [tool.pytest], [build-system] |
| `requirements.txt` | Python language, frameworks (from deps), pip package manager | line-by-line dep parsing |
| `setup.py` / `setup.cfg` | Python language (legacy marker) | existence only |
| `Pipfile` | Python language, pipenv package manager | existence only |
| `go.mod` | Go language + version | `go X.Y` directive |
| `Cargo.toml` | Rust language | existence only |
| `Gemfile` / `gems.rb` | Ruby language | existence only |
| `docker-compose.yml` | Docker infrastructure, services with ports | service names, ports, depends_on |
| `Dockerfile` / `Containerfile` | Docker infrastructure | existence only |
| `firebase.json` | Firebase infrastructure | existence only |
| `wrangler.toml` / `wrangler.jsonc` | Cloudflare Workers infrastructure (also scans `workers/*/`) | existence only |
| `k8s/` / `kubernetes/` | Kubernetes infrastructure | existence only |

## Version File Table

| File | Language | Extract |
|------|----------|---------|
| `.python-version` | python | version string |
| `.nvmrc` | javascript (Node) | version string |
| `.node-version` | javascript (Node) | version string |
| `.ruby-version` | ruby | version string |
| `.go-version` | go | version string |
| `.java-version` | java | version string |
| `.rust-toolchain.toml` | rust | version string |
| `.mise.toml` | (multiple) | [tools] section, each tool + version |

## Framework Detection (from dependencies)

### JavaScript/TypeScript (package.json)
next, react, react-native, expo, vue, nuxt, express, fastify, hono, svelte, @sveltejs/kit, angular, @angular/core

### JavaScript/TypeScript (config files)
- `next.config.{js,mjs,ts}` → Next.js
- `angular.json` → Angular

### Python (pyproject.toml / requirements.txt)
fastapi, django, flask, click, pydantic, starlette, streamlit, gradio, celery

## Package Manager Detection

### From pyproject.toml sections (Google pattern)
- `[tool.poetry]` → poetry
- `[tool.uv]` → uv
- `[build-system] build-backend = "poetry..."` → poetry
- `[build-system] build-backend = "hatchling..."` → hatch

### From lockfiles
pnpm-lock.yaml, yarn.lock, bun.lockb, bun.lock, package-lock.json, uv.lock, poetry.lock, Pipfile.lock, pdm.lock

### From package.json
`packageManager` field (e.g., `"pnpm@9.0.0"`)

## Monorepo Tool Detection

| File | Tool |
|------|------|
| `turbo.json` | Turborepo |
| `nx.json` | Nx |
| `lerna.json` | Lerna |
| `pnpm-workspace.yaml` | pnpm workspaces |

## Linting/Formatting Detection

| Signal | Tool |
|--------|------|
| eslint dep or `eslint.config.*` / `.eslintrc.*` | ESLint |
| prettier dep or `.prettierrc*` / `prettier.config.*` | Prettier |
| biome dep or `biome.json` / `biome.jsonc` | Biome |
| `[tool.ruff]` in pyproject.toml | Ruff |
| `[tool.mypy]` in pyproject.toml | mypy |
| `[tool.black]` in pyproject.toml | Black |

## Source File Glob Fallback

When no manifest files detect any language, scan for source files (excluding dependency dirs):

| Extension | Language | Ambiguity |
|-----------|----------|-----------|
| `*.go` | go | Low |
| `*.rs` | rust | Low |
| `*.rb` | ruby | Low |
| `*.java` | java | Low |
| `*.py` | python | Low |
| `*.ts` | typescript | Low |
| `*.js` | javascript | High (checked last — JS files appear in many non-Node projects) |

## Confidence

- **high**: Language + framework or infrastructure detected from manifests
- **medium**: Language detected (from manifests, version files, or source globs) but no framework/infra
- **low**: Nothing detected

## Sub-Project Detection

Scan monorepo patterns: `packages/*/`, `apps/*/`, `services/*/`, `libs/*/`, `modules/*/`, plus root-level directories with their own `package.json` or `pyproject.toml`.

## Profile Detection {#profile-detection}

Profile detection runs after stack detection and populates the `profile` section of `ProjectConfig`. Like stack detection, it is purely code-based — no LLM calls.

### Build System Parsing {#build-system-parsing}

Extract named targets from build files to populate `profile.commands`:

| File | Parse Strategy | Targets |
|------|---------------|---------|
| `Makefile` | Regex for target names (lines matching `^target-name:`) | `test`, `test-*`, `build`, `deploy`, `lint`, `format`, `dev`, `start` |
| `package.json` scripts | JSON parse `scripts` object | Same target names |
| `pyproject.toml` | TOML parse `[tool.pytest]`, `[tool.hatch.envs.*.scripts]` | Test commands, script aliases |
| `justfile` | Regex for recipe names | Same target names |
| `taskfile.yml` | YAML parse `tasks` keys | Same target names |

**Matching rules:**
- `test` or `test-smoke` or `test:smoke` → `profile.commands.test` (fast gate)
- `test-all` or `test:all` or `test` (if no smoke variant) → `profile.commands.testFull`
- `build` → `profile.commands.build`
- `deploy` or `deploy-*` → `profile.commands.deploy`
- `lint` or `check` → `profile.commands.lint`
- `dev` or `dev:start` or `start` or `serve` → `profile.commands.dev` (dev environment startup)

The `dev` command is special — it represents the project's primary development startup. During interactive init, the user is prompted to confirm or customize it. During agent auto-setup, it's auto-detected and printed in the command guide. See [Init Pipeline](#init-pipeline) for how it integrates with first-run.

When multiple candidates exist (e.g., both `make test-smoke` and `npm run test`), prefer the top-level build system (Makefile > package.json scripts) since it typically wraps the others.

### Agent Config Parsing {#agent-config-parsing}

If the project has an agent config file (`docs.agentConfig` — typically CLAUDE.md or AGENTS.md), parse it for agent constraints:

1. **Forbidden commands** — scan for patterns like "never run", "do NOT use", "forbidden", "NEVER" followed by backtick-quoted commands or code blocks
2. **Commit rules** — scan for sections about git workflow, commit conventions
3. **Workflow rules** — scan for sections about development process (spec-first, test-first, etc.)

This is **best-effort extraction** using regex/heuristic parsing. The raw agent config file is always available in the context packet — constraint extraction is for mechanical enforcement (forbidden commands) and profile display, not a replacement for the full file.

**Extraction patterns:**

```
# Forbidden commands
/(?:NEVER|never|do NOT|forbidden|prohibited)\s+.*?`([^`]+)`/g
/(?:NEVER|never|do NOT)\s+run\s+`([^`]+)`/g

# Commit rules (section-based)
/^##.*(?:git|commit|version control)/im → extract bullet points

# Workflow rules
/^##.*(?:process|workflow|development|conventions)/im → extract bullet points
```

### Ticket Field Inference {#ticket-field-inference}

During scan, sample ticket frontmatter across the project's ticket directory to infer field mappings:

1. **Collect unique fields** — read frontmatter from up to 20 tickets, collect all keys not in the standard set (`id`, `title`, `status`, `type`, `priority`, `deps`, `links`, `created`)
2. **Infer types** by value patterns:
   - Array values matching `UC-*` or `USE-CASE-*` → `use-case` type
   - Array values that are file paths (`docs/`, `src/`, `*.md`) → `link` type
   - All other arrays → `tag` type
   - Scalar non-standard fields → `ignore`
3. **Record field frequency** — only suggest mappings for fields that appear in >25% of sampled tickets (skip one-off metadata)

### Interactive Confirmation {#profile-confirmation}

During `opcom init` and `opcom add`, after detection runs, display the inferred profile and prompt for confirmation:

```
Profile:
  Test gate:     make test-smoke          ← from Makefile
  Full suite:    make test                ← from Makefile
  Deploy:        make deploy              ← from Makefile
  Ticket fields:
    demand → use-case                     ← detected UC-xxx pattern
    domains → tag                         ← detected as array
    services → tag                        ← detected as array
  Agent constraints:
    Forbidden: git reset, git stash       ← from AGENTS.md

  [Enter] accept  [e] edit  [s] skip profile
```

When the user chooses `[e] edit`, open the project YAML in `$EDITOR` at the `profile:` section.

On `opcom scan` (re-detection), the profile is re-inferred but **does not overwrite user edits**. Re-detection only fills in fields that are currently absent. To force re-detection of all profile fields, use `opcom scan --reset-profile`.
