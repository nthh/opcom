---
id: init-folder
title: "opcom init <folder>: Project creation with optional codebase detection"
status: closed
type: feature
priority: 1
deps: []
links:
  - docs/spec/config.md
  - docs/spec/detection.md
services:
  - cli
  - core
---

# opcom init <folder>: Project creation with optional codebase detection

## Goal

Extend `opcom init` to accept an optional `<folder>` argument that creates a new project directory (or uses an existing one), asks what the project is about, runs detection if there's code, and sets up a `.tickets/` directory for task tracking. Currently `init` only scans existing codebases — this makes it work for any kind of project.

## Current Behavior

`opcom init` (no args) creates a workspace and iteratively adds existing project paths. It requires existing directories with code to detect.

## New Behavior

`opcom init <folder>` should:

1. Create `<folder>` if it doesn't exist, or use it if it does
2. Prompt for project name (default: folder basename)
3. Prompt for description — freeform "what is this project about?"
4. Run stack detection on the folder (may find nothing — that's fine)
5. Create `.tickets/` directory if it doesn't exist
6. Create a minimal `AGENTS.md` with the project description
7. Save project config to `~/.opcom/projects/<id>.yaml` with `description` field
8. Add the project to the current workspace (or prompt for workspace)
9. Optionally offer to seed initial tasks:
   - "Describe them and I'll create tickets"
   - "Import from external source"
   - "Start empty"

## Backward Compatibility

`opcom init` (no args) continues to work as today — interactive workspace setup with project scanning.

## Tasks

- [ ] Add optional `<folder>` positional argument to init command
- [ ] Implement directory creation (mkdir -p semantics)
- [ ] Add description prompt and persist in ProjectConfig
- [ ] Run detectProject() on folder — handle empty results gracefully (no error, just empty stack)
- [ ] Create .tickets/ directory scaffolding
- [ ] Generate minimal AGENTS.md with project description
- [ ] Save project config with description field
- [ ] Add project to workspace
- [ ] Add task seeding prompt (defer import to calendar-import ticket)
- [ ] Update CLI help text
- [ ] Tests for new init flow (both new folder and existing folder cases)

## Acceptance Criteria

- `opcom init ~/projects/japan-trip` creates the directory, prompts for name/description, saves config with no stack info, creates .tickets/
- `opcom init ~/projects/my-saas` on an existing Next.js project detects the stack AND asks for description
- `opcom init` (no args) still works exactly as before
- Project config includes `description` field
- Empty stack detection is not treated as an error
