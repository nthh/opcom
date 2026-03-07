# Integration Registry Specification

## Overview

The integration registry makes opcom's features modular and configurable. Each integration (work sources, notifications, CI/CD, agent backends, context-graph) is a module that can be enabled or disabled per workspace. The station only loads what's active. The TUI only renders what's loaded.

Today, all adapters are compiled in and instantiated based on detection. There's no way to disable an integration you don't use, enable one that isn't auto-detected, or see what's active. This spec adds that layer.

## Architecture

```
~/.opcom/config.yaml (integrations section)
    ↓
IntegrationRegistry (loads enabled modules)
    ↓
Station (only initializes active modules)
    ↓
TUI/CLI (only renders active modules)
```

The registry sits between config and runtime. It's the single point where "what's available" meets "what's enabled."

## Integration Module Interface

Every integration implements a common interface:

```typescript
interface IntegrationModule<TConfig = unknown> {
  /** Unique key, e.g. "github-issues", "slack", "claude-code" */
  id: string;

  /** Human-readable name for TUI/CLI display */
  name: string;

  /** Module category */
  category: IntegrationCategory;

  /** Default enabled state when not specified in config */
  enabledByDefault: boolean;

  /** Initialize the module. Called on station start if enabled. */
  init(config: TConfig): Promise<void>;

  /** Tear down the module. Called on station stop. */
  teardown(): Promise<void>;

  /** Health check — is the module operational? */
  healthy(): Promise<boolean>;
}

type IntegrationCategory =
  | "work-sources"       // ticket/issue providers (.tickets, GitHub Issues, Jira)
  | "notifications"      // alert channels (Slack, terminal bell, desktop)
  | "cicd"               // CI/CD pipeline providers (GitHub Actions, GitLab CI)
  | "agent-backends"     // coding agent backends (claude-code, pi-agent)
  | "features";          // optional features (context-graph, briefings, triage)
```

### Lifecycle

```
Station starts
  → read config.yaml integrations section
  → for each enabled module:
      registry.get(category, id).init(config)
  → station runs with only active modules

Station stops
  → for each active module:
      module.teardown()
```

## Integration Registry

```typescript
class IntegrationRegistry {
  private modules = new Map<string, IntegrationModule>();

  /** Register a module (called at build time or plugin load) */
  register(module: IntegrationModule): void;

  /** Get a specific module */
  get(id: string): IntegrationModule | undefined;

  /** List all registered modules */
  listAll(): IntegrationModule[];

  /** List modules in a category */
  listByCategory(category: IntegrationCategory): IntegrationModule[];

  /** Get currently enabled modules (after config resolution) */
  listEnabled(config: IntegrationsConfig): IntegrationModule[];

  /** Initialize all enabled modules */
  async initAll(config: IntegrationsConfig): Promise<void>;

  /** Tear down all active modules */
  async teardownAll(): Promise<void>;
}
```

## Configuration

### Workspace Config

```yaml
# ~/.opcom/config.yaml
integrations:
  work-sources:
    - tickets           # .tickets/ directory adapter
    - github-issues     # GitHub Issues adapter
  notifications:
    - slack
    - terminal-bell
  cicd:
    - github-actions
  agent-backends:
    - claude-code
  features:
    - context-graph
    - triage
    - briefings
```

### Defaults

When the `integrations` section is absent, the default config enables everything that was previously always-on:

```typescript
const DEFAULT_INTEGRATIONS: IntegrationsConfig = {
  "work-sources": ["tickets"],          // .tickets/ always enabled
  "notifications": ["terminal-bell"],
  "cicd": [],                            // none by default (requires setup)
  "agent-backends": ["claude-code"],
  "features": ["triage"],
};
```

This preserves existing behavior — upgrading opcom doesn't break anything.

### Per-Project Overrides

Projects can override workspace-level integration settings:

```yaml
# ~/.opcom/projects/<project-id>.yaml
integrations:
  work-sources:
    - tickets
    - trk               # this project uses trk, others don't
  cicd:
    - github-actions
```

Resolution order: project config > workspace config > defaults.

### Module-Specific Config

Some modules need their own configuration (API tokens, webhook URLs, etc.). These live under a `moduleConfig` key:

