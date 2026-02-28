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

```yaml
id: folia
name: folia
path: /Users/nathan/projects/folia
lastScannedAt: "2026-02-27T00:00:00Z"

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
