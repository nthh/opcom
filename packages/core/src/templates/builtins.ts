import type { ProjectTemplate } from "@opcom/types";

const software: ProjectTemplate = {
  id: "software",
  name: "Software Project",
  description: "Software project with CI/CD and testing",
  tags: ["software", "development", "engineering"],
  directories: [".tickets/impl", "docs"],
  tickets: {
    "setup-ci.md": `---
id: setup-ci
title: "Set up CI/CD pipeline"
status: open
type: feature
priority: 2
---

# Set up CI/CD pipeline

Configure continuous integration and deployment for the project.

## Tasks

- [ ] Choose CI provider (GitHub Actions, etc.)
- [ ] Set up build pipeline
- [ ] Add automated testing to pipeline
- [ ] Configure deployment steps
`,
    "setup-testing.md": `---
id: setup-testing
title: "Set up testing framework"
status: open
type: feature
priority: 1
---

# Set up testing framework

Choose and configure a testing framework for the project.

## Tasks

- [ ] Select test framework
- [ ] Configure test runner
- [ ] Write initial test suite
- [ ] Add test scripts to package config
`,
    "initial-feature.md": `---
id: initial-feature
title: "Build initial feature"
status: open
type: feature
priority: 1
deps:
  - setup-testing
---

# Build initial feature

Implement the first core feature of the project.

## Tasks

- [ ] Define feature scope
- [ ] Implement core logic
- [ ] Write tests
- [ ] Document usage
`,
  },
  agentsMd: `# {{name}}

{{description}}

## Development

This is a software project. See .tickets/impl/ for current work items.
`,
};

const operations: ProjectTemplate = {
  id: "operations",
  name: "Operations",
  description: "General operational tasks and coordination",
  tags: ["operations", "planning", "coordination"],
  directories: [".tickets/impl", "docs"],
  tickets: {
    "gather-requirements.md": `---
id: gather-requirements
title: "Gather requirements"
status: open
type: feature
priority: 1
---

# Gather requirements

Document requirements, constraints, and success criteria.

## Tasks

- [ ] Identify stakeholders
- [ ] Document requirements
- [ ] Define success criteria
- [ ] Get sign-off
`,
    "create-timeline.md": `---
id: create-timeline
title: "Create timeline"
status: open
type: feature
priority: 2
deps:
  - gather-requirements
---

# Create timeline

Build a realistic timeline with milestones and deadlines.

## Tasks

- [ ] Break work into phases
- [ ] Estimate effort for each phase
- [ ] Identify dependencies
- [ ] Set milestone dates
`,
  },
  agentsMd: `# {{name}}

{{description}}

## Process

This is an operations project. See .tickets/impl/ for current work items.
`,
};

const travel: ProjectTemplate = {
  id: "travel",
  name: "Travel Planning",
  description: "Plan a trip — flights, hotels, activities, itinerary",
  tags: ["travel", "planning", "operations"],
  variables: [
    { name: "destination", prompt: "Where are you going?" },
    { name: "dates", prompt: "What dates? (e.g., May 12-20, 2026)" },
    { name: "travelers", prompt: "How many travelers?", default: "1" },
  ],
  directories: [".tickets/impl", "docs", "docs/research"],
  tickets: {
    "book-flights.md": `---
id: book-flights
title: "Book flights to {{destination}}"
status: open
type: feature
priority: 1
---

# Book flights to {{destination}}

Find and compare flight options to {{destination}} for {{travelers}} traveler(s) departing around {{dates}}.

## Tasks

- [ ] Research flight options
- [ ] Compare prices and routes
- [ ] Book flights
- [ ] Save confirmation details
`,
    "book-accommodation.md": `---
id: book-accommodation
title: "Book accommodation in {{destination}}"
status: open
type: feature
priority: 1
---

# Book accommodation in {{destination}}

Find and book accommodation in {{destination}} for {{travelers}} traveler(s) during {{dates}}.

## Tasks

- [ ] Research hotels/rentals
- [ ] Compare options and prices
- [ ] Book accommodation
- [ ] Save confirmation details
`,
    "plan-activities.md": `---
id: plan-activities
title: "Plan activities in {{destination}}"
status: open
type: feature
priority: 2
---

# Plan activities in {{destination}}

Research and plan activities and experiences in {{destination}} during {{dates}}.

## Tasks

- [ ] Research top attractions
- [ ] Find local experiences
- [ ] Check availability and book
- [ ] Create daily activity plan
`,
    "create-itinerary.md": `---
id: create-itinerary
title: "Create itinerary for {{destination}}"
status: open
type: feature
priority: 3
deps:
  - book-flights
  - book-accommodation
  - plan-activities
---

# Create itinerary for {{destination}}

Compile all bookings and plans into a comprehensive itinerary for {{travelers}} traveler(s).

## Tasks

- [ ] Compile all bookings
- [ ] Create day-by-day schedule
- [ ] Add logistics (transfers, etc.)
- [ ] Share itinerary with travelers
`,
  },
  agentsMd: `# {{name}}

{{description}}

## Trip Details

- **Destination:** {{destination}}
- **Dates:** {{dates}}
- **Travelers:** {{travelers}}

See .tickets/impl/ for planning tasks.
`,
};

const event: ProjectTemplate = {
  id: "event",
  name: "Event Planning",
  description: "Event planning — venue, guests, logistics",
  tags: ["event", "planning", "operations"],
  variables: [
    { name: "event-name", prompt: "What is the event called?" },
    { name: "date", prompt: "What date? (e.g., June 15, 2026)" },
    { name: "expected-guests", prompt: "How many guests expected?", default: "50" },
  ],
  directories: [".tickets/impl", "docs"],
  tickets: {
    "venue-booking.md": `---
id: venue-booking
title: "Book venue for {{event-name}}"
status: open
type: feature
priority: 1
---

# Book venue for {{event-name}}

Find and book a venue for {{expected-guests}} guests on {{date}}.

## Tasks

- [ ] Research venue options
- [ ] Visit top candidates
- [ ] Negotiate and book
- [ ] Confirm capacity for {{expected-guests}} guests
`,
    "guest-list.md": `---
id: guest-list
title: "Manage guest list for {{event-name}}"
status: open
type: feature
priority: 1
---

# Manage guest list for {{event-name}}

Build and manage the guest list (target: {{expected-guests}} guests) for {{date}}.

## Tasks

- [ ] Create initial guest list
- [ ] Send invitations
- [ ] Track RSVPs
- [ ] Finalize headcount
`,
    "logistics.md": `---
id: logistics
title: "Plan logistics for {{event-name}}"
status: open
type: feature
priority: 2
deps:
  - venue-booking
  - guest-list
---

# Plan logistics for {{event-name}}

Coordinate all logistics for {{event-name}} on {{date}}.

## Tasks

- [ ] Arrange catering for {{expected-guests}} guests
- [ ] Plan setup and teardown
- [ ] Coordinate vendors
- [ ] Create day-of timeline
`,
  },
  agentsMd: `# {{name}}

{{description}}

## Event Details

- **Event:** {{event-name}}
- **Date:** {{date}}
- **Expected guests:** {{expected-guests}}

See .tickets/impl/ for planning tasks.
`,
};

export const BUILTIN_TEMPLATES: ProjectTemplate[] = [software, operations, travel, event];