```yaml
integrations:
  notifications:
    - slack
  cicd:
    - github-actions

moduleConfig:
  slack:
    webhookUrl: "https://hooks.slack.com/..."
    channel: "#opcom"
  github-actions:
    tokenCommand: "gh auth token"
```

## CLI

```
opcom integrations                     # list all modules with enabled/disabled status
opcom integrations list                # same as above
opcom integrations enable <id>         # enable a module, persist to config
opcom integrations disable <id>        # disable a module, persist to config
opcom integrations status              # show active modules with health check results
```

### Example Output

```
$ opcom integrations

 Category          Module            Status
 work-sources      tickets           ✓ enabled
 work-sources      github-issues     ○ disabled
 work-sources      jira              ○ disabled
 work-sources      trk               ○ disabled
 notifications     slack             ✓ enabled
 notifications     terminal-bell     ✓ enabled
 cicd              github-actions    ✓ enabled
 cicd              gitlab-ci         ○ disabled
 agent-backends    claude-code       ✓ enabled
 agent-backends    pi-agent          ○ disabled
 features          context-graph     ✓ enabled
 features          triage            ✓ enabled
 features          briefings         ○ disabled

 8 enabled, 5 disabled
```

## TUI Integration

### Settings Panel

The TUI settings view (from the `add-settings-menu` ticket) includes an integrations section where users can toggle modules on/off:

```
┌─ Settings ── Integrations ───────────────────────────────────────────────┐
│                                                                           │
│  WORK SOURCES                                                            │
│    [✓] tickets              .tickets/ directory                          │
│    [ ] github-issues        GitHub Issues via API                        │
│    [ ] jira                 Jira via REST API                            │
│    [ ] trk                  trk ticket system                            │
│                                                                           │
│  NOTIFICATIONS                                                           │
│    [✓] slack                Slack webhook notifications                  │
│    [✓] terminal-bell        Terminal bell on events                      │
│                                                                           │
│  CI/CD                                                                   │
│    [✓] github-actions       GitHub Actions pipelines                    │
│                                                                           │
│  AGENT BACKENDS                                                          │
│    [✓] claude-code          Claude Code CLI                              │
│    [ ] pi-agent             Pi coding agent                              │
│                                                                           │
│  FEATURES                                                                │
│    [✓] context-graph        Codebase knowledge graph                    │
│    [✓] triage               Work item triage                            │
│    [ ] briefings            Daily/weekly summaries                       │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│ Space:toggle  Enter:configure  esc:back                                   │
└───────────────────────────────────────────────────────────────────────────┘
```

### Dashboard Awareness

The dashboard adapts to active integrations:
- Deploy column only appears when a `cicd` integration is enabled
- Work queue pulls from all enabled `work-sources`
- Agent panel only shows backends that are enabled
- Context-graph features (drift detection, etc.) only appear when `context-graph` is enabled

## Refactoring Existing Adapters

Existing adapters become integration modules by implementing the interface:

| Current Code | Module ID | Category |
|---|---|---|
| `TicketsDirAdapter` | `tickets` | work-sources |
| `TrkAdapter` | `trk` | work-sources |
| `GitHubIssuesAdapter` | `github-issues` | work-sources |
| `JiraAdapter` | `jira` | work-sources |
| `ClaudeCodeAdapter` | `claude-code` | agent-backends |
| `PiAgentAdapter` | `pi-agent` | agent-backends |
| `GitHubActionsAdapter` | `github-actions` | cicd |
| `SlackNotifier` | `slack` | notifications |
| `ContextGraph` | `context-graph` | features |
| `TriageSkill` | `triage` | features |
| `BriefingSkill` | `briefings` | features |

The refactoring wraps each adapter in the `IntegrationModule` interface. The adapter's existing API doesn't change — the module interface is a lifecycle wrapper around it.

## Non-Goals

- **Plugin loading from disk** — modules are compiled in, not dynamically loaded from a plugin directory. This keeps the system simple and type-safe.
- **Hot reload** — enabling/disabling a module requires a station restart (or at minimum, a config reload command). No live swapping.
- **Module dependencies** — modules don't depend on each other. If a feature needs CI/CD data, it checks whether a cicd module is active and degrades gracefully if not.
