---
id: profile-detection
title: "Auto-detect project profile during init/add/scan"
status: open
type: feature
priority: 2
created: 2026-03-10
deps:
  - project-profile
links:
  - docs/spec/detection.md#profile-detection
  - docs/spec/detection.md#build-system-parsing
  - docs/spec/detection.md#agent-config-parsing
  - docs/spec/detection.md#ticket-field-inference
  - docs/spec/detection.md#profile-confirmation
services:
  - core
  - cli
---

# Profile Auto-Detection

## Problem

The project profile (from `project-profile` ticket) must be manually authored. But most of the information is already present in the project directory — Makefiles have test/build/deploy targets, agent config files list forbidden commands, and ticket frontmatter reveals field conventions through pattern analysis. Without auto-detection, every new project requires manual profile setup, which most users won't do.

## Goal

Automatically infer a project profile during `opcom init`, `opcom add`, and `opcom scan`. Detection is code-based (no LLM calls), best-effort, and confirmed interactively before saving. Re-scanning preserves user edits.

## Design

### Detection Pipeline

Profile detection runs as a fourth tier after existing detection:

```
Tier 1: Manifests (stack) → Tier 2: Version files → Tier 3: Source globs
    → Tier 4: Profile detection (commands, field mappings, constraints)
```

### Build System Parsing

New function `detectProfileCommands(projectPath)`:

1. Check for `Makefile` → parse target names with regex `^([a-zA-Z][\w-]*)\s*:/`
2. Check for `package.json` → parse `scripts` object keys
3. Check for `justfile` → parse recipe names
4. Check for `taskfile.yml` → parse `tasks` keys
5. Map targets to profile commands using priority rules:
   - `test-smoke`, `test:smoke` → `commands.test`
   - `test` (if no smoke variant found) → `commands.test`
   - `test-all`, `test:all`, `test` (when smoke exists) → `commands.testFull`
   - `build` → `commands.build`
   - `deploy` → `commands.deploy`
   - `lint`, `check` → `commands.lint`
6. Prefix with build system: `make test-smoke`, `npm run test`, `just test`

When multiple build systems exist, prefer the top-level one (Makefile wrapping package.json is common).

### Agent Config Parsing

New function `detectAgentConstraints(agentConfigPath)`:

1. Read the agent config file (CLAUDE.md, AGENTS.md, etc.)
2. Extract forbidden commands using regex patterns:
   - `/(?:NEVER|never|do NOT|forbidden)\s+.*?`([^`]+)`/g`
   - `/(?:NEVER|never|do NOT)\s+run\s+`([^`]+)`/g`
3. Extract commit rules from git/commit sections
4. Extract workflow rules from process/conventions sections
5. Deduplicate and normalize extracted strings

This is best-effort — the full agent config file is always available in context packets. Extraction is for mechanical enforcement and display.

### Ticket Field Inference

New function `detectFieldMappings(ticketDir)`:

1. Read frontmatter from up to 20 ticket files (random sample)
2. Collect all non-standard keys (not in: `id`, `title`, `status`, `type`, `priority`, `deps`, `links`, `created`, `role`, `team`, `verification`)
3. For each non-standard key that appears in >25% of sampled tickets:
   - If values match `UC-*` or `USE-CASE-*` → type `use-case`
   - If values are file paths (contain `/` or end in `.md`) → type `link`
   - If values are arrays → type `tag`
   - Otherwise → skip (don't suggest)
4. Return as `FieldMapping[]`

### Interactive Confirmation Flow

In `opcom init` and `opcom add`, after stack detection:

```
Detected profile:
  Test gate:     make test-smoke          ← from Makefile
  Full suite:    make test                ← from Makefile
  Deploy:        make deploy              ← from Makefile
  Ticket fields:
    demand → use-case                     ← detected UC-xxx pattern in 80% of tickets
    domains → tag                         ← array field in 60% of tickets
  Agent constraints:
    Forbidden: git reset, git stash       ← from AGENTS.md

  [Enter] accept  [e] edit  [s] skip profile
```

- `Enter` → save profile as-is
- `e` → open project YAML in `$EDITOR` at the profile section
- `s` → skip profile (can be added later via `opcom scan`)

### Re-scan Behavior

On `opcom scan` (re-detection):
- Re-run profile detection
- Only fill in fields that are **currently absent** in the saved profile
- Do not overwrite user-edited values
- `opcom scan --reset-profile` → clear existing profile and re-detect everything

## Tasks

- [ ] Implement `detectProfileCommands()` — parse Makefile targets, package.json scripts, justfile recipes
- [ ] Implement `detectAgentConstraints()` — regex extraction from agent config files
- [ ] Implement `detectFieldMappings()` — sample ticket frontmatter and infer types
- [ ] Wire profile detection into `detectProject()` pipeline as Tier 4
- [ ] Add interactive confirmation prompt in `opcom init` and `opcom add`
- [ ] Implement re-scan merge logic (fill absent fields, preserve user edits)
- [ ] Add `--reset-profile` flag to `opcom scan`
- [ ] Tests: Makefile parsing, package.json script parsing, agent config extraction, field inference from ticket samples, re-scan merge logic

## Acceptance Criteria

- `opcom add /path/to/project` detects and displays profile before saving
- Makefile with `test-smoke` target → `commands.test: "make test-smoke"`
- AGENTS.md with "NEVER run `git reset`" → `forbiddenCommands: ["git reset"]`
- Tickets with `demand: [UC-001]` in >25% of files → field mapping `demand → use-case`
- User can accept, edit, or skip profile during init/add
- Re-scan fills gaps without overwriting user edits
- `opcom scan --reset-profile` re-detects everything fresh
- Projects with no Makefile/agent config/tickets still work (empty profile)
