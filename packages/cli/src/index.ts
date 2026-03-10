#!/usr/bin/env node

import { runInit, runInitFolder } from "./commands/init.js";
import { runAdd } from "./commands/add.js";
import { runScan } from "./commands/scan.js";
import { runStatus } from "./commands/status.js";
import { runWork } from "./commands/work.js";
import { runAgentList, runAgentStop, runAgentPrompt } from "./commands/agent.js";
import { runServe } from "./commands/serve.js";
import { runDev, runDevStop } from "./commands/dev.js";
import { runTui } from "./commands/tui.js";
import { runWeb } from "./commands/web.js";
import { runBriefing } from "./commands/briefing.js";
import { runTriage } from "./commands/triage.js";
import { runOracle } from "./commands/oracle.js";
import { runScheduleList, runScheduleAdd, runScheduleRemove } from "./commands/schedule.js";
import { runAnalytics } from "./commands/analytics.js";
import { runChanges } from "./commands/changes.js";
import { runDiff } from "./commands/diff.js";
import { runCI } from "./commands/ci.js";
import { runInfra } from "./commands/infra.js";
import { runSettingsList, runSettingsGet, runSettingsSet, runSettingsReset } from "./commands/settings.js";
import { runIntegrationsList, runIntegrationsEnable, runIntegrationsDisable } from "./commands/integrations.js";
import { runTicketList, runTicketCreate, runTicketShow } from "./commands/ticket.js";
import {
  runPlanList,
  runPlanCreate,
  runPlanShow,
  runPlanExecute,
  runPlanPause,
  runPlanResume,
  runPlanContext,
  runPlanSkip,
  runPlanHygiene,
} from "./commands/plan.js";
import { runGraphBuild, runGraphStats, runGraphDrift } from "./commands/graph.js";
import { runScaffold, runAudit, runTrace, runCoverage, runUcLs, runUcShow, runUcGaps } from "./commands/traceability.js";
import { runTemplatesList, runTemplatesShow } from "./commands/templates.js";
import { runImportCalendar, runImportPaste } from "./commands/import.js";
import { runSkillsList, runSkillsShow, runSkillsCreate } from "./commands/skills.js";
import { runState } from "./commands/state.js";
import { runTeamList, runTeamShow } from "./commands/team.js";
import { runWorkspaceHealth, runWorkspaceDrift, runWorkspacePatterns } from "./commands/workspace.js";

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case "init":
      if (args[1]) {
        return runInitFolder({ folder: args[1] });
      }
      return runInit();

    case "add":
      if (!args[1]) {
        console.error("  Usage: opcom add <path>");
        process.exit(1);
      }
      return runAdd(args[1]);

    case "scan":
      return runScan(args[1]);

    case "status": {
      const projectIdx = args.indexOf("--project");
      const projectFilter = projectIdx !== -1 ? args[projectIdx + 1] : undefined;
      return runStatus({ projectFilter });
    }

    case "work": {
      if (!args[1]) {
        console.error("  Usage: opcom work <project>[/<ticket>]");
        console.error("  Options: --backend claude-code|opencode  --model <model>  --worktree");
        process.exit(1);
      }
      const workOpts: { backend?: string; model?: string; worktree?: boolean } = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--backend" && args[i + 1]) { workOpts.backend = args[++i]; }
        else if (args[i] === "--model" && args[i + 1]) { workOpts.model = args[++i]; }
        else if (args[i] === "--worktree") { workOpts.worktree = true; }
      }
      return runWork(args[1], workOpts);
    }

    case "agent": {
      const subcommand = args[1];
      switch (subcommand) {
        case "list":
        case "ls":
          return runAgentList();
        case "stop":
          if (!args[2]) {
            console.error("  Usage: opcom agent stop <session-id>");
            process.exit(1);
          }
          return runAgentStop(args[2]);
        case "prompt":
          if (!args[2] || !args[3]) {
            console.error("  Usage: opcom agent prompt <session-id> <message>");
            process.exit(1);
          }
          return runAgentPrompt(args[2], args.slice(3).join(" "));
        default:
          console.error("  Usage: opcom agent <list|stop|prompt>");
          process.exit(1);
      }
      break;
    }

    case "serve": {
      let port: number | undefined;
      for (let i = 1; i < args.length; i++) {
        if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) {
          port = parseInt(args[++i], 10);
        }
      }
      return runServe({ port });
    }

    case "tui":
      return runTui();

    case "web":
      return runWeb();

    case "briefing": {
      const briefingOpts: { since?: string; project?: string } = {};
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--since" && args[i + 1]) { briefingOpts.since = args[++i]; }
        else if (args[i] === "--project" && args[i + 1]) { briefingOpts.project = args[++i]; }
      }
      return runBriefing(briefingOpts);
    }

    case "triage":
      return runTriage();

    case "oracle": {
      if (!args[1]) {
        console.error("  Usage: opcom oracle <session-id>");
        process.exit(1);
      }
      return runOracle(args[1]);
    }

    case "schedule": {
      const subcommand = args[1];
      switch (subcommand) {
        case "list":
        case "ls":
          return runScheduleList();
        case "add":
          if (!args[2] || !args[3] || !args[4]) {
            console.error("  Usage: opcom schedule add <name> <cron> <command>");
            process.exit(1);
          }
          return runScheduleAdd(args[2], args[3], args[4]);
        case "remove":
        case "rm":
          if (!args[2]) {
            console.error("  Usage: opcom schedule remove <id>");
            process.exit(1);
          }
          return runScheduleRemove(args[2]);
        default:
          console.error("  Usage: opcom schedule <list|add|remove>");
          process.exit(1);
      }
      break;
    }

    case "analytics": {
      const sub = args[1];
      if (!sub) {
        console.error("  Usage: opcom analytics <tools|sessions|daily>");
        console.error("  Options: --project <id>  --days <n>");
        process.exit(1);
      }
      const analyticsOpts: { project?: string; days?: number } = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--project" && args[i + 1]) { analyticsOpts.project = args[++i]; }
        else if (args[i] === "--days" && args[i + 1]) { analyticsOpts.days = parseInt(args[++i], 10); }
      }
      return runAnalytics(sub, analyticsOpts);
    }

    case "changes": {
      if (!args[1]) {
        console.error("  Usage: opcom changes <ticket-id> [--session <id>] [--project <id>]");
        process.exit(1);
      }
      const changesOpts: { session?: string; project?: string } = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--session" && args[i + 1]) { changesOpts.session = args[++i]; }
        else if (args[i] === "--project" && args[i + 1]) { changesOpts.project = args[++i]; }
      }
      return runChanges(args[1], changesOpts);
    }

    case "diff": {
      if (!args[1]) {
        console.error("  Usage: opcom diff <ticket-id> [--session <id>]");
        process.exit(1);
      }
      const diffOpts: { session?: string } = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--session" && args[i + 1]) { diffOpts.session = args[++i]; }
      }
      return runDiff(args[1], diffOpts);
    }

    case "plan": {
      const subcommand = args[1];
      switch (subcommand) {
        case "list":
        case "ls":
          return runPlanList();
        case "create": {
          const planOpts: { name?: string; scope?: string; ticketIds?: string[]; projectIds?: string[] } = {};
          for (let i = 2; i < args.length; i++) {
            if (args[i] === "--name" && args[i + 1]) { planOpts.name = args[++i]; }
            else if (args[i] === "--scope" && args[i + 1]) { planOpts.scope = args[++i]; }
            else if (args[i] === "--ticket" && args[i + 1]) {
              if (!planOpts.ticketIds) planOpts.ticketIds = [];
              planOpts.ticketIds.push(args[++i]);
            }
            else if (args[i] === "--project" && args[i + 1]) {
              if (!planOpts.projectIds) planOpts.projectIds = [];
              planOpts.projectIds.push(args[++i]);
            }
          }
          return runPlanCreate(planOpts);
        }
        case "show":
          return runPlanShow(args[2]);
        case "execute":
        case "run":
          return runPlanExecute(args[2]);
        case "pause":
          return runPlanPause(args[2]);
        case "resume":
          return runPlanResume(args[2]);
        case "context":
          if (!args[2]) {
            console.error("  Usage: opcom plan context <text> [plan-id]");
            process.exit(1);
          }
          return runPlanContext(args[2], args[3]);
        case "skip":
          if (!args[2]) {
            console.error("  Usage: opcom plan skip <ticket-id> [plan-id]");
            process.exit(1);
          }
          return runPlanSkip(args[2], args[3]);
        case "hygiene":
          return runPlanHygiene();
        default:
          console.error("  Usage: opcom plan <list|create|show|execute|pause|resume|context|skip|hygiene>");
          process.exit(1);
      }
      break;
    }

    case "ticket": {
      const subcommand = args[1];
      switch (subcommand) {
        case "list":
        case "ls":
          return runTicketList(args[2]);
        case "create": {
          if (!args[2] || !args[3]) {
            console.error("  Usage: opcom ticket create <project> \"<description>\"");
            process.exit(1);
          }
          return runTicketCreate(args[2], args.slice(3).join(" "));
        }
        case "show": {
          if (!args[2] || !args[3]) {
            console.error("  Usage: opcom ticket show <project> <ticket-id>");
            process.exit(1);
          }
          return runTicketShow(args[2], args[3]);
        }
        default:
          console.error("  Usage: opcom ticket <list|create|show>");
          process.exit(1);
      }
      break;
    }

    case "graph": {
      const graphSub = args[1];
      switch (graphSub) {
        case "build":
          return runGraphBuild(args[2]);
        case "stats":
          return runGraphStats(args[2]);
        case "drift":
          return runGraphDrift(args[2]);
        default:
          console.error("  Usage: opcom graph <build|stats|drift> [project]");
          process.exit(1);
      }
      break;
    }

    case "workspace": {
      const wsSub = args[1];
      switch (wsSub) {
        case "health":
        case undefined:
          return runWorkspaceHealth();
        case "drift":
          return runWorkspaceDrift();
        case "patterns":
          return runWorkspacePatterns();
        default:
          console.error("  Usage: opcom workspace <health|drift|patterns>");
          process.exit(1);
      }
      break;
    }

    case "ci": {
      const ciProject = args[1];
      const ciWatch = args.includes("--watch");
      return runCI(ciProject, { watch: ciWatch });
    }

    case "infra": {
      const infraProject = args[1];
      const infraSub = args[2]; // pods, logs, restart
      const infraTarget = args[3]; // pod name or deployment name
      const infraFollow = args.includes("--follow") || args.includes("-f");
      const infraContainerIdx = args.findIndex(a => a === "--container" || a === "-c");
      const infraContainer = infraContainerIdx >= 0 ? args[infraContainerIdx + 1] : undefined;
      return runInfra(infraProject, infraSub, infraTarget, { follow: infraFollow, container: infraContainer });
    }

    case "scaffold": {
      const scaffoldAll = args.includes("--all");
      const scaffoldDryRun = args.includes("--dry-run");
      const scaffoldSpec = args.filter(a => !a.startsWith("--"))[1];
      return runScaffold(scaffoldSpec, { dryRun: scaffoldDryRun, all: scaffoldAll });
    }

    case "audit": {
      const auditVerbose = args.includes("--verbose") || args.includes("-v");
      const auditProjectIdx = args.indexOf("--project");
      const auditProject = auditProjectIdx !== -1 ? args[auditProjectIdx + 1] : undefined;
      return runAudit({ verbose: auditVerbose, project: auditProject });
    }

    case "trace": {
      if (!args[1]) {
        console.error("  Usage: opcom trace <file-path>");
        process.exit(1);
      }
      return runTrace(args[1]);
    }

    case "coverage": {
      return runCoverage(args[1]);
    }

    case "uc": {
      const ucSub = args[1];
      switch (ucSub) {
        case "ls":
        case "list":
        case undefined:
          return runUcLs();
        case "show":
          if (!args[2]) {
            console.error("  Usage: opcom uc show <uc-id>");
            process.exit(1);
          }
          return runUcShow(args[2]);
        case "gaps":
          if (!args[2]) {
            console.error("  Usage: opcom uc gaps <uc-id>");
            process.exit(1);
          }
          return runUcGaps(args[2]);
        default:
          console.error("  Usage: opcom uc [ls|show|gaps]");
          process.exit(1);
      }
      break;
    }

    case "templates":
    case "template": {
      const subcommand = args[1];
      switch (subcommand) {
        case "list":
        case "ls":
        case undefined:
          return runTemplatesList();
        case "show":
          if (!args[2]) {
            console.error("  Usage: opcom templates show <id>");
            process.exit(1);
          }
          return runTemplatesShow(args[2]);
        default:
          console.error("  Usage: opcom templates [list|show <id>]");
          process.exit(1);
      }
      break;
    }

    case "dev": {
      if (!args[1]) {
        console.error("  Usage: opcom dev <project> [service]");
        process.exit(1);
      }
      if (args[1] === "stop" && args[2]) {
        return runDevStop(args[2]);
      }
      return runDev(args[1], args[2]);
    }

    case "settings":
    case "config": {
      const subcommand = args[1];
      switch (subcommand) {
        case "list":
        case "ls":
        case undefined:
          return runSettingsList();
        case "get":
          if (!args[2]) {
            console.error("  Usage: opcom settings get <key>");
            process.exit(1);
          }
          return runSettingsGet(args[2]);
        case "set":
          if (!args[2] || !args[3]) {
            console.error("  Usage: opcom settings set <key> <value>");
            process.exit(1);
          }
          return runSettingsSet(args[2], args[3]);
        case "reset":
          return runSettingsReset(args[2]);
        default:
          console.error("  Usage: opcom settings [list|get|set|reset]");
          process.exit(1);
      }
      break;
    }

    case "integrations":
    case "integration": {
      const subcommand = args[1];
      switch (subcommand) {
        case "list":
        case "ls":
        case undefined:
          return runIntegrationsList();
        case "enable":
          if (!args[2]) {
            console.error("  Usage: opcom integrations enable <id>");
            process.exit(1);
          }
          return runIntegrationsEnable(args[2]);
        case "disable":
          if (!args[2]) {
            console.error("  Usage: opcom integrations disable <id>");
            process.exit(1);
          }
          return runIntegrationsDisable(args[2]);
        default:
          console.error("  Usage: opcom integrations [list|enable|disable]");
          process.exit(1);
      }
      break;
    }

    case "import": {
      const importSub = args[1];
      switch (importSub) {
        case "calendar": {
          if (!args[2]) {
            console.error("  Usage: opcom import calendar <file.ics> [--project <id>]");
            process.exit(1);
          }
          let importProject: string | undefined;
          for (let i = 3; i < args.length; i++) {
            if (args[i] === "--project" && args[i + 1]) { importProject = args[++i]; }
          }
          return runImportCalendar(args[2], importProject);
        }
        case "paste": {
          let pasteProject: string | undefined;
          for (let i = 2; i < args.length; i++) {
            if (args[i] === "--project" && args[i + 1]) { pasteProject = args[++i]; }
          }
          return runImportPaste(pasteProject);
        }
        default:
          console.error("  Usage: opcom import <subcommand>");
          console.error("  Subcommands:");
          console.error("    calendar <file.ics>   Import events from an iCal file");
          console.error("    paste                 Import events from pasted text");
          process.exit(1);
      }
      break;
    }

    case "skills":
    case "skill": {
      const subcommand = args[1];
      switch (subcommand) {
        case "list":
        case "ls":
        case undefined:
          return runSkillsList();
        case "show":
          if (!args[2]) {
            console.error("  Usage: opcom skills show <skill-id>");
            process.exit(1);
          }
          return runSkillsShow(args[2]);
        case "create": {
          if (!args[2]) {
            console.error("  Usage: opcom skills create <skill-id> [--name <name>] [--description <desc>]");
            process.exit(1);
          }
          const createOpts: { name?: string; description?: string } = {};
          for (let i = 3; i < args.length; i++) {
            if (args[i] === "--name" && args[i + 1]) { createOpts.name = args[++i]; }
            else if (args[i] === "--description" && args[i + 1]) { createOpts.description = args[++i]; }
          }
          return runSkillsCreate(args[2], createOpts);
        }
        default:
          console.error("  Usage: opcom skills [list|show|create]");
          process.exit(1);
      }
      break;
    }

    case "state": {
      const sub = args[1];
      if (!sub) {
        console.error("  Usage: opcom state <decisions|metrics|artifacts>");
        console.error("  Options: --plan <id>  --step <id>  --metric <name>  --type <type>");
        process.exit(1);
      }
      const stateOpts: { planId?: string; stepId?: string; metric?: string; type?: string } = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--plan" && args[i + 1]) { stateOpts.planId = args[++i]; }
        else if (args[i] === "--step" && args[i + 1]) { stateOpts.stepId = args[++i]; }
        else if (args[i] === "--metric" && args[i + 1]) { stateOpts.metric = args[++i]; }
        else if (args[i] === "--type" && args[i + 1]) { stateOpts.type = args[++i]; }
      }
      return runState(sub, stateOpts);
    }

    case "teams":
    case "team": {
      const subcommand = args[1];
      switch (subcommand) {
        case "list":
        case "ls":
        case undefined:
          return runTeamList();
        case "show":
          if (!args[2]) {
            console.error("  Usage: opcom teams show <team-id>");
            process.exit(1);
          }
          return runTeamShow(args[2]);
        default:
          console.error("  Usage: opcom teams [list|show <id>]");
          process.exit(1);
      }
      break;
    }

    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;

    default:
      if (!command) {
        // If station daemon is running, default to TUI; otherwise show status
        const { Station } = await import("@opcom/core");
        const daemonStatus = await Station.isRunning();
        if (daemonStatus.running) {
          return runTui();
        }
        return runStatus();
      }
      console.error(`  Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
  opcom — developer workspace manager

  Commands:
    init                         Interactive workspace setup
    init <folder>                Initialize a project in a folder
    add <path>                   Add a project to the workspace
    scan [project]               Re-run detection for one or all projects
    status [--project <name>]    Show workspace dashboard (default)
    tui                          Interactive terminal dashboard
    work <project>[/<ticket>]    Start agent on a work item
    agent list                   Show running agent sessions
    agent stop <id>              Stop a running session
    agent prompt <id> <msg>      Send message to running agent
    briefing [--since DATE] [--project NAME]  Generate activity briefing
    triage                       Recommend next actions based on workspace state
    oracle <session-id>          Verify agent work against acceptance criteria
    ticket list [project]           List tickets (all projects or one)
    ticket create <project> <desc>  Create a new ticket via agent
    ticket show <project> <id>      Show ticket details
    changes <ticket-id>             Show file changes for a ticket
    diff <ticket-id>                Show unified diff for a ticket's changes
    analytics tools [--project X]    Tool usage frequency + success rates
    analytics sessions [--project X] Session durations and event counts
    analytics daily [--project X] [--days N] Daily activity summary
    plan list                    List execution plans
    plan create [opts]           Create plan from tickets
    plan show [plan-id]          Show plan DAG with tracks
    plan execute [plan-id]       Execute plan (start agents)
    plan pause [plan-id]         Pause active plan
    plan resume [plan-id]        Resume paused plan
    plan context <text> [id]     Add context to plan
    plan skip <ticket> [id]      Skip a step
    plan hygiene                 Run ticket health checks
    state decisions              Show strategic decisions with rationale
    state metrics                Show operational metrics per step/plan
    state artifacts              Show produced outputs (commits, merges)
    graph build [project]        Build context graph (all projects if none specified)
    graph stats [project]        Show graph node/edge statistics
    graph drift [project]        Show drift signals (uncovered specs, untested files, etc.)
    workspace [health]           Aggregate health across all projects
    workspace drift              Cross-project drift signals ranked by severity
    workspace patterns           Shared patterns detected across projects
    ci [project]                 Show CI/CD pipeline status
    ci <project> --watch         Watch pipeline status live
    infra [project]              Show infrastructure status (K8s)
    infra <project> pods         List pods
    infra <project> logs <pod>   Tail pod logs (--follow, --container/-c)
    infra <project> restart <dep> Rollout restart a deployment
    schedule list                List scheduled tasks
    schedule add <n> <c> <cmd>   Add a scheduled task (name, cron, command)
    schedule remove <id>         Remove a scheduled task
    serve [--port N]             Start station daemon (default: 4700)
    web                          Open web dashboard in browser
    settings [list]              Show all settings and their values
    settings get <key>           Get a single setting value
    settings set <key> <value>   Set a setting value
    settings reset [key]         Reset one or all settings to defaults
    integrations [list]          Show available/active integration modules
    integrations enable <id>     Enable an integration module
    integrations disable <id>    Disable an integration module
    skills [list]                List available capability skills
    skills show <id>             Show skill details
    skills create <id>           Create a new custom skill
    teams [list]                 List available team formations
    teams show <id>              Show team details
    scaffold <spec-file>         Generate tickets from spec section anchors
    scaffold --all               Scaffold all specs
    audit [--verbose]            Traceability audit (spec coverage, broken links)
    trace <file-path>            Reverse lookup: what covers this file?
    coverage [spec-file]         Spec-to-ticket coverage report
    uc [ls]                      List use cases with readiness %
    uc show <id>                 Show use case with requirement status
    uc gaps <id>                 Show unmet requirements for a use case
    templates [list]             Show available project templates
    templates show <id>          Show template details
    import calendar <file.ics>   Import events from an iCal file
    import paste                 Import events from pasted text
    dev <project> [service]      Start dev services for a project
    dev stop <project>           Stop all services for a project
    help                         Show this help

  Options for 'work':
    --backend claude-code|opencode    Agent backend (default: claude-code)
    --model <model>                   Model override
    --worktree                        Create git worktree for isolation
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
