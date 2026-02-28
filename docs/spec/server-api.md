# Server API Specification (Phase 3)

REST + WebSocket protocol for TUI and Web clients. The server is a persistent daemon that tracks state across client reconnections.

## Architecture

```
Client (TUI/Web)  ←→  WebSocket  ←→  Station (daemon)
                                       ├── SessionManager (agents)
                                       ├── ProjectManager (detection, work items)
                                       ├── ContextBuilder (context packets)
                                       ├── MessageRouter (agent ↔ agent)
                                       └── ProcessManager (dev servers)
```

## REST Endpoints

### Workspace
- `GET /workspaces` — list workspaces
- `GET /workspaces/:id` — workspace detail with projects

### Projects
- `GET /projects` — list all projects with summary status
- `GET /projects/:id` — project detail (stack, git, services, testing, linting)
- `POST /projects/:id/scan` — re-run detection
- `GET /projects/:id/work-items` — list work items, sorted by priority
- `GET /projects/:id/work-items/:itemId` — work item detail with spec contents

### Agents
- `GET /agents` — list active agent sessions
- `POST /agents` — start agent session
  ```json
  {
    "projectId": "folia",
    "workItemId": "tile-server-perf",
    "backend": "claude-code",
    "model": "opus",
    "worktree": true
  }
  ```
- `DELETE /agents/:id` — stop agent session
- `POST /agents/:id/prompt` — send message to agent
- `GET /agents/:id/memory` — read agent memory file

### Processes
- `GET /projects/:id/processes` — list running processes
- `POST /projects/:id/processes` — start a service
- `DELETE /projects/:id/processes/:name` — stop a service

## WebSocket Protocol

Single connection, multiplexed per agent. Inspired by middleman's protocol but simplified.

### Client → Server Commands

```typescript
type ClientCommand =
  | { type: "subscribe"; agentId?: string }       // subscribe to agent events
  | { type: "prompt"; agentId: string; text: string; delivery?: DeliveryMode }
  | { type: "start_agent"; projectId: string; workItemId?: string; backend?: string }
  | { type: "stop_agent"; agentId: string }
  | { type: "refresh_status" }                     // trigger status refresh for all projects
  | { type: "ping" }
```

### Server → Client Events

```typescript
type ServerEvent =
  // Connection
  | { type: "ready"; serverTime: string }
  | { type: "error"; code: string; message: string }

  // Agent lifecycle
  | { type: "agent_started"; session: AgentSession }
  | { type: "agent_stopped"; sessionId: string; reason: string }
  | { type: "agent_status"; sessionId: string; state: AgentState; contextUsage?: number }

  // Agent output (streaming)
  | { type: "agent_event"; sessionId: string; event: NormalizedEvent }

  // Project status
  | { type: "project_status"; projectId: string; git: GitInfo; workSummary: WorkSummary }

  // Agent messages (inter-agent communication visible to UI)
  | { type: "agent_message"; from: string; to: string; text: string; timestamp: string }

  // Snapshots (full state sync on connect/reconnect)
  | { type: "agents_snapshot"; sessions: AgentSession[] }
  | { type: "projects_snapshot"; projects: ProjectStatus[] }
```

## Merge Coordination (Phase 3)

Dedicated merge workflow, learned from middleman's merger agent pattern:

1. Worker agent completes task in worktree branch
2. Worker notifies session manager: "ready to merge"
3. Session manager queues merge request
4. Merge executor (agent or automated):
   - Checks out target branch
   - Merges worktree branch
   - Runs tests + typecheck
   - If pass: commits, reports success
   - If fail: reports conflicts/errors, agent can retry
5. Serialized: one merge at a time to prevent conflicts

```
POST /agents/:id/merge-request
{
  "targetBranch": "main",
  "runTests": true,
  "autoMerge": false  // require approval
}
```
