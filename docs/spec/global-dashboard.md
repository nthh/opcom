# Global Dashboard & Life Project Specification

## Overview

opcom currently scopes work items to individual projects. The L1 dashboard aggregates WorkItems across projects via `client.projectTickets` (a `Map<string, WorkItem[]>`), but the work queue panel doesn't show which project a work item belongs to, and there's no way to filter by project. Meanwhile, non-code concerns (calendar, trips, todos) have no home.

This spec addresses both with one insight: **"life" is just another project**. No new primitives — just `opcom add ~/life` with `.tickets/` and adapters. The real feature is making the global dashboard project-aware.

## 1. The Life Project Pattern

### Setup

```bash
mkdir -p ~/life/.tickets
opcom add ~/life
```

Detection runs normally. The result: low confidence, empty stack, no git — and that's fine. opcom already handles this gracefully. The project shows up in the dashboard like any other.

### Example Tickets

Personal work items use the same `TicketFrontmatter` as code tickets (`packages/types/src/work-items.ts`):

```
~/life/.tickets/
├── dentist-march/
│   └── README.md
├── tax-return-2026/
│   └── README.md
├── camping-trip-june/
│   └── README.md
└── weekly-groceries/
    └── README.md
```

**`dentist-march/README.md`:**
```markdown
---
id: dentist-march
title: "Dentist appointment"
status: open
type: appointment
priority: 1
created: "2026-03-15"
links:
  - "https://myclinic.example.com/booking/12345"
---

March 20, 2pm. Dr. Park. Bring insurance card.
```

**`tax-return-2026/README.md`:**
```markdown
---
id: tax-return-2026
title: "File 2026 tax return"
status: open
type: task
priority: 1
created: "2026-01-15"
deps:
  - w2-collection
---

Deadline: April 15. Need W-2s from both jobs, 1099 from freelance.
```

**`camping-trip-june/README.md`:**
```markdown
---
id: camping-trip-june
title: "Big Sur camping trip"
status: open
type: trip
priority: 2
created: "2026-02-28"
---

June 14-16. Reserve campsite at Pfeiffer. Pack list in notes.
```

### What Works Today

- Detection: empty stack is fine — Tier 3 finds nothing, confidence is "none", project still registers
- Ticket scanning: `scanTickets()` reads `.tickets/` regardless of project type
- Dashboard: tickets appear in the global work queue, sorted by priority alongside code tickets
- Agents: you can even point an agent at a life ticket (e.g., "research campsite availability")

### Future Adapter Ideas

These would implement `ProjectAdapter` (see `docs/spec/adapters.md`) and produce standard `WorkItem` objects:

| Adapter | Source | Notes |
|---------|--------|-------|
| `GoogleCalendarAdapter` | Google Calendar API | Events → WorkItems with `type: "appointment"`, syncs on refresh |
| `AppleRemindersAdapter` | Apple Reminders (via `reminders` CLI or EventKit) | Lists → WorkItems, completed → status: "closed" |
| `TasksYamlAdapter` | `tasks.yaml` in project root | Quick-add format, no directory per item |
| `TodoTxtAdapter` | `todo.txt` format | Standard format, many existing tools |

Each adapter would implement `detect()`, `listItems()`, `getItem()`, `summarize()` from the `ProjectAdapter` interface. Items flow into the same `WorkItem` pipeline — no special handling needed.

## 2. Dashboard Work Item Association

### Problem

When `syncData()` in `app.ts:159-168` aggregates work items, it discards the project association:

```typescript
// Current: projectId is lost
const allWorkItems: WorkItem[] = [];
for (const [, tickets] of this.client.projectTickets) {
  allWorkItems.push(...tickets);
}
this.dashboardState.workItems = allWorkItems;
```

Later, when the user presses `w` on a work item, the code has to reverse-lookup the project by iterating `client.projectTickets` again (`app.ts:559-565`). This is both wasteful and fragile.

### Solution: Dashboard Work Item Wrapper

Keep `WorkItem` clean — it's a storage/adapter type defined in `packages/types/`. Add a runtime wrapper used only in dashboard state:

```typescript
// In packages/cli/src/tui/views/dashboard.ts

export interface DashboardWorkItem {
  item: WorkItem;
  projectId: string;
  projectName: string;
}
```

**Why a wrapper, not extending WorkItem:**
- `WorkItem` is a data type shared across adapters, serialization, and storage. Adding `projectId` to it would mean every adapter and scanner needs to know about projects.
- The project association is a runtime concern — it's established during aggregation, not during ticket parsing.
- The reverse-lookups in `startAgentFromDashboard()` and `startAgentFromTicket()` go away.

### Migration

`DashboardState.workItems` changes type:

```typescript
export interface DashboardState {
  projects: ProjectStatusSnapshot[];
  agents: AgentSession[];
  workItems: DashboardWorkItem[];  // was: WorkItem[]
  focusedPanel: number;
  selectedIndex: number[];
  scrollOffset: number[];
  priorityFilter: number | null;
  projectFilter: string | null;   // new: projectId or null for all
  searchQuery: string;
}
```

The `syncData()` aggregation becomes:

```typescript
const allWorkItems: DashboardWorkItem[] = [];
for (const [projectId, tickets] of this.client.projectTickets) {
  const project = this.client.projects.find(p => p.id === projectId);
  const projectName = project?.name ?? projectId;
  for (const item of tickets) {
    allWorkItems.push({ item, projectId, projectName });
  }
}
this.dashboardState.workItems = allWorkItems;
```

## 3. Project Filter

### State

```typescript
projectFilter: string | null  // null = show all, string = projectId
```

### Keybindings

| Key | Action |
|-----|--------|
| `f` | Cycle project filter forward (all → project1 → project2 → ... → all) |
| `F` | Clear project filter (back to all) |

