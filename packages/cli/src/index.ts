#!/usr/bin/env node

import { runInit } from "./commands/init.js";
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
import { runCI } from "./commands/ci.js";
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

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case "init":
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

    case "plan": {
      const subcommand = args[1];
      switch (subcommand) {
        case "list":
        case "ls":
          return runPlanList();
        case "create": {
          const planOpts: { name?: string; scope?: string; projectIds?: string[] } = {};
          for (let i = 2; i < args.length; i++) {
            if (args[i] === "--name" && args[i + 1]) { planOpts.name = args[++i]; }
            else if (args[i] === "--scope" && args[i + 1]) { planOpts.scope = args[++i]; }
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

    case "ci": {
      const ciProject = args[1];
      const ciWatch = args.includes("--watch");
      return runCI(ciProject, { watch: ciWatch });
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
    ci [project]                 Show CI/CD pipeline status
    ci <project> --watch         Watch pipeline status live
    schedule list                List scheduled tasks
    schedule add <n> <c> <cmd>   Add a scheduled task (name, cron, command)
    schedule remove <id>         Remove a scheduled task
    serve [--port N]             Start station daemon (default: 4700)
    web                          Open web dashboard in browser
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
