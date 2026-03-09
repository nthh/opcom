---
id: dashboard-deploy-status
title: "Dashboard: production & deployment status"
status: closed
type: feature
priority: 2
created: 2026-03-06
deps:
  - cicd-integration
  - github-deployments-pane
links:
  - docs/spec/cicd.md#dashboard-deploy-column-l1
  - docs/spec/tui.md
---

# Dashboard: production & deployment status

## Goal

Show production/deployment status directly on the main dashboard for each project. At a glance you should see: is the latest deploy healthy, when was it deployed, which environment, and whether there are pending changes not yet deployed.

## Design

Each project row on the dashboard gains a deploy status indicator:

```
 Project          Stack           Deploy          Tickets
 folia            TS/K8s/Vue      ✓ prod 2m ago   3 open
 remolt           TS/K8s          ✗ prod failing   1 open
 mtnmap           TS/Firebase     ✓ prod 1h ago   —
 costli           TS/CF Workers   ● deploying...   2 open
```

Data sources (via integration modules):
- GitHub Actions deployment status
- K8s pod health (from k8s-monitoring)
- Cloudflare/Vercel/Firebase deploy status
- Custom webhook endpoints

## Tasks

- [ ] T1: Define `DeployStatus` type — environment, state (healthy/failing/deploying/unknown), timestamp, commit SHA
- [ ] T2: Aggregate deploy status from CI/CD adapters into a per-project summary
- [ ] T3: Dashboard column rendering — status icon, environment name, relative time
- [ ] T4: Drill-down to deployment detail — deploy history, logs link, rollback option
- [ ] T5: Detect "unpushed changes" — local commits not yet in the deployed commit
- [ ] T6: Deploy status in project detail view (L2) — full environment list with health
- [ ] T7: WebSocket events for deploy status changes — update TUI in real time
- [ ] T8: Tests for status aggregation and rendering

## Acceptance Criteria

- Main dashboard shows deploy status for each project with CI/CD configured
- Status updates in real time as deploys progress
- Failing deploys are visually prominent (red indicator)
- Drill-down shows deploy history and which commit is live
- Projects without CI/CD configured show no deploy column (not "unknown")
