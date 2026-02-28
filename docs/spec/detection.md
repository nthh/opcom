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