The cycle order follows `dashboardState.projects` array order.

### Filter Logic

`getFilteredWorkItems()` in `dashboard.ts:288-300` already filters by priority and search. Add project filter:

```typescript
export function getFilteredWorkItems(state: DashboardState): DashboardWorkItem[] {
  let items = state.workItems;

  // Project filter
  if (state.projectFilter !== null) {
    items = items.filter(w => w.projectId === state.projectFilter);
  }

  // Priority filter
  if (state.priorityFilter !== null) {
    items = items.filter(w => w.item.priority === state.priorityFilter);
  }

  // Search filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    items = items.filter(w =>
      w.item.title.toLowerCase().includes(q) ||
      w.item.id.toLowerCase().includes(q) ||
      w.projectName.toLowerCase().includes(q)  // search matches project name too
    );
  }

  return [...items].sort((a, b) => a.item.priority - b.item.priority);
}
```

### Filter Indicator

The work queue panel title reflects the active filter:

```
Work Queue (12)              — no filter
Work Queue (5) [mtnmap]      — filtered to mtnmap
Work Queue (3) [life] P1     — filtered to life + priority 1
```

## 4. Project Labels on Work Items

### When to Show

- **Filter active (single project):** hide project label — it's redundant
- **No filter (all projects):** show `[project-name]` prefix on each work item

### Rendering Change

In `formatWorkItemLine()` (`dashboard.ts:170-188`), the function receives a `DashboardWorkItem` instead of bare `WorkItem`. When no project filter is active, prepend the project name:

```typescript
function formatWorkItemLine(
  dw: DashboardWorkItem,
  agents: AgentSession[],
  maxWidth: number,
  showProject: boolean,  // true when projectFilter is null
): string {
  const item = dw.item;
  const priorityColors = [ANSI.red, ANSI.red, ANSI.yellow, ANSI.cyan, ANSI.dim];
  const pColor = priorityColors[item.priority] ?? ANSI.dim;
  const priority = color(pColor, `P${item.priority}`);

  const projectLabel = showProject
    ? dim(`[${dw.projectName}] `)
    : "";

  const hasAgent = agents.some(a => a.workItemId === item.id && a.state !== "stopped");
  const agentIcon = hasAgent ? " 🤖" : "";

  const line = `${priority} ${projectLabel}${item.title}${agentIcon}`;
  return truncate(line, maxWidth);
}
```

### Visual Result

```
WORK QUEUE (8)

P0  [mtnmap]  auth-migration         🤖
P1  [folia]   tile-server-perf       🤖
P1  [folia]   change-detection       🤖
P1  [mtnmap]  offline-sync
P1  [life]    dentist appointment
P2  [life]    Big Sur camping trip
P2  [conversi] api-docs
P3  [life]    weekly groceries
```

Filtered to `life`:

```
WORK QUEUE (3) [life]

P1  dentist appointment
P2  Big Sur camping trip
P3  weekly groceries
```

## 5. CLI `opcom status` Changes

### Current Output

`formatStatusDashboard()` in `packages/cli/src/ui/format.ts:52` already shows per-project ticket counts:

```
opcom — personal workspace

PROJECTS (4)

  mtnmap        main clean
    Expo+Firebase+CF Workers
    Tickets: 25 open / 31 total

  life          (no git)
    (empty stack)
    Tickets: 3 open / 3 total
  ...
```

This already works. No changes needed for the default view.

### Optional: `--project` Flag

```bash
opcom status --project life
```

Shows a single-project view: full ticket list (not just counts), stack details, git status. Implementation: filter `statuses` array to the matching project before passing to `formatStatusDashboard()`.

### Optional: Work Item Summary

Add a global work summary after the projects list:

```
WORK QUEUE (across all projects)

  P0  auth-migration          mtnmap     🤖
  P1  tile-server-perf        folia      🤖
  P1  dentist appointment     life
  P2  Big Sur camping trip    life
  ...
```

This mirrors the TUI work queue in text form. Useful for quick `opcom status` checks without entering the TUI.

## 6. Implementation Sequence

1. **Add `DashboardWorkItem` wrapper** — `packages/cli/src/tui/views/dashboard.ts`
   - Define the interface
   - Update `DashboardState.workItems` type
   - Update `getFilteredWorkItems()`, `formatWorkItemLine()`, `getPanelItemCount()`

2. **Update aggregation in `syncData()`** — `packages/cli/src/tui/app.ts:159-168`
   - Build `DashboardWorkItem[]` with projectId/projectName
   - Remove reverse-lookups in `startAgentFromDashboard()` and `startAgentFromTicket()`

3. **Add `projectFilter` to `DashboardState`** — `dashboard.ts`
   - Add field to interface and `createDashboardState()`
   - Add filter logic to `getFilteredWorkItems()`
   - Show filter in panel title

4. **Add project labels to work items** — `dashboard.ts`
   - Pass `showProject` flag to `formatWorkItemLine()`
   - Conditionally render `[projectName]` prefix

5. **Add `f`/`F` keybindings** — `app.ts` `handleDashboardInput()`
   - `f`: cycle through projects
   - `F`: clear filter

6. **CLI status enhancements** (optional) — `packages/cli/src/commands/status.ts`, `packages/cli/src/ui/format.ts`
   - `--project` flag
   - Global work queue summary

## 7. Non-Goals

- **New data types for personal items** — life tickets use existing `TicketFrontmatter`. No `CalendarEvent` or `Reminder` type.
- **Calendar/reminder sync implementation** — future adapter work, this spec covers the pattern only.
- **Multi-workspace filtering** — the project filter operates within the current workspace. Cross-workspace views are a separate concern.
- **WorkItem schema changes** — `WorkItem` in `packages/types/` stays clean. Runtime association via wrapper only.
