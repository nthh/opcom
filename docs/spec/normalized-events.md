# Normalized Events Specification (Phase 2)

Agent adapters convert backend-specific event streams into a common `NormalizedEvent` type. This is the core abstraction that lets opcom treat Claude Code and Pi agents identically.

## Event Types

### Session Lifecycle
- `agent_start` — agent session created, context loaded
- `agent_end` — agent session terminated (reason: completed | stopped | error)

### Turn Lifecycle
- `turn_start` — agent begins processing (user prompt received)
- `turn_end` — agent finishes processing (ready for next prompt)

### Message Streaming
- `message_start` — assistant message begins
- `message_delta` — text chunk (streaming content)
- `message_end` — assistant message complete

### Tool Execution
- `tool_start` — tool call initiated (name, input)
- `tool_end` — tool call completed (output, success/failure)

### Errors
- `error` — agent error (with error type and message)

### Compaction
- `compaction_start` — context window being compacted
- `compaction_end` — compaction complete (new context size)

## NormalizedEvent Schema

```typescript
interface NormalizedEvent {
  type: NormalizedEventType
  sessionId: string
  timestamp: string
  data?: {
    // message events
    text?: string
    role?: "assistant" | "user" | "system"

    // tool events
    toolName?: string
    toolInput?: string
    toolOutput?: string
    toolSuccess?: boolean

    // lifecycle events
    reason?: string

    // compaction events
    contextTokens?: number

    // raw event for debugging
    raw?: unknown
  }
}
```

## Backend Mapping

### Claude Code (NDJSON stream via --output-format stream-json)

| Claude Code Event | NormalizedEvent |
|---|---|
| `message_start` | `message_start` |
| `content_block_start` (type: text) | (accumulate) |
| `content_block_delta` (type: text_delta) | `message_delta` { text } |
| `content_block_start` (type: tool_use) | `tool_start` { toolName, toolInput } |
| `content_block_stop` (after tool_use) | `tool_end` { toolOutput } |
| `message_stop` | `message_end` |

### Pi Coding Agent (JSON-line RPC)

| Pi Event | NormalizedEvent |
|---|---|
| `agent_start` | `agent_start` |
| `agent_end` | `agent_end` |
| `turn_start` | `turn_start` |
| `turn_end` | `turn_end` |
| `message_start` | `message_start` |
| `message_update` | `message_delta` |
| `message_end` | `message_end` |
| `tool_execution_start` | `tool_start` |
| `tool_execution_update` | (accumulate tool output) |
| `tool_execution_end` | `tool_end` |
| `auto_compaction_start` | `compaction_start` |
| `auto_compaction_end` | `compaction_end` |

Reference implementations:
- Pi RPC client: `~/projects/repos/pi-mono/packages/coding-agent/src/modes/rpc/rpc-client.ts`
- Pi RPC types: `~/projects/repos/pi-mono/packages/coding-agent/src/modes/rpc/rpc-types.ts`

## Context Usage Tracking

Each agent session tracks approximate context window usage (tokens consumed / max tokens). This is surfaced in the TUI status line so the user knows when an agent is approaching compaction.

```typescript
interface ContextUsage {
  tokensUsed: number
  maxTokens: number
  percentage: number  // 0-100
}
```
