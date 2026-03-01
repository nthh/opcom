---
id: github-deployments-pane
title: "GitHub Deployments & Workflow Status Pane"
status: closed
type: feature
priority: 3
deps:
  - cicd-integration
links: []
---

## Goal

Add a TUI pane that shows live GitHub Actions workflow and deployment status for each project. Users should be able to see at a glance whether their latest push triggered a workflow, whether it passed/failed, and the current deployment state — without leaving opcom.

## Approach

**Use the GitHub API (polling or webhooks) rather than watching git pushes.** Git push detection only tells you something was pushed — it can't tell you about workflow status, deployment progress, or check results. The GitHub REST/GraphQL API (or webhook events via the station daemon) gives you everything: workflow runs, job steps, deployment environments, check suites, and commit statuses.

Recommended strategy:
- **Poll via GitHub API** for simplicity initially (`GET /repos/{owner}/{repo}/actions/runs`, `/deployments`)
- **Upgrade to webhook delivery** later via the station daemon for real-time updates (listen for `workflow_run`, `deployment_status`, `check_suite` events)
- Use the existing GitHub integration foundation from phase-7-integrations

## Tasks

- [ ] Add GitHub API client for workflow runs and deployment status endpoints
- [ ] Define normalized types for workflow/deployment state (map GitHub's models to opcom types)
- [ ] Implement polling service that fetches status per-project on an interval
- [ ] Wire polling data into the station daemon so TUI/web clients can subscribe
- [ ] Build TUI pane showing workflow runs: branch, status, duration, triggered-by
- [ ] Show deployment environments and their current state (active, pending, failed)
- [ ] Add click-through / detail view for individual workflow runs (job steps, logs link)
- [ ] Support webhook ingestion as an alternative to polling for real-time updates
- [ ] Handle GitHub auth (PAT or GitHub App token) via opcom config

## Acceptance Criteria

- Projects linked to a GitHub repo show recent workflow runs with pass/fail status
- Deployment status per environment is visible (e.g. "production: active", "staging: pending")
- Status updates arrive within a reasonable interval (polling) or near-instantly (webhooks)
- Works with both public and private repos (given valid auth)
- Pane is accessible from the TUI project drill-down view
