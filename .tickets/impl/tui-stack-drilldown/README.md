---
id: tui-stack-drilldown
title: "TUI: Add drill-down for Stack panel on L2 project detail"
status: closed
type: bug
priority: 2
deps: []
links:
  - docs/spec/tui.md
services:
  - cli
---

# TUI: Stack Panel Drill-Down

## Problem

L2 project detail has 8 panels. All have Enter/drill-down behavior except panel 3 (Stack):

- Panel 0 (Tickets) → ticket focus
- Panel 1 (Agents) → agent focus
- Panel 2 (Specs) → health view
- Panel 3 (Stack) → **nothing**
- Panel 4 (Cloud) → cloud service detail
- Panel 5 (CI/CD) → pipeline/deployment detail
- Panel 6 (Infra) → pod detail
- Panel 7 (Chat) → component-based

Pressing Enter on a stack item does nothing, breaking the consistent drill-down pattern. The stack panel is also not navigable (returns 0 for item count) — items can't even be selected.

## Design

Each stack item already captures `name`, `version`, and `sourceFile` from detection. The detection pipeline also produces evidence trails. Following the cloud-service-detail pattern, a stack detail focus view:

```
 TypeScript v5.3.3
 ─────────────────────────────────
 Category:    Language
 Source:      package.json
 Constraint:  engines >= 18.0.0

 Frameworks using this:
   React v18.2       (package.json)
   Vite v5.0         (vite.config.ts)

 Related config files:
   tsconfig.json
   tsconfig.node.json

 Version manager:
   mise → node 18.12.0 (.mise.toml)
```

For infrastructure items, link to live data from other panels:

```
 Kubernetes
 ─────────────────────────────────
 Category:    Infrastructure
 Source:      k8s/

 Config files:
   k8s/deployment.yaml
   k8s/service.yaml
   k8s/ingress.yaml

 Live resources:  (from infra panel)
   5 pods, 2 services, 1 ingress
```

### Making the panel navigable

The stack panel currently renders flat categories (Languages, Frameworks, Infrastructure, etc.) with no selection. To support drill-down:

1. Make stack items selectable (return actual item count, track selected index)
2. Highlight selected item
3. Enter opens the focus view for that item

## Tasks

- [ ] Make stack panel navigable — track selected index, return item count
- [ ] Add `panel === 3` case to `projectDetailDrillDown()` in app.ts
- [ ] Create `stack-detail.ts` focus view following cloud-service-detail pattern
- [ ] Show: category, source file, version, version constraints
- [ ] Show related stack items (frameworks for a language, infrastructure linking)
- [ ] Show related config files from detection evidence
- [ ] Cross-link to infra/cloud panel data where applicable
- [ ] Tests: stack panel navigation, drill-down, detail rendering

## Acceptance Criteria

- Stack panel items are selectable with j/k navigation
- Pressing Enter on a stack item opens a detail focus view
- Detail view shows detection source, version info, related config files
- Infrastructure items cross-reference live data from infra panel when available
- All L2 panels with items now have consistent drill-down behavior
