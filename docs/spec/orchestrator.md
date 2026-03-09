# Orchestrator Specification

## Overview

opcom has tickets (what needs doing) and agents (who does it). The missing layer is the **execution plan** — the dependency graph that determines what's unblocked, what can parallelize, and what to do next. Today that layer is a human in a Claude conversation, manually triaging, drawing dep graphs, and assigning work. This spec makes it a runtime.

The orchestrator is a loop:

```
compute unblocked work → start agents → wait → react → recompute → repeat
```

It can be paused at any point to inject new context (a new spec, reprioritized tickets, a "actually do this first"), then resumes with a recomputed plan. Tickets remain the source of truth. Plans are derived, not maintained.

## Core Insight

**Plans are computed, not authored.** The ticket `deps` fields already encode a dependency graph. A plan is just that graph with execution metadata layered on: what's unblocked, what's running, what's done. When tickets change, the plan recomputes. No separate task system to keep in sync.

## Architecture

```
Tickets (.tickets/)
    ↓ deps, priority, status
Planner (compute DAG, identify tracks)
    ↓ Plan
Executor (the loop)
    ↓ start/stop agents
SessionManager (existing)
    ↓ agent events
EventStore (existing)
    ↓ persistence
TUI/WebSocket (existing)
    ↓ display + user control
```

## Types

### Plan

```typescript
interface Plan {
  id: string;
  name: string;
  status: PlanStatus;
  scope: PlanScope;
  steps: PlanStep[];               // flat list, DAG encoded via blockedBy
  context: string;                 // accumulated planning notes (markdown)
  createdAt: string;
  updatedAt: string;
}

type PlanStatus =
  | "planning"      // being designed, not yet executing
  | "executing"     // loop is running
  | "paused"        // user paused, agents may still be finishing current work
  | "done";         // all steps complete

interface PlanScope {
  ticketIds?: string[];            // explicit ticket list
  projectIds?: string[];           // all tickets in these projects
  query?: string;                  // filter: "status:open priority:<=2"
}
```

### PlanStep

```typescript
interface PlanStep {
  ticketId: string;
  projectId: string;
  status: StepStatus;
  track?: string;                  // grouping label ("cloud-services", "dashboard")
  agentSessionId?: string;         // assigned agent (when in-progress)
  blockedBy: string[];             // ticket IDs that must complete first
  completedAt?: string;
  failureReason?: string;
}

type StepStatus =
  | "blocked"       // upstream deps not yet done
  | "ready"         // all deps satisfied, waiting for assignment
  | "in-progress"   // agent working on it
  | "verifying"     // agent exited, verification pipeline running
  | "done"          // agent completed successfully
  | "failed"        // agent failed or ticket needs intervention
  | "skipped";      // user decided to skip
```

### OrchestratorConfig

```typescript
interface OrchestratorConfig {
  maxConcurrentAgents: number;     // default 3, how many agents run in parallel
  autoStart: boolean;              // start agents on ready steps automatically
  backend: AgentBackend;           // default agent backend for new sessions
  model?: string;                  // model override
  worktree: boolean;               // use git worktrees for agent isolation
  pauseOnFailure: boolean;         // auto-pause when a step fails (default true)
  ticketTransitions: boolean;      // auto-update ticket status (default true)
}
```

## Planner

The planner computes a `Plan` from the current ticket state. It's a pure function — no side effects, no LLM calls (unless the user opts into LLM-assisted planning).

### DAG Construction

```typescript
function computePlan(
  tickets: Array<{ projectId: string; items: WorkItem[] }>,
  scope: PlanScope,
  existingPlan?: Plan,            // preserve step status from previous computation
): Plan
```

1. **Scope resolution**: select tickets matching the scope (by project, by ID, by query)
2. **Filter**: only `open` and `in-progress` tickets (skip closed/deferred)
3. **Build DAG**: each ticket becomes a `PlanStep`, `blockedBy` comes from ticket `deps`
4. **Validate**: detect cycles, warn on missing deps (dep references a ticket not in scope)
5. **Compute status**: blocked (has unfinished deps), ready (all deps done), preserve in-progress/done from existing plan
6. **Track assignment**: group steps into parallel tracks (see below)

