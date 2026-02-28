---
id: phase-2-jira-adapter
title: "Project Adapter: Jira"
status: closed
type: feature
priority: 1
created: 2026-02-27
milestone: phase-2
deps: []
links:
  - docs/spec/adapters.md
---

# Project Adapter: Jira

## Goal

Read Jira issues as WorkItems so teams using Jira see their tickets in opcom's dashboard and can assign agents to them. Jira becomes another project adapter alongside .tickets/, trk, and GitHub Issues.

## Why

Most teams already have their work tracked in Jira. Asking them to switch to .tickets/ files is a non-starter. opcom should meet people where their work already lives.

## Architecture

```
Jira Cloud API ──→ JiraAdapter ──→ WorkItem[]
                                    ↓
                              opcom dashboard
                              (same as local tickets)
```

JiraAdapter implements the same ProjectAdapter interface as TicketsDirAdapter and TrkAdapter. opcom treats all work items identically regardless of source.

## Tasks

### Detection
- [ ] Detect Jira project by config: user specifies Jira project key in opcom project config
- [ ] Auto-detect: check for `.jira/` config or `JIRA_BASE_URL` env var
- [ ] WorkSystemInfo type: `"jira"` added to WorkSystemType union
- [ ] Store Jira config in project overrides: baseUrl, projectKey, auth method

### Adapter
- [ ] JiraAdapter implements ProjectAdapter interface
- [ ] `listItems()`: Jira REST API v3 → search issues with JQL → map to WorkItem[]
- [ ] `getItem(id)`: fetch single issue by key (e.g., PROJ-123)
- [ ] `summarize()`: issue counts by status → WorkSummary
- [ ] Pagination: handle Jira's paginated responses (startAt, maxResults)
- [ ] Caching: cache issue list for 5min to avoid hammering Jira API

### Field Mapping
- [ ] Jira issue → WorkItem:
  ```
  issue.key         → id ("PROJ-123")
  issue.summary     → title
  issue.status.name → status (map: "To Do"→open, "In Progress"→in-progress, "Done"→closed)
  issue.priority    → priority (map: Highest→0, High→1, Medium→2, Low→3, Lowest→4)
  issue.issuetype   → type (map: Story→feature, Bug→bug, Task→task, Epic→epic)
  issue.labels      → tags
  issue.issuelinks  → deps (blocks/blocked-by relations)
  issue.parent      → parent (epic or parent issue)
  issue.description → (available for context packets)
  ```
- [ ] Custom field mapping: user configurable for non-standard Jira setups
- [ ] Sprint awareness: current sprint issues highlighted

### Auth
- [ ] Jira Cloud: API token (email + token) or OAuth 2.0
- [ ] Jira Server/Data Center: personal access token
- [ ] Credentials stored securely: ~/.opcom/auth/jira.yaml (or system keychain)
- [ ] `opcom jira auth` command for interactive setup

### CLI
- [ ] `opcom add <path> --jira PROJ --jira-url https://team.atlassian.net`
- [ ] Jira tickets visible in `opcom status` dashboard
- [ ] `opcom work <project>/PROJ-123` starts agent on Jira issue
- [ ] Context packet includes Jira issue description + acceptance criteria

### Context Packet Integration
- [ ] Fetch full issue description (Atlassian Document Format → markdown)
- [ ] Include acceptance criteria from description or sub-tasks
- [ ] Include linked Confluence pages if accessible (stretch)
- [ ] Include comments/context from issue history (last 5 comments)

## Example

```
$ opcom status
  myproject                               main  clean
    FastAPI + React (Docker)
    Jira: 8 open / 23 total (MYPROJ)
    Sprint: Sprint 14 (3 remaining)
    Top: P0 MYPROJ-89, P1 MYPROJ-92, P1 MYPROJ-95

$ opcom work myproject/MYPROJ-89
  Starting claude-code on myproject/MYPROJ-89...
  Ticket: "Fix auth token refresh race condition" (P0, Bug)
  Description loaded from Jira (1.2k chars)
  Agent ready, streaming...
```

## Acceptance Criteria

- Jira issues appear as WorkItems in opcom status dashboard
- Priority mapping is correct (Jira priority names → P0-P4)
- Status mapping is correct (Jira workflow → open/in-progress/closed)
- Can start agent on a Jira issue with `opcom work project/PROJ-123`
- Agent receives Jira issue description as part of context packet
- Auth setup is straightforward (single command)
- Works with Jira Cloud; Jira Server/DC is stretch goal
