---
id: project-templates
title: "Project templates for opcom init scaffolding"
status: open
type: feature
priority: 2
deps:
  - init-folder
links:
  - docs/spec/config.md
services:
  - cli
  - core
---

# Project Templates for opcom init

## Goal

Add templates that `opcom init <folder>` can use to scaffold projects with pre-configured structure, initial tickets, and AGENTS.md. Instead of starting every project from scratch, offer templates for common project types. Inspired by auto-co's `templates/` directory (saas, api-backend, docs-site).

## Design

### Template Structure

Templates live in `~/.opcom/templates/` (user-defined) or ship as built-ins:

```
~/.opcom/templates/
├── software/
│   ├── template.yaml
│   ├── AGENTS.md
│   └── tickets/
│       ├── setup-ci.md
│       ├── setup-testing.md
│       └── initial-feature.md
├── operations/
│   ├── template.yaml
│   ├── AGENTS.md
│   └── tickets/
│       ├── gather-requirements.md
│       └── create-timeline.md
├── travel/
│   ├── template.yaml
│   ├── AGENTS.md
│   └── tickets/
│       ├── book-flights.md
│       ├── book-accommodation.md
│       ├── plan-activities.md
│       └── create-itinerary.md
└── event/
    ├── template.yaml
    ├── AGENTS.md
    └── tickets/
        ├── venue-booking.md
        ├── guest-list.md
        └── logistics.md
```

### template.yaml

```yaml
id: travel
name: Travel Planning
description: "Plan a trip — flights, hotels, activities, itinerary"
tags:
  - travel
  - planning
  - operations
variables:
  - name: destination
    prompt: "Where are you going?"
  - name: dates
    prompt: "What dates? (e.g., May 12-20, 2026)"
  - name: travelers
    prompt: "How many travelers?"
    default: "1"
directories:
  - .tickets
  - docs
  - docs/research
```

### Variable Substitution

Templates use `{{variable}}` placeholders in ticket files and AGENTS.md:

```markdown
# Book flights to {{destination}}

Find and compare flight options to {{destination}} for {{travelers}} traveler(s)
departing around {{dates}}.
```

### Init Flow with Templates

```
$ opcom init ~/projects/japan-trip

  opcom init — project setup

  Project name [japan-trip]: Japan Trip
  What's this project about? > Planning May 2026 Japan trip

  Use a template?
  [1] software — Software project with CI/CD and testing
  [2] operations — General operational tasks and coordination
  [3] travel — Travel planning (flights, hotels, activities)
  [4] event — Event planning (venue, guests, logistics)
  [5] none — Start empty

  > 3

  Where are you going? > Japan (Tokyo + Kyoto)
  What dates? > May 12-20, 2026
  How many travelers? > 2

  Created ~/projects/japan-trip/
  ├── .tickets/
  │   ├── book-flights.md
  │   ├── book-accommodation.md
  │   ├── plan-activities.md
  │   └── create-itinerary.md
  ├── AGENTS.md
  └── docs/research/

  4 tickets created from template
```

### Built-in Templates

1. **software** — `.tickets/` with setup-ci, setup-testing, initial-feature. AGENTS.md with standard dev conventions.
2. **operations** — `.tickets/` with gather-requirements, create-timeline. AGENTS.md focused on task coordination.
3. **travel** — `.tickets/` with book-flights, book-accommodation, plan-activities, create-itinerary. Variables: destination, dates, travelers.
4. **event** — `.tickets/` with venue-booking, guest-list, logistics. Variables: event-name, date, expected-guests.

### CLI

```
$ opcom templates list          # show available templates
$ opcom templates show travel   # show template details
$ opcom templates create        # interactive template creation
```

## Tasks

- [ ] Define `ProjectTemplate` type (id, name, description, variables, directories, ticket files, AGENTS.md)
- [ ] Define template directory structure convention
- [ ] Implement template loading from `~/.opcom/templates/` and built-ins
- [ ] Implement variable prompting and substitution
- [ ] Integrate template selection into `opcom init <folder>` flow
- [ ] Ship 4 built-in templates (software, operations, travel, event)
- [ ] Write template ticket files with proper frontmatter
- [ ] Add `opcom templates [list|show|create]` CLI commands
- [ ] Tests for template loading, variable substitution, and scaffolding

## Acceptance Criteria

- `opcom init <folder>` offers template selection
- Selecting a template creates the directory structure, tickets, and AGENTS.md
- Template variables are prompted and substituted into ticket content
- Built-in templates are available without user configuration
- Users can create custom templates in ~/.opcom/templates/
- `opcom templates list` shows all available templates
- Choosing "none" skips templates (current behavior)