### Track Computation

Tracks are parallel execution paths through the DAG. They're computed, not configured:

```typescript
function computeTracks(steps: PlanStep[]): Map<string, PlanStep[]> {
  // 1. Topological sort
  // 2. Find independent chains (steps with no shared deps)
  // 3. Group into tracks by connectivity
  // 4. Name tracks by common project or ticket prefix
}
```

Example: given tickets with these deps:
```
event-store: []
workitem-wrapper: []
project-filter: [workitem-wrapper]
cloud-types: []
db-adapters: [cloud-types]
serverless: [cloud-types]
storage: [db-adapters]
```

The planner computes three tracks:
```
Track 1: event-store
Track 2: workitem-wrapper → project-filter
Track 3: cloud-types → db-adapters → serverless
                              └───→ storage
```

Tracks are a display concept — the executor doesn't care about tracks, it just looks at `status === "ready"`.

### Recomputation

The plan recomputes when:
- A ticket's status changes (agent marks it done, user edits it)
- A ticket's deps change
- New tickets are added to scope
- User resumes from pause

Recomputation preserves step status for tickets that haven't changed. Only `blocked`/`ready` status is recalculated — `in-progress`, `done`, `failed` are sticky.

## Executor

The executor is the loop. It's an event-driven state machine, not a polling loop.

### Loop

```typescript
class Executor {
  private plan: Plan;
  private sessionManager: SessionManager;
  private config: OrchestratorConfig;

  async run(): Promise<void> {
    this.plan.status = "executing";
    this.emit("plan_updated", this.plan);

    while (this.plan.status === "executing") {
      // 1. Find ready steps (respecting concurrency limit)
      const ready = this.plan.steps
        .filter(s => s.status === "ready")
        .slice(0, this.availableSlots());

      // 2. Start agents on ready steps
      for (const step of ready) {
        await this.startStep(step);
      }

      // 3. Wait for next event
      const event = await this.nextEvent();

      // 4. React
      switch (event.type) {
        case "agent_completed":
          this.completeStep(event.stepTicketId);
          this.recomputeBlocked();
          break;
        case "agent_failed":
          this.failStep(event.stepTicketId, event.reason);
          if (this.config.pauseOnFailure) this.pause();
          break;
        case "user_pause":
          this.pause();
          break;
        case "user_resume":
          this.recomputePlan();
          break;
        case "ticket_changed":
          this.recomputePlan();
          break;
      }

      // 5. Check done
      if (this.plan.steps.every(s =>
        s.status === "done" || s.status === "skipped"
      )) {
        this.plan.status = "done";
        this.emit("plan_completed", this.plan);
      }
    }
  }

  private availableSlots(): number {
    const running = this.plan.steps.filter(s => s.status === "in-progress").length;
    return this.config.maxConcurrentAgents - running;
  }
}
```

### File-Overlap Scheduling

When multiple steps are `ready`, the executor checks for file-level overlaps before starting them in parallel. Two steps that touch the same files are likely to cause merge conflicts if run concurrently — serializing them avoids the conflict entirely.

**How it works:**

The context graph already maps tickets → related files (via spec links and code analysis). Before starting ready steps, the executor queries the graph for each step's related files and compares them against files claimed by in-progress/verifying steps.

```typescript
private async startReadySteps(): Promise<void> {
  const ready = this.plan.steps.filter(s => s.status === "ready");
  const active = this.plan.steps.filter(
    s => s.status === "in-progress" || s.status === "verifying"
  );

  // Collect files claimed by active steps
  const claimedFiles = new Set<string>();
  for (const step of active) {
    const files = this.getStepFiles(step);
    for (const f of files) claimedFiles.add(f);
  }

  // Filter ready steps: skip those that overlap with claimed files
  const startable: PlanStep[] = [];
  const newlyClaimed = new Set<string>();
  for (const step of sortByPriority(ready)) {
    const files = this.getStepFiles(step);
    const overlaps = files.some(f => claimedFiles.has(f) || newlyClaimed.has(f));
    if (!overlaps) {
      startable.push(step);
      for (const f of files) newlyClaimed.add(f);
    }
  }

  // Start up to available slots
  for (const step of startable.slice(0, this.availableSlots())) {
    await this.startStep(step);
  }
}
```

