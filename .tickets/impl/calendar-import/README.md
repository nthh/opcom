---
id: calendar-import
title: "Calendar/external source import as work item adapter"
status: open
type: feature
priority: 2
deps:
  - init-folder
links:
  - docs/spec/adapters.md
  - docs/spec/config.md
services:
  - core
  - cli
---

# Calendar/External Source Import as Work Item Adapter

## Goal

Add a project adapter that imports events from external sources (Google Calendar, iCal files, pasted itineraries) and converts them into opcom work items. This enables opcom to manage operational/planning projects — travel, event coordination, deadlines — not just code tickets.

## Design

### New Project Adapter: CalendarAdapter

Follows the existing `ProjectAdapter` interface:

```typescript
interface ProjectAdapter {
  type: WorkSystemType
  detect(projectPath: string): Promise<boolean>
  listItems(): Promise<WorkItem[]>
  getItem(id: string): Promise<WorkItem | null>
  summarize(): Promise<WorkSummary>
}
```

WorkSystemType gets a new value: `"calendar"`.

### Import Sources

Phase 1 (this ticket):
- **iCal file (.ics)** — parse with ical.js or similar, map events to work items
- **Pasted text** — user pastes itinerary/event list, LLM parses into structured events
- **Manual entry** — CLI prompts for event details

Phase 2 (future):
- **Google Calendar API** — OAuth + calendar sync
- **Outlook/Exchange** — similar API integration
- **Notion databases** — sync Notion items as work items

### Event → WorkItem Mapping

```yaml
# Calendar event becomes:
id: evt-2026-05-12-tokyo-arrival
title: "Arrive in Tokyo (NRT)"
status: open
type: task
priority: 2
tags:
  category: [travel]
  location: [tokyo]
  source: [calendar]
due: "2026-05-12"
scheduled: "2026-05-12T14:30:00+09:00"
deps: []
links: []
```

Key mapping rules:
- Event summary → title
- Event start → `scheduled` tag (or new frontmatter field)
- Event location → `location` tag
- All-day events get date only, timed events get datetime
- Recurring events expand to individual work items (with a shared parent)
- Event description → ticket body content

### WorkItem Type Extensions

Work items need optional date fields for calendar-sourced items:

```yaml
# New optional frontmatter fields
due: "2026-04-01"           # deadline for completion
scheduled: "2026-05-12"     # when this is happening
```

### CLI Integration

```
$ opcom import calendar events.ics
  Parsed 12 events from events.ics
  Created 12 work items in .tickets/

$ opcom import paste
  Paste your itinerary (empty line to finish):
  > May 12: Arrive Tokyo NRT 2:30pm
  > May 13: TeamLab Borderless
  > May 15: Shinkansen to Kyoto

  Created 3 work items from pasted text

$ opcom import gcal "Trip to Japan"
  (Phase 2 — requires OAuth setup)
```

## Tasks

- [ ] Add `due` and `scheduled` optional fields to TicketFrontmatter type
- [ ] Add `"calendar"` to WorkSystemType union
- [ ] Implement iCal parser (parse .ics → WorkItem[])
- [ ] Implement paste-to-events (LLM-assisted text → WorkItem[])
- [ ] Implement CalendarAdapter (detect, listItems, getItem, summarize)
- [ ] Add `opcom import` CLI command with subcommands (calendar, paste)
- [ ] Write parsed events to .tickets/ as markdown files with frontmatter
- [ ] Tests for iCal parsing (standard events, all-day, recurring, timezones)
- [ ] Tests for paste parsing
- [ ] Tests for CalendarAdapter interface compliance

## Acceptance Criteria

- `opcom import calendar events.ics` parses an iCal file and creates work items in .tickets/
- `opcom import paste` accepts pasted text and creates work items
- Created work items have proper frontmatter (due, scheduled, tags)
- CalendarAdapter.listItems() returns the imported events
- `opcom status` shows calendar-sourced work items alongside code tickets
- No new runtime dependencies for iCal parsing beyond what's reasonable (single small lib)
