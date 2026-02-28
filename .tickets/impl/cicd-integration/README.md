---
id: cicd-integration
title: "CI/CD Integration: GitHub Actions Pipeline & Deployment Status"
status: open
type: feature
priority: 2
deps:
  - phase-3-server
links:
  - docs/spec/cicd.md
services:
  - core
  - cli
---

# CI/CD Integration: GitHub Actions Pipeline & Deployment Status

## Goal

Track CI/CD pipeline status for each project — from git push through workflow execution to deployment. First implementation targets GitHub Actions via `gh` CLI / GitHub API, with the adapter interface designed for future CI backends (GitLab CI, CircleCI, Buildkite).

Defines the `CICDAdapter` interface, normalized `Pipeline` and `DeploymentStatus` types, polling infrastructure, and server API. The `github-deployments-pane` ticket depends on this for TUI presentation.

## Tasks

- [ ] Define `CICDAdapter` interface: `detect`, `listPipelines`, `getPipeline`, `listDeployments`, `watch`
- [ ] Define normalized types: `Pipeline`, `PipelineJob`, `PipelineStep`, `PipelineStatus`, `DeploymentStatus`
- [ ] Implement `GitHubActionsAdapter`:
  - [ ] Detection: check for GitHub remote + `.github/workflows/` directory
  - [ ] Map GitHub API workflow run / job / step responses to normalized types
  - [ ] Status mapping: GitHub conclusion → `PipelineStatus`
- [ ] Authentication: support `gh auth token` command (preferred) and explicit PAT in config
- [ ] Polling service:
  - [ ] Active polling (30s) when pipelines are in progress
  - [ ] Idle polling (5m) when all pipelines are terminal
  - [ ] Adaptive: poll more frequently right after a push
- [ ] REST endpoints: `/projects/:id/pipelines`, `/projects/:id/deployments`, rerun/cancel actions
- [ ] WebSocket events: `pipeline_updated`, `deployment_updated`
- [ ] CLI: `opcom ci [project]` to show recent pipeline status
- [ ] CLI: `opcom ci <project> --watch` for live pipeline tailing
- [ ] Webhook ingestion endpoint: `POST /webhooks/github` for real-time updates (optional upgrade)
- [ ] `opcom ci setup <project>` to configure webhook via GitHub API

## Acceptance Criteria

- `opcom ci folia` shows the 10 most recent workflow runs with status, duration, and branch
- Pipeline status updates flow through WebSocket to connected TUI/web clients
- GitHub auth works via `gh auth token` without requiring a separate PAT
- Polling frequency adapts based on whether any pipeline is actively running
- Works with both public and private repos (given valid auth)