**Priority breaks ties.** When two ready steps overlap on files, `sortByPriority` determines which runs first:
1. Lower priority number wins (P1 before P2)
2. Equal priority: fewer `blockedBy` deps wins (more foundational)
3. Still equal: array order (from planner's topological sort)

**This is a soft optimization, not a hard guarantee.** The graph may not know about all files an agent will touch. Worktree isolation + auto-rebase handle the cases where overlap prediction is wrong. File-overlap scheduling just reduces how often that happens.

**Graph unavailable fallback.** If the context graph hasn't been built for a project, the executor skips overlap detection and starts all ready steps (current behavior). No graph = no file data = no overlap to detect.

### Starting a Step

When the executor starts a step:

1. Build a `ContextPacket` for the ticket (existing `ContextBuilder`)
2. Inject plan context: "You are working on step 3/7. Steps 1-2 are complete. Here's what changed."
3. Start an agent session via `SessionManager.startSession()`
4. Update step status to `in-progress`
5. Subscribe to agent events

```typescript
private async startStep(step: PlanStep): Promise<void> {
  const project = this.getProject(step.projectId);
  const workItem = this.getWorkItem(step.ticketId);

  // Augment context with plan awareness
  const planContext = this.formatPlanContext(step);

  const session = await this.sessionManager.startSession({
    backend: this.config.backend,
    project,
    workItem,
    worktree: this.config.worktree,
    additionalContext: planContext,
  });

  step.status = "in-progress";
  step.agentSessionId = session.id;
  this.emit("step_started", step);
}
```

### Agent Completion Detection

How does the executor know an agent is "done"? Several signals:

1. **Agent exits cleanly** — `agent_end` event with no error. This is the primary signal. The session manager emits `session_stopped` on both explicit stops and natural exits.
2. **Agent goes idle after marking work complete** — agent's last message indicates completion.
3. **Ticket status changes** — if the agent (or user) marks the ticket as `closed` or `in-progress`, update accordingly.
4. **Manual confirmation** — user presses a key in TUI to mark step done.

After agent exit, the **verification pipeline** runs (see `docs/spec/verification.md`): auto-commit → full test suite → oracle evaluation → mark done/failed (or retry with feedback). This replaces the naive write-count check. If verification fails and retries remain, the executor starts a new agent session with structured failure context — the agent fixes the specific failures without starting over.

The executor listens to `SessionManager` events:

```typescript
this.sessionManager.on("session_stopped", ({ sessionId }) => {
  const step = this.findStepBySession(sessionId);
  if (step) {
    // Check if agent exited cleanly (no error state)
    const session = this.sessionManager.getSession(sessionId);
    if (session?.state === "stopped") {
      this.eventQueue.push({ type: "agent_completed", stepTicketId: step.ticketId });
    } else {
      this.eventQueue.push({
        type: "agent_failed",
        stepTicketId: step.ticketId,
        reason: session?.state ?? "unknown",
      });
    }
  }
});
```

### Pause / Resume

**Pause** (`plan.status = "paused"`):
- No new agents are started
- Running agents continue — don't kill mid-work
- User can: add/remove/edit tickets, change deps, inject context, skip steps
- The TUI shows "PAUSED" indicator with instructions

**Resume** (`plan.status = "executing"`):
- Recompute plan from current ticket state
- Pick up where we left off — steps that were `in-progress` stay in-progress
- Start agents on newly-ready steps

```typescript
pause(): void {
  this.plan.status = "paused";
  this.emit("plan_updated", this.plan);
  // Running agents continue — we just stop starting new ones
}

resume(): void {
  this.recomputePlan();         // tickets may have changed while paused
  this.plan.status = "executing";
  this.emit("plan_updated", this.plan);
  // Loop picks up from the wait point
}
```

### Context Injection

While paused, the user can inject context that affects future steps. Context is appended to `plan.context` (a markdown string) and included in future agent context packets:

```typescript
injectContext(text: string): void {
  this.plan.context += `\n\n---\n_Added ${new Date().toISOString()}_\n\n${text}`;
  this.plan.updatedAt = new Date().toISOString();
  this.emit("plan_updated", this.plan);
}
```

This covers the "pause and add a new spec" pattern from the conversation that inspired this feature. The new context is included in context packets for agents started after the injection.

## Planning Sessions

A planning session is a special agent interaction that produces or modifies a plan. It's what happens when you sit down and say "here's my project landscape, figure out what needs doing."

### Flow

```
User: "plan phase 8"
  ↓
opcom: reads current tickets, deps, project state
  ↓
Planning agent: analyzes gaps, suggests new tickets, orders work
  ↓
User: reviews, adjusts ("add cloud services too")
  ↓
Planning agent: updates tickets, recomputes plan
  ↓
User: approves → plan created, ready to execute
```

### Implementation

Planning sessions use the existing agent infrastructure with a special context packet:

```typescript
interface PlanningContext extends ContextPacket {
  planning: {
    currentTickets: WorkItem[];
    currentPlan?: Plan;
    projectSummaries: Array<{
      name: string;
      stack: StackInfo;
      ticketCount: number;
      cloudServices?: CloudServiceConfig[];
    }>;
    userPrompt: string;            // "plan phase 8" or "what should we work on today"
  };
}
```

The planning agent has access to:
- All tickets and their dep graph
- Project detection results (stack, services, infrastructure)
- Cloud service configs
- The existing triage skill's signals (staleness, priority, blocked items)
- Historical data from the event store (what worked, what failed)

Its output is a modified ticket set and a plan. The user confirms before execution begins.

### Ticket Decomposition

Before execution, the planning session (agent or human) reviews each step and decides if it's agent-sized. Large tickets get decomposed into sub-tickets that go back into the ticket graph:

```
cloud-serverless-adapters (too big for one agent)
    ↓ planning session decomposes
cloud-serverless-types          (deps: [])
cloud-serverless-cf-adapter     (deps: [cloud-serverless-types])
cloud-serverless-firebase-adapter (deps: [cloud-serverless-types])
cloud-serverless-tests          (deps: [cf-adapter, firebase-adapter])
```

Sub-tickets use the existing `parent` field on WorkItem to link back to their origin. The parent ticket is "done" when all children are done. The planner handles this automatically — it already computes status from deps.

Decomposition criteria (agent or human applies these):
1. **Multiple providers** — one ticket per provider (e.g., R2 adapter, GCS adapter)
2. **Types + implementation + tests** — if a ticket spans all three and each is non-trivial, split
3. **TUI + backend** — if a ticket requires both core logic and TUI rendering, split
4. **Spec complexity** — if the linked spec is >200 lines, the ticket probably needs decomposition

The planning session can be:
- **Fully agent-driven** — agent reads ticket + spec + codebase, creates sub-tickets
- **Human-assisted** — agent proposes decomposition, human approves/edits in TUI
- **Fully manual** — human creates sub-tickets directly

These modes can be mixed per-ticket within the same plan. The `plan.status = "planning"` state is where decomposition happens, before transitioning to `"executing"`.

### Relationship to Triage

The existing triage skill (`packages/core/src/skills/triage.ts`) answers "what should I work on next?" — a single recommendation. The planning session answers "what's the execution plan for a body of work?" — a full DAG. Triage feeds into planning:

```typescript
// In planner
const triageSignals = await collectTriageSignals(projects, configDir);
const recommendations = await generateTriage(triageSignals, llm);
// Use recommendations to inform step priority within tracks
```

## Ticket Hygiene

The orchestrator maintains ticket health automatically:

### Status Transitions

When `config.ticketTransitions` is true:

| Event | Ticket Transition |
|-------|-------------------|
| Agent starts on ticket | `open` → `in-progress` |
| Agent completes successfully | `in-progress` → `closed` |
| Agent fails | stays `in-progress` (human decides) |
| All deps of ticket X close | log "X is now unblocked" |

Status changes are written back to the ticket file's YAML frontmatter:

```typescript
async function updateTicketStatus(
  ticketPath: string,
  newStatus: WorkItem["status"],
): Promise<void> {
  const content = await readFile(ticketPath, "utf-8");
  const updated = content.replace(
    /^status:\s*\S+/m,
    `status: ${newStatus}`,
  );
  await writeFile(ticketPath, updated);
}
```

### Hygiene Checks

Run periodically (or on `opcom plan --check`):

1. **Stale tickets**: open tickets with no git activity or agent work in N days → warn
2. **Orphan deps**: ticket depends on an ID that doesn't exist → warn
3. **Cycle detection**: circular deps → error, refuse to plan
4. **Resolved blockers**: ticket's deps are all closed but ticket is still `open` → flag as ready
5. **Abandoned in-progress**: ticket marked `in-progress` with no running agent → flag

```typescript
interface HygieneReport {
  staleTickets: Array<{ ticket: WorkItem; daysSinceActivity: number }>;
  orphanDeps: Array<{ ticket: WorkItem; missingDep: string }>;
  cycles: string[][];               // groups of ticket IDs forming cycles
  unblockedTickets: WorkItem[];     // deps resolved but still open
  abandonedTickets: WorkItem[];     // in-progress with no agent
}

function checkHygiene(
  tickets: Map<string, WorkItem[]>,
  sessions: AgentSession[],
): HygieneReport
```

## Persistence

```
~/.opcom/plans/
├── <plan-id>.yaml              # plan definition + step status
└── <plan-id>.context.md        # accumulated context from planning sessions
```

### Plan YAML

```yaml
id: phase-8-ops
name: "Phase 8: Operational Awareness"
status: executing
scope:
  ticketIds:
    - event-store
    - global-dashboard-workitem-wrapper
    - global-dashboard-project-filter
    - cloud-database-adapters
    - cloud-serverless-adapters
config:
  maxConcurrentAgents: 3
  backend: claude-code
  worktree: true
  pauseOnFailure: true
steps:
  - ticketId: event-store
    projectId: opcom
    status: in-progress
    track: event-store
    agentSessionId: sess-abc123
  - ticketId: global-dashboard-workitem-wrapper
    projectId: opcom
    status: ready
    track: dashboard
  - ticketId: global-dashboard-project-filter
    projectId: opcom
    status: blocked
    track: dashboard
    blockedBy: [global-dashboard-workitem-wrapper]
  - ticketId: cloud-database-adapters
    projectId: opcom
    status: ready
    track: cloud-services
  - ticketId: cloud-serverless-adapters
    projectId: opcom
    status: blocked
    track: cloud-services
    blockedBy: [cloud-database-adapters]
createdAt: "2026-02-28T14:00:00Z"
updatedAt: "2026-02-28T14:30:00Z"
```

## Server API Extensions

### REST

```
GET    /plans                         → Plan[]
GET    /plans/:id                     → Plan
POST   /plans                         → Plan (create from scope)
PATCH  /plans/:id                     → Plan (update config, inject context)
POST   /plans/:id/execute             → void (start the loop)
POST   /plans/:id/pause               → void
POST   /plans/:id/resume              → void
POST   /plans/:id/steps/:ticketId/skip → void
DELETE /plans/:id                     → void

GET    /plans/:id/hygiene             → HygieneReport
```

### WebSocket Events

```typescript
type ServerEvent =
  // ... existing events ...
  | { type: "plan_updated"; plan: Plan }
  | { type: "step_started"; planId: string; step: PlanStep }
  | { type: "step_completed"; planId: string; step: PlanStep }
  | { type: "step_failed"; planId: string; step: PlanStep; reason: string }
  | { type: "plan_completed"; planId: string }
  | { type: "plan_paused"; planId: string }
  | { type: "hygiene_report"; report: HygieneReport }
```

## TUI Integration

### Dashboard (L1)

When a plan is active, the WORK QUEUE panel transforms into the PLAN panel:

```
┌─ opcom ── personal workspace ──────────────────────────────────────────────┐
│                                                                             │
│  PROJECTS                    │  PLAN: phase-8-ops (executing 2/7)          │
│                              │                                              │
│  ▸ opcom        main ✓      │  Track: event-store                          │
│    TypeScript (tickets)      │    ● event-store           in-progress  5m   │
│    30 open  1h              │                                              │
│                              │  Track: dashboard                            │
│                              │    ○ workitem-wrapper      ready             │
│                              │    ○ project-filter        blocked           │
│                              │    ○ cli-status            blocked           │
│                              │                                              │
│                              │  Track: cloud-services                       │
│  ─────────────────────────  │    ○ cloud-types           ready             │
│  AGENTS (1 running)          │    ○ db-adapters           blocked           │
│                              │    ○ serverless            blocked           │
│  opcom/event-store           │                                              │
│    claude-code  streaming    │  ─────────────────────────────────────────── │
│    5m  ctx: 34%              │  Ready: 2  Blocked: 4  Done: 0  Failed: 0   │
│                              │                                              │
├──────────────────────────────┴──────────────────────────────────────────────┤
│ enter:detail  Space:pause  c:context  w:start  s:skip  ?:help  q:quit      │
└─────────────────────────────────────────────────────────────────────────────┘
```

When no plan is active, the panel shows the regular WORK QUEUE (existing behavior).

### Plan Controls

| Key | Context | Action |
|-----|---------|--------|
| `Space` | L1 with active plan | Toggle pause/resume |
| `c` | L1 with paused plan | Inject context (opens input) |
| `w` | L1 on a ready step | Manually start agent on step |
| `s` | L1 on a step | Skip step |
| `Enter` | L1 on an in-progress step | Drill to agent focus (L3) |
| `Enter` | L1 on a blocked/ready step | Drill to ticket focus (L3) |
| `P` | L1 | Create new plan (opens planning input) |
| `H` | L1 | Show hygiene report |

### Status Bar

When a plan is executing, the bottom bar shows:

```
PLAN: phase-8-ops ● executing  2/7 steps  1 agent  │  Space:pause  c:context
```

When paused:

```
PLAN: phase-8-ops ⏸ paused     2/7 steps  0 agents │  Space:resume  c:context
```

### Step Status Icons

| Icon | Status |
|------|--------|
| `●` | in-progress (yellow) |
| `◎` | verifying (orange) |
| `○` | ready (white) |
| `◌` | blocked (dim) |
| `✓` | done (green) |
| `✗` | failed (red) |
| `⊘` | skipped (dim) |

### Plan Completion

When all steps are done, the TUI shows a summary:

```
┌─ PLAN COMPLETE: phase-8-ops ─────────────────────────────────────────────┐
│                                                                           │
│  7/7 steps completed in 2h 14m                                           │
│                                                                           │
│  Track: event-store                                                       │
│    ✓ event-store              34m                                         │
│                                                                           │
│  Track: dashboard                                                         │
│    ✓ workitem-wrapper         18m                                         │
│    ✓ project-filter           12m                                         │
│    ✓ cli-status               8m                                          │
│                                                                           │
│  Track: cloud-services                                                    │
│    ✓ cloud-types              22m                                         │
│    ✓ db-adapters              28m                                         │
│    ✓ serverless               12m                                         │
│                                                                           │
│  Total agent time: 2h 14m across 7 sessions                              │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│ Enter:dismiss  b:briefing (summarize what was built)                      │
└───────────────────────────────────────────────────────────────────────────┘
```

## CLI

```
opcom plan                              # list active plans
opcom plan create [--scope tickets|projects] [--name "..."]
                                        # create plan from current tickets
opcom plan show [plan-id]               # show plan DAG in terminal
opcom plan execute [plan-id]            # start the loop
opcom plan pause [plan-id]              # pause execution
opcom plan resume [plan-id]             # resume execution
opcom plan context [plan-id] "text"     # inject context while paused
opcom plan skip <ticket-id>             # skip a step
opcom plan hygiene                      # run hygiene checks on all tickets
```

### Quick Start

The common flow is short:

```bash
# "Plan everything that's open and execute it"
opcom plan create --scope open --name "today"
opcom plan execute

# Or from TUI: press P to create, Space to start
```

## Integration with Event Store

Plan execution history is stored in the event store (the SQLite DB):

```sql
CREATE TABLE plan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL,
  step_ticket_id TEXT,
  event_type TEXT NOT NULL,          -- plan_started, step_started, step_completed, etc.
  agent_session_id TEXT,
  detail_json TEXT,
  timestamp TEXT NOT NULL
);
-- Index on (plan_id, timestamp)
```

This enables:
- "How long did phase-8 take?" queries
- Briefing skill integration ("The phase-8 plan completed 7 steps in 2h14m")
- Historical track record for estimating future plans
- Debugging failed plans ("step 4 failed after 12m, here's what the agent did")

## Integration with Briefing + Triage Skills

### Briefing

When a plan completes (or at end of day), the briefing skill includes plan progress:

```
## Plan Progress
- **phase-8-ops**: completed 7/7 steps across 3 tracks
  - Event store: done (34m)
  - Dashboard wrapper + filter: done (30m)
  - Cloud service types + DB adapters + serverless: done (62m)
```

### Triage

The triage skill becomes plan-aware. Instead of just recommending individual tickets, it can recommend:
- "Resume the paused phase-8 plan (3 steps remaining)"
- "The cloud-services track is blocked on cloud-types — prioritize that"
- "2 tickets have no plan — consider adding them to an execution plan"

## Plan Overview Screen

When a plan is created, the user sees a summary screen before execution starts. This gives a clear picture of what's about to happen and a confirmation gate.

### Overview Contents

The overview displays:

1. **Step summary** — total step count, ready vs. blocked breakdown
2. **Track layout** — which tickets are in each track, their dependency chain
3. **Plan settings** — maxConcurrentAgents, worktree mode, autoCommit, verification config
4. **Dependency visualization** — which steps gate others, critical path through the DAG

```
┌─ PLAN: phase-8-ops ── 7 steps, 3 tracks ────────────────────────────────┐
│                                                                           │
│  Track: event-store          (1 step)                                     │
│    ○ event-store                                                          │
│                                                                           │
│  Track: dashboard            (3 steps)                                    │
│    ○ workitem-wrapper → project-filter → cli-status                       │
│                                                                           │
│  Track: cloud-services       (3 steps)                                    │
│    ○ cloud-types → db-adapters → serverless                               │
│                                                                           │
│  Settings: 3 concurrent agents, worktrees on, pause on failure            │
│  Ready: 3  Blocked: 4                                                     │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│ Enter:start execution  e:edit settings  esc:cancel                        │
└───────────────────────────────────────────────────────────────────────────┘
```

### CLI Equivalent

```bash
opcom plan show <id>    # prints the same summary to terminal (no TUI needed)
```

### Time Estimation (Future)

The overview screen is designed to eventually include per-step and total duration estimates based on historical data from the event store (average agent time per ticket size/type). This is not part of the initial implementation — the overview launches without estimates and gains them once enough plan history exists.

## Plan Stages

Stages break plan execution into sequential rounds with approval gates between them. After each stage completes, execution pauses and the user reviews results before the next stage begins.

### Stage Computation

Stages group **major feature areas** into reviewable batches, not dependency-depth waves. Each stage should be a coherent chunk of work the user can test before the next batch starts.

Auto-computation groups steps by **track** (connected components in the dep graph). Tracks are ordered by priority and inter-track dependencies, then batched into stages:

```
Stage 1: "geo pipeline" — geospatial-libs, h3-validation, pipeline sub-tickets
Stage 2: "serving layer" — edge-serving, tile-warming, publish-and-serve
Stage 3: "UI + demos" — siting-demo, data-quality-demo, geo-workbench
```

```typescript
function computeStages(steps: PlanStep[]): PlanStage[] {
  // 1. Group steps by track
  // 2. Order tracks by priority (highest first) and deps (if track B depends on track A, A first)
  // 3. Batch tracks into stages based on maxStageSize config
  // 4. Intra-stage dep ordering handled by executor via blockedBy
}
```

The previous approach (dep-depth waves) put all no-dep tickets into stage 0 regardless of feature area, producing stages that were too large to review and where a stuck step in one track blocked unrelated tracks in later stages.

### Explicit Stages

Users can override auto-staging with explicit stage definitions in the plan config:

```yaml
plan:
  stages:
    - [ticket-a, ticket-b]        # stage 1: run in parallel
    - [ticket-c]                   # stage 2: after stage 1 completes
    - [ticket-d, ticket-e]        # stage 3: after stage 2
```

Explicit stages must respect the dependency graph — a ticket cannot be staged before its deps. The planner validates this and errors on conflicts.

### Types

```typescript
interface PlanStage {
  index: number;
  stepTicketIds: string[];
  status: "pending" | "executing" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  summary?: StageSummary;
}

interface StageSummary {
  completed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  testResults?: { passed: number; failed: number };
}
```

### Executor Behavior

When stages are active, the executor modifies its loop:

1. Only start steps in the current stage (not all ready steps)
2. When all steps in the current stage are terminal (done/failed/skipped), emit `stage_completed`
3. Pause execution and wait for user approval before advancing to the next stage
4. If any step failed, include failure details in the stage summary

```typescript
// In executor loop, after completing a step:
if (this.currentStageComplete()) {
  const summary = this.computeStageSummary(this.currentStage);
  this.emit("stage_completed", { planId: this.plan.id, stage: this.currentStage, summary });
  if (!this.config.autoContinue) {
    this.pause();  // wait for user to approve next stage
  } else {
    this.advanceStage();
  }
}
```

### Approval Gate

Between stages, the user can:
- **Continue** — advance to the next stage (`opcom plan continue` or Space in TUI)
- **Inject context** — add notes or specs before the next stage starts
- **Skip steps** — skip specific steps in the upcoming stage
- **Abort** — stop the plan entirely

### Notifications

Stage completion triggers a notification via the configured notification channel:
- Terminal bell (default)
- Slack message (if Slack integration enabled)
- Desktop notification (if supported)

The notification includes the stage summary: how many steps completed, any failures, total duration.

### Auto-Continue

Plans can opt out of approval gates:

```yaml
plan:
  autoContinue: true   # skip approval gates, run all stages back-to-back
```

This is useful for trusted, well-tested plans where pausing between stages adds overhead without value.

### TUI Integration

The plan view shows stage boundaries:

```
  PLAN: phase-8-ops (stage 2/3, executing)

  ── Stage 1 (completed, 34m) ──────────────
    ✓ event-store              34m
    ✓ workitem-wrapper         18m
    ✓ cloud-types              22m

  ── Stage 2 (executing) ──────────────────
    ● project-filter           in-progress
    ● db-adapters              in-progress

  ── Stage 3 (pending) ────────────────────
    ◌ cli-status               blocked
    ◌ serverless               blocked
```

## Non-Goals

- **Distributed execution** — the orchestrator runs on one machine. Multi-machine coordination is out of scope.
- **Automatic re-planning on failure** — when a step fails, the plan pauses. The user decides what to do. No auto-retry or auto-rewrite.
- **Cross-workspace plans** — plans operate within one workspace.
- **Replacing manual workflow** — the orchestrator is opt-in. You can still use opcom without plans, manually starting agents on tickets. Plans add structure when you want it.
