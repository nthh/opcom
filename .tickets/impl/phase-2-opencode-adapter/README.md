---
id: phase-2-opencode-adapter
title: "Agent Adapter: OpenCode"
status: closed
type: feature
priority: 1
created: 2026-02-27
milestone: phase-2
deps:
  - phase-2-agent-adapters
links:
  - docs/spec/adapters.md
  - docs/spec/normalized-events.md
---

# Agent Adapter: OpenCode

## Goal

Support OpenCode (github.com/anomalyco/opencode) as an agent backend. OpenCode is model-agnostic (75+ providers), free, and has a REST API + TypeScript SDK — making it the easiest adapter to build.

## Why

- Model-agnostic: users choose Claude, GPT, Gemini, local models via Ollama
- Free tool (pay only for API keys or use free/local models)
- Client/server architecture with formal OpenAPI spec and TypeScript SDK
- `opencode serve` runs headless — perfect for opcom to control
- Config injection via `OPENCODE_CONFIG_CONTENT` env var

## Tasks

- [ ] Install/detect opencode binary (check `which opencode`)
- [ ] Spawn `opencode serve` per session with project-specific config
- [ ] Use `@opencode-ai/sdk` for typed API access
- [ ] Create session: `client.session.create()`
- [ ] Send prompts: `client.session.chat(sessionId, { content })`
- [ ] Subscribe to SSE events, map to NormalizedEvent
- [ ] Inject context packet as initial system prompt via config
- [ ] Model selection passthrough (user picks model, opcom passes to opencode)
- [ ] Handle session lifecycle (start, stop, reconnect)
- [ ] Test with multiple providers (Anthropic, OpenAI, local)

## Event Mapping (SSE → NormalizedEvent)

OpenCode SSE events will need mapping similar to Claude Code NDJSON:
- Session creation → agent_start
- Chat response streaming → message_start/delta/end
- Tool calls → tool_start/end
- Session end → agent_end

The SDK's event subscription provides the raw stream.

## Adapter Shape

```typescript
class OpenCodeAdapter implements AgentAdapter {
  backend = "opencode" as const

  async start(config: AgentStartConfig): Promise<AgentSession> {
    // 1. Generate opencode.json with project config + context
    // 2. Spawn `opencode serve` with OPENCODE_CONFIG_CONTENT
    // 3. Connect via SDK
    // 4. Create session, send context packet as first prompt
  }

  async prompt(sessionId: string, message: string): Promise<void> {
    // client.session.chat(sessionId, { content: message })
  }

  subscribe(sessionId: string): AsyncIterable<NormalizedEvent> {
    // Subscribe to SSE, normalize events
  }
}
```

## Acceptance Criteria

- Can spawn opencode as headless agent from opcom
- Events normalized to same NormalizedEvent as Claude Code and Pi
- User can select any model provider supported by opencode
- Context packet delivered to agent on session start
- Clean shutdown, no zombie processes
