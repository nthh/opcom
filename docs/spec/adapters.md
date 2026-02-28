# Adapter Contracts (Phase 2+)

## Agent Adapter Interface

Agent adapters normalize different coding agent backends into a common interface.

```typescript
interface AgentAdapter {
  backend: AgentBackend
  start(config: AgentStartConfig): Promise<AgentSession>
  stop(sessionId: string): Promise<void>
  prompt(sessionId: string, message: string): Promise<void>
  subscribe(sessionId: string): AsyncIterable<NormalizedEvent>
}

interface AgentStartConfig {
  projectPath: string
  workItemId?: string          // ticket to work on
  contextPacket: ContextPacket // assembled by Context Builder
  cwd?: string                 // working directory override
  model?: string               // model override
  worktree?: boolean           // create git worktree for isolation
}
```

### Context Packets

The Context Builder assembles everything an agent needs to start working, eliminating manual onboarding:

```typescript
interface ContextPacket {
  project: {
    name: string
    path: string
    stack: StackInfo           // languages, frameworks, infra
    testing: TestingConfig     // how to run tests
    linting: LintConfig[]      // how to lint
    services: ServiceDefinition[]
  }
  workItem?: {
    ticket: WorkItem           // the ticket to work on
    spec?: string              // contents of linked spec file
    relatedTickets?: WorkItem[] // deps, parent, siblings
  }
  git: {
    branch: string
    remote: string
    clean: boolean
  }
  agentConfig?: string         // CLAUDE.md or similar
  memory?: string              // persistent agent memory file contents
}
```

### Implementations

**Claude Code adapter:**
- Spawns `claude` subprocess with `--output-format stream-json`
- Parses NDJSON stream: `message_start`, `content_block_start/delta/stop`, `message_stop`
- Injects context packet as initial system prompt / CLAUDE.md augmentation
- Supports worktree isolation via `git worktree add`

**Pi coding agent adapter:**
- Uses `@mariozechner/pi-coding-agent` createAgentSession()
- JSON-line RPC protocol: commands → responses + events
- Events: `agent_start/end`, `turn_start/end`, `message_start/update/end`, `tool_execution_start/update/end`
- Reference: `~/projects/repos/pi-mono/packages/coding-agent/src/modes/rpc/`

## Message Routing (learned from middleman)

Agents need to communicate with each other, not just with the user:
- Worker reports completion to session manager
- Merger agent receives "ready to merge" from workers
- Reviewer agent receives "ready for review" from workers

```typescript
interface MessageRouter {
  send(from: string, to: string, message: string, delivery?: DeliveryMode): void
  subscribe(agentId: string): AsyncIterable<AgentMessage>
}

type DeliveryMode =
  | "prompt"    // deliver immediately if agent is idle
  | "followUp"  // queue until agent finishes current turn
  | "steer"     // inject as steering input during active streaming
```

## Agent Memory

Per-agent persistent memory, auto-loaded into context on session resume:

```
~/.opcom/memory/<agentId>.md
```

Written by agents via standard file editing tools. Compacts over time.
Contains: user preferences, project facts, decisions, open follow-ups.

## Project Adapter Interface

Project adapters normalize different work/ticket systems into WorkItem.

```typescript
interface ProjectAdapter {
  type: WorkSystemType
  detect(projectPath: string): Promise<boolean>
  listItems(): Promise<WorkItem[]>
  getItem(id: string): Promise<WorkItem | null>
  summarize(): Promise<WorkSummary>
}
```

### Implementations

**TicketsDirAdapter:**
- Reads `.tickets/` or `.tickets/impl/` directories
- Parses YAML frontmatter from README.md files
- Extracts: id, title, status, priority, type, deps, links, services, domains

**TrkAdapter:**
- Extends TicketsDirAdapter for trk-specific features
- Spec-to-code traceability (links between tickets and source files)
- Reference: `~/projects/folia/scripts/trk.py`

**GitHubIssuesAdapter:**
- Uses `gh` CLI or GitHub API
- Maps labels → priority, status
- Maps milestones → parent tickets
