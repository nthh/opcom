// TUI Application Controller
// Manages navigation, input, rendering, and data flow

import { spawn } from "node:child_process";
import type { AgentSession, WorkItem, ProjectStatusSnapshot, CloudService } from "@opcom/types";
import { ScreenBuffer, ANSI, bold, dim, color, padRight } from "./renderer.js";
import { getLayout, TerminalSize, type NavigationLevel } from "./layout.js";
import { TuiClient } from "./client.js";
import {
  renderDashboard,
  createDashboardState,
  clampSelection as clampDashboard,
  getFilteredWorkItems,
  getPanelItemCount as getDashboardItemCount,
  getPlanStepsInDisplayOrder,
  type DashboardState,
  type DashboardWorkItem,
} from "./views/dashboard.js";
import {
  renderProjectDetail,
  createProjectDetailState,
  clampSelection as clampProjectDetail,
  getTicketsList,
  getCloudServicesList,
  getPanelItemCount as getProjectItemCount,
  PANEL_COUNT as PROJECT_PANEL_COUNT,
  type ProjectDetailState,
} from "./views/project-detail.js";
import {
  renderCloudServiceDetail,
  createCloudServiceDetailState,
  scrollUp as cloudScrollUp,
  scrollDown as cloudScrollDown,
  scrollToTop as cloudScrollToTop,
  scrollToBottom as cloudScrollToBottom,
  type CloudServiceDetailState,
} from "./views/cloud-service-detail.js";
import {
  renderAgentFocus,
  createAgentFocusState,
  rebuildDisplayLines,
  scrollUp as agentScrollUp,
  scrollDown as agentScrollDown,
  scrollToTop as agentScrollToTop,
  scrollToBottom as agentScrollToBottom,
  type AgentFocusState,
} from "./views/agent-focus.js";
import {
  renderTicketFocus,
  createTicketFocusState,
  loadTicketContent,
  scrollUp as ticketScrollUp,
  scrollDown as ticketScrollDown,
  scrollToTop as ticketScrollToTop,
  scrollToBottom as ticketScrollToBottom,
  type TicketFocusState,
} from "./views/ticket-focus.js";
import {
  renderPlanStepFocus,
  createPlanStepFocusState,
  scrollUp as planStepScrollUp,
  scrollDown as planStepScrollDown,
  scrollToTop as planStepScrollToTop,
  scrollToBottom as planStepScrollToBottom,
  type PlanStepFocusState,
} from "./views/plan-step-focus.js";

type FocusTarget = { kind: "agent"; agent: AgentSession } | { kind: "ticket"; ticket: WorkItem };

export class TuiApp {
  private client: TuiClient;
  private termSize: TerminalSize;
  private buf: ScreenBuffer;
  private level: NavigationLevel = 1;
  private running = false;

  // View states
  private dashboardState: DashboardState;
  private projectDetailState: ProjectDetailState | null = null;
  private agentFocusState: AgentFocusState | null = null;
  private ticketFocusState: TicketFocusState | null = null;
  private planStepFocusState: PlanStepFocusState | null = null;
  private cloudServiceDetailState: CloudServiceDetailState | null = null;

  // Navigation stack for back navigation
  private navStack: Array<{
    level: NavigationLevel;
    focusTarget?: FocusTarget;
    projectId?: string;
  }> = [];

  // Focused project for L2/L3
  private focusedProjectId: string | null = null;

  // Debounce render
  private renderScheduled = false;
  private helpVisible = false;

  // Search mode
  private searchMode = false;
  private searchQuery = "";

  // Create/chat ticket mode
  private createTicketMode = false;
  private createTicketText = "";
  private createTicketProjectId: string | null = null;
  private chatTicketWorkItemId: string | null = null; // non-null = chatting about existing ticket


  constructor() {
    this.client = new TuiClient();
    this.termSize = new TerminalSize();
    this.buf = new ScreenBuffer(this.termSize.cols, this.termSize.rows);
    this.dashboardState = createDashboardState();
  }

  async start(): Promise<void> {
    this.running = true;

    // Enter alternate screen, hide cursor
    process.stdout.write(ANSI.enterAltScreen + ANSI.hideCursor + ANSI.clearScreen);

    // Set raw mode for keyboard input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    // Connect to daemon or load directly
    await this.client.connect();

    // Sync initial data
    this.syncData();

    // Listen for data changes
    this.client.onEvent(() => {
      this.syncData();
      this.scheduleRender();
    });

    // Listen for resize
    this.termSize.onResize((cols, rows) => {
      this.buf.resize(cols, rows);
      this.buf.forceRedraw();
      this.scheduleRender();
    });

    // Listen for keyboard input
    process.stdin.on("data", (data: string) => {
      this.handleInput(data);
    });

    // Initial render
    this.render();

    // Keep alive until quit
    await new Promise<void>((resolve) => {
      this._resolveQuit = resolve;
    });
  }

  private _resolveQuit: (() => void) | null = null;

  private quit(): void {
    this.running = false;

    // Restore terminal
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.stdout.write(ANSI.showCursor + ANSI.leaveAltScreen);

    this.client.destroy();

    if (this._resolveQuit) {
      this._resolveQuit();
    }
  }

  // --- Data sync ---

  private syncData(): void {
    this.dashboardState.projects = this.client.projects;
    this.dashboardState.agents = this.client.agents;

    // Aggregate work items from all projects with project association
    const allWorkItems: DashboardWorkItem[] = [];
    for (const [projectId, tickets] of this.client.projectTickets) {
      const project = this.client.projects.find((p) => p.id === projectId);
      const projectName = project?.name ?? projectId;
      for (const item of tickets) {
        allWorkItems.push({ item, projectId, projectName });
      }
    }
    this.dashboardState.workItems = allWorkItems;

    // Sync plan state
    if (this.client.activePlan) {
      this.dashboardState.planPanel = { plan: this.client.activePlan };
    } else {
      this.dashboardState.planPanel = null;
    }

    clampDashboard(this.dashboardState);

    // Update project detail if active
    if (this.projectDetailState && this.focusedProjectId) {
      const project = this.client.projects.find((p) => p.id === this.focusedProjectId);
      if (project) {
        this.projectDetailState.project = project;
        this.projectDetailState.agents = this.client.agents;
        const tickets = this.client.projectTickets.get(this.focusedProjectId) ?? [];
        this.projectDetailState.tickets = tickets;
        const cloudServices = this.client.projectCloudServices.get(this.focusedProjectId) ?? [];
        this.projectDetailState.cloudServices = cloudServices;
        clampProjectDetail(this.projectDetailState);
      }
    }

    // Update cloud service detail if active
    if (this.cloudServiceDetailState && this.focusedProjectId) {
      const services = this.client.projectCloudServices.get(this.focusedProjectId) ?? [];
      const updated = services.find((s) => s.id === this.cloudServiceDetailState!.service.id);
      if (updated) {
        this.cloudServiceDetailState.service = updated;
      }
    }

    // Update agent focus if active
    if (this.agentFocusState) {
      const agent = this.client.agents.find((a) => a.id === this.agentFocusState!.agent.id);
      if (agent) {
        this.agentFocusState.agent = agent;
      }
      const events = this.client.agentEvents.get(this.agentFocusState.agent.id) ?? [];
      // Compare against tracked count, not array.length — the state holds the
      // same array reference, so .length would always match after first assign
      if (events.length !== this.agentFocusState.renderedEventCount) {
        this.agentFocusState.events = events;
        this.agentFocusState.renderedEventCount = events.length;
        rebuildDisplayLines(this.agentFocusState, this.agentFocusState.wrapWidth || 80);
      }
    }
  }

  // --- Rendering ---

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    // Use setImmediate for batched rendering
    setImmediate(() => {
      this.renderScheduled = false;
      if (this.running) {
        this.render();
      }
    });
  }

  private render(): void {
    const { cols, rows } = this.termSize;
    const layout = getLayout(this.level, cols, rows);

    this.buf.clear();

    if (this.helpVisible) {
      this.renderHelp();
    } else {
      switch (this.level) {
        case 1:
          renderDashboard(this.buf, layout.panels, this.dashboardState);
          break;
        case 2:
          if (this.projectDetailState) {
            renderProjectDetail(this.buf, layout.panels, this.projectDetailState);
          }
          break;
        case 3:
          if (this.agentFocusState) {
            renderAgentFocus(this.buf, layout.panels[0], this.agentFocusState);
          } else if (this.ticketFocusState) {
            renderTicketFocus(this.buf, layout.panels[0], this.ticketFocusState);
          } else if (this.planStepFocusState) {
            renderPlanStepFocus(this.buf, layout.panels[0], this.planStepFocusState);
          } else if (this.cloudServiceDetailState) {
            renderCloudServiceDetail(this.buf, layout.panels[0], this.cloudServiceDetailState);
          }
          break;
      }

      // Status bar
      this.renderStatusBar(layout.statusBarY, cols);
    }

    this.buf.flush();
  }

  private renderStatusBar(y: number, cols: number): void {
    const modeStr = this.client.daemonMode
      ? color(ANSI.green, " LIVE")
      : color(ANSI.yellow, " OFFLINE");

    const levelNames = ["", "Dashboard", "Project", "Focus"];
    const levelStr = dim(levelNames[this.level] ?? "");

    let keysStr = "";
    switch (this.level) {
      case 1:
        if (this.createTicketMode) {
          keysStr = dim(this.ticketPromptLabel());
        } else if (this.searchMode) {
          keysStr = dim(`Search: ${this.searchQuery}_  (Enter confirm, Esc cancel)`);
        } else if (this.dashboardState.planPanel) {
          const ps = this.dashboardState.planPanel.plan.status;
          const spaceHint = ps === "planning" ? "Space:go" : ps === "executing" ? "Space:pause" : ps === "paused" ? "Space:resume" : "";
          keysStr = dim(`j/k:nav  Tab:panel  ${spaceHint}  P:new plan  Enter:drill  ?:help  q:quit`);
        } else {
          keysStr = dim("j/k:nav  Tab:panel  Enter:drill  w:work  f/F:project  /:search  1-4:priority  ?:help  q:quit");
        }
        break;
      case 2:
        if (this.createTicketMode) {
          keysStr = dim(this.ticketPromptLabel());
        } else {
          keysStr = dim("j/k:nav  Tab:panel  Enter:drill  w:work  v:cloud  M:migrate  Esc:back  ?:help");
        }
        break;
      case 3:
        if (this.createTicketMode) {
          keysStr = dim(this.ticketPromptLabel());
        }
        // Otherwise keys shown in the view footer
        break;
    }

    const statusLine = ` ${modeStr} ${dim("|")} ${levelStr} ${dim("|")} ${keysStr}`;
    this.buf.writeLine(y, 0, ANSI.reverse + padRight(statusLine, cols) + ANSI.reset, cols);
  }

  private renderHelp(): void {
    const { cols, rows } = this.termSize;
    const helpLines = [
      bold("opcom TUI — Keyboard Shortcuts"),
      "",
      bold("Global"),
      "  Esc        Go up one level / close",
      "  q          Quit (or go up)",
      "  ?          Toggle this help",
      "  r          Refresh data",
      "",
      bold("Level 1: Dashboard"),
      "  j/k        Navigate up/down",
      "  Tab        Switch panel focus",
      "  Enter      Drill down to project/agent",
      "  w          Start agent on selected item",
      "  c          Chat: create or discuss ticket",
      "  s          Scan / re-detect project",
      "  S          Stop selected agent",
      "  /          Search work items",
      "  f          Cycle project filter",
      "  F          Clear project filter",
      "  1-4        Filter by priority (0 to clear)",
      "",
      bold("Level 2: Project Detail"),
      "  j/k        Navigate up/down",
      "  Tab        Switch panel focus",
      "  Enter      Drill down to ticket/agent/cloud",
      "  w          Start agent on ticket",
      "  v          Focus cloud services panel",
      "  M          Run pending migrations",
      "  c          Chat: create or discuss ticket",
      "  d          Start dev services",
      "  g          Show git log",
      "",
      bold("Level 3: Agent Focus"),
      "  j/k        Scroll up/down",
      "  G          Jump to bottom",
      "  g          Jump to top",
      "  p          Open prompt input",
      "  S          Stop agent",
      "  n/N        Cycle to next/prev agent",
      "  m          Merge agent changes",
      "",
      bold("Level 3: Ticket Focus"),
      "  j/k        Scroll up/down",
      "  w          Start agent on this ticket",
      "  c          Chat about this ticket",
      "  e          Open in $EDITOR",
      "",
      bold("Level 3: Cloud Service Detail"),
      "  j/k        Scroll up/down",
      "  M          Run pending migrations",
      "  D          Trigger deployment",
      "  o          Open provider console",
      "",
      bold("Level 3: Plan Step Focus"),
      "  j/k        Scroll up/down",
      "  w          Start agent (if step ready)",
      "  a          Jump to assigned agent",
      "  t          Jump to ticket detail",
      "",
      dim("Press ? or Esc to close help"),
    ];

    const boxWidth = Math.min(60, cols - 4);
    const boxHeight = Math.min(helpLines.length + 2, rows - 2);
    const startX = Math.floor((cols - boxWidth) / 2);
    const startY = Math.floor((rows - boxHeight) / 2);

    // Draw background box
    for (let r = startY; r < startY + boxHeight; r++) {
      this.buf.writeLine(r, startX, " ".repeat(boxWidth), boxWidth);
    }

    // Draw content
    for (let i = 0; i < boxHeight - 2 && i < helpLines.length; i++) {
      this.buf.writeLine(startY + 1 + i, startX + 2, helpLines[i], boxWidth - 4);
    }
  }

  // --- Input handling ---

  private handleInput(data: string): void {
    // Handle prompt mode input first
    if (this.level === 3 && this.agentFocusState?.promptMode) {
      this.handlePromptInput(data);
      this.scheduleRender();
      return;
    }

    // Handle search mode input
    if (this.searchMode) {
      this.handleSearchInput(data);
      this.scheduleRender();
      return;
    }

    // Handle create-ticket mode input
    if (this.createTicketMode) {
      this.handleCreateTicketInput(data);
      this.scheduleRender();
      return;
    }


    // Handle help overlay
    if (this.helpVisible) {
      if (data === "?" || data === "\x1b" || data === "q") {
        this.helpVisible = false;
        this.scheduleRender();
      }
      return;
    }

    // Global keys
    switch (data) {
      case "?":
        this.helpVisible = true;
        this.scheduleRender();
        return;

      case "r":
        this.client.refreshDirect().then(() => {
          this.syncData();
          this.scheduleRender();
        }).catch(() => {});
        return;
    }

    // Level-specific input
    switch (this.level) {
      case 1:
        this.handleDashboardInput(data);
        break;
      case 2:
        this.handleProjectDetailInput(data);
        break;
      case 3:
        if (this.agentFocusState) {
          this.handleAgentFocusInput(data);
        } else if (this.ticketFocusState) {
          this.handleTicketFocusInput(data);
        } else if (this.planStepFocusState) {
          this.handlePlanStepFocusInput(data);
        } else if (this.cloudServiceDetailState) {
          this.handleCloudServiceDetailInput(data);
        }
        break;
    }

    this.scheduleRender();
  }

  // --- L1: Dashboard Input ---

  private handleDashboardInput(data: string): void {
    const state = this.dashboardState;
    const panel = state.focusedPanel;
    const itemCount = getDashboardItemCount(state, panel);

    switch (data) {
      case "q":
      case "\x03": // Ctrl+C
        this.quit();
        return;

      case "\x1b": // Escape
        // No-op at top level
        return;

      case "\t": // Tab
        state.focusedPanel = (state.focusedPanel + 1) % 3;
        return;

      case "\x1b[Z": // Shift+Tab
        state.focusedPanel = (state.focusedPanel + 2) % 3;
        return;

      case "j":
      case "\x1b[B": // Down arrow
        if (itemCount > 0) {
          state.selectedIndex[panel] = Math.min(state.selectedIndex[panel] + 1, itemCount - 1);
          this.adjustScroll(state.selectedIndex[panel], state.scrollOffset, panel, this.getPanelHeight(panel));
        }
        return;

      case "k":
      case "\x1b[A": // Up arrow
        if (itemCount > 0) {
          state.selectedIndex[panel] = Math.max(state.selectedIndex[panel] - 1, 0);
          this.adjustScroll(state.selectedIndex[panel], state.scrollOffset, panel, this.getPanelHeight(panel));
        }
        return;

      case "\r": // Enter
      case "\n":
        this.dashboardDrillDown();
        return;

      case "w":
        this.startAgentFromDashboard();
        return;

      case "s":
        this.scanFromDashboard();
        return;

      case "S":
        this.stopAgentFromDashboard();
        return;

      case "c":
        this.enterCreateTicketMode();
        return;

      case "P": { // Create plan for selected project
        const project = state.projects[state.selectedIndex[0]];
        if (project) {
          this.client.createPlan(project.id).then(() => {
            this.syncData();
            this.scheduleRender();
          }).catch(() => {});
        }
        return;
      }

      case " ": // Space — approve/pause/resume plan
        if (state.planPanel) {
          const plan = state.planPanel.plan;
          if (plan.status === "planning") {
            this.client.executePlan(plan.id).catch(() => {});
          } else if (plan.status === "executing") {
            this.client.send({ type: "pause_plan", planId: plan.id } as import("@opcom/types").ClientCommand);
          } else if (plan.status === "paused") {
            this.client.send({ type: "resume_plan", planId: plan.id } as import("@opcom/types").ClientCommand);
          }
        }
        return;

      case "/":
        this.searchMode = true;
        this.searchQuery = "";
        state.focusedPanel = 1; // Focus work queue for search
        return;

      case "0":
        state.priorityFilter = null;
        clampDashboard(state);
        return;

      case "1":
        state.priorityFilter = state.priorityFilter === 1 ? null : 1;
        clampDashboard(state);
        return;

      case "2":
        state.priorityFilter = state.priorityFilter === 2 ? null : 2;
        clampDashboard(state);
        return;

      case "3":
        state.priorityFilter = state.priorityFilter === 3 ? null : 3;
        clampDashboard(state);
        return;

      case "4":
        state.priorityFilter = state.priorityFilter === 4 ? null : 4;
        clampDashboard(state);
        return;

      case "f": {
        // Cycle project filter: null → project1 → project2 → ... → null
        const projectIds = state.projects.map((p) => p.id);
        if (projectIds.length === 0) return;
        if (state.projectFilter === null) {
          state.projectFilter = projectIds[0];
        } else {
          const idx = projectIds.indexOf(state.projectFilter);
          if (idx === -1 || idx === projectIds.length - 1) {
            state.projectFilter = null;
          } else {
            state.projectFilter = projectIds[idx + 1];
          }
        }
        state.selectedIndex[1] = 0;
        state.scrollOffset[1] = 0;
        clampDashboard(state);
        return;
      }

      case "F":
        state.projectFilter = null;
        state.selectedIndex[1] = 0;
        state.scrollOffset[1] = 0;
        clampDashboard(state);
        return;
    }
  }

  private dashboardDrillDown(): void {
    const state = this.dashboardState;
    const panel = state.focusedPanel;
    const selected = state.selectedIndex[panel];

    if (panel === 0) {
      // Drill into project
      const project = state.projects[selected];
      if (project) {
        this.navigateToProject(project);
      }
    } else if (panel === 1) {
      if (state.planPanel) {
        // Drill into plan step — use display order (grouped by track) to match rendering
        const orderedSteps = getPlanStepsInDisplayOrder(state.planPanel.plan);
        const step = orderedSteps[selected];
        if (step) {
          this.navigateToPlanStep(step, state.planPanel.plan);
        }
      } else {
        // Drill into work item
        const items = getFilteredWorkItems(state);
        const dw = items[selected];
        if (dw) {
          this.navigateToTicket(dw.item, dw.projectId);
        }
      }
    } else if (panel === 2) {
      // Drill into agent
      const agent = state.agents[selected];
      if (agent) {
        this.navigateToAgent(agent);
      }
    }
  }

  private startAgentFromDashboard(): void {
    const state = this.dashboardState;
    const panel = state.focusedPanel;
    const selected = state.selectedIndex[panel];

    if (panel === 0) {
      // Start agent on project (no ticket)
      const project = state.projects[selected];
      if (project) {
        this.client.send({ type: "start_agent", projectId: project.id });
      }
    } else if (panel === 1) {
      // Start agent on work item — projectId is carried by the wrapper
      const items = getFilteredWorkItems(state);
      const dw = items[selected];
      if (dw) {
        this.client.send({ type: "start_agent", projectId: dw.projectId, workItemId: dw.item.id });
      }
    }
  }

  private scanFromDashboard(): void {
    const state = this.dashboardState;
    if (state.focusedPanel === 0) {
      const project = state.projects[state.selectedIndex[0]];
      if (project) {
        this.client.send({ type: "refresh_status" });
      }
    }
  }

  private stopAgentFromDashboard(): void {
    const state = this.dashboardState;
    if (state.focusedPanel === 2) {
      const agent = state.agents[state.selectedIndex[2]];
      if (agent && agent.state !== "stopped") {
        this.client.send({ type: "stop_agent", agentId: agent.id });
      }
    }
  }

  // --- L2: Project Detail Input ---

  private handleProjectDetailInput(data: string): void {
    if (!this.projectDetailState) return;
    const state = this.projectDetailState;
    const panel = state.focusedPanel;
    const itemCount = getProjectItemCount(state, panel);

    switch (data) {
      case "q":
      case "\x1b": // Escape
        this.navigateBack();
        return;

      case "\t":
        state.focusedPanel = (state.focusedPanel + 1) % PROJECT_PANEL_COUNT;
        return;

      case "\x1b[Z": // Shift+Tab
        state.focusedPanel = (state.focusedPanel + PROJECT_PANEL_COUNT - 1) % PROJECT_PANEL_COUNT;
        return;

      case "j":
      case "\x1b[B":
        if (itemCount > 0) {
          state.selectedIndex[panel] = Math.min(state.selectedIndex[panel] + 1, itemCount - 1);
          this.adjustScroll(state.selectedIndex[panel], state.scrollOffset, panel, this.getPanelHeight(panel));
        }
        return;

      case "k":
      case "\x1b[A":
        if (itemCount > 0) {
          state.selectedIndex[panel] = Math.max(state.selectedIndex[panel] - 1, 0);
          this.adjustScroll(state.selectedIndex[panel], state.scrollOffset, panel, this.getPanelHeight(panel));
        }
        return;

      case "\r":
      case "\n":
        this.projectDetailDrillDown();
        return;

      case "w":
        this.startAgentFromProjectDetail();
        return;

      case "c":
        this.enterCreateTicketMode();
        return;

      case "v": // Focus cloud panel
        state.focusedPanel = 3;
        return;

      case "M": // Run migrations on selected database
        this.triggerMigration();
        return;

      case "P": // Create plan for this project
        if (this.focusedProjectId) {
          this.client.createPlan(this.focusedProjectId).then(() => {
            this.syncData();
            this.scheduleRender();
          }).catch(() => {});
        }
        return;

      case " ": // Space — approve/pause/resume plan
        if (this.dashboardState.planPanel) {
          const plan = this.dashboardState.planPanel.plan;
          if (plan.status === "planning") {
            this.client.executePlan(plan.id).catch(() => {});
          } else if (plan.status === "executing") {
            this.client.send({ type: "pause_plan", planId: plan.id } as import("@opcom/types").ClientCommand);
          } else if (plan.status === "paused") {
            this.client.send({ type: "resume_plan", planId: plan.id } as import("@opcom/types").ClientCommand);
          }
        }
        return;

      case "d":
        // Dev services - would need implementation
        return;

      case "g":
        // Git log - would need implementation
        return;
    }
  }

  private projectDetailDrillDown(): void {
    if (!this.projectDetailState) return;
    const state = this.projectDetailState;
    const panel = state.focusedPanel;
    const selected = state.selectedIndex[panel];

    if (panel === 0) {
      // Drill into ticket
      const tickets = getTicketsList(state);
      const ticket = tickets[selected];
      if (ticket) {
        this.navigateToTicket(ticket);
      }
    } else if (panel === 1) {
      // Drill into agent
      const projectAgents = state.agents.filter((a) => a.projectId === state.project.id);
      const agent = projectAgents[selected];
      if (agent) {
        this.navigateToAgent(agent);
      }
    } else if (panel === 3) {
      // Drill into cloud service
      const services = getCloudServicesList(state);
      const service = services[selected];
      if (service) {
        this.navigateToCloudService(service);
      }
    }
  }

  private startAgentFromProjectDetail(): void {
    if (!this.projectDetailState) return;
    const state = this.projectDetailState;

    if (state.focusedPanel === 0) {
      // Start agent on selected ticket
      const tickets = getTicketsList(state);
      const ticket = tickets[state.selectedIndex[0]];
      if (ticket) {
        this.client.send({
          type: "start_agent",
          projectId: state.project.id,
          workItemId: ticket.id,
        });
      }
    } else {
      // Start agent on project (no ticket)
      this.client.send({ type: "start_agent", projectId: state.project.id });
    }
  }

  // --- L3: Agent Focus Input ---

  private handleAgentFocusInput(data: string): void {
    if (!this.agentFocusState) return;
    const state = this.agentFocusState;
    const layout = getLayout(3, this.termSize.cols, this.termSize.rows);
    const viewHeight = layout.panels[0].height - 4; // header + footer

    switch (data) {
      case "q":
      case "\x1b":
        this.navigateBack();
        return;

      case "j":
      case "\x1b[B":
        agentScrollDown(state, 1, viewHeight);
        return;

      case "k":
      case "\x1b[A":
        agentScrollUp(state, 1);
        return;

      case "G":
        agentScrollToBottom(state);
        return;

      case "g":
        agentScrollToTop(state);
        return;

      case "p":
        state.promptMode = true;
        state.promptText = "";
        return;

      case "S":
        this.client.send({ type: "stop_agent", agentId: state.agent.id });
        return;

      case "n":
        this.cycleAgent(1);
        return;

      case "N":
        this.cycleAgent(-1);
        return;

      case "m":
        // Merge - placeholder for future implementation
        return;
    }
  }

  private handlePromptInput(data: string): void {
    if (!this.agentFocusState) return;
    const state = this.agentFocusState;

    if (data === "\x1b") {
      // Escape - cancel prompt
      state.promptMode = false;
      state.promptText = "";
      return;
    }

    if (data === "\r" || data === "\n") {
      // Enter - send prompt
      if (state.promptText.trim()) {
        // If agent is stopped, this will resume via --resume and create a new session
        if (state.agent.state === "stopped" && state.agent.backendSessionId) {
          const unsubscribe = this.client.onEvent((event) => {
            if (event.type === "agent_started") {
              unsubscribe();
              this.navigateToAgent(event.session);
              this.scheduleRender();
            }
          });
        }
        this.client.send({
          type: "prompt",
          agentId: state.agent.id,
          text: state.promptText,
        });
      }
      state.promptMode = false;
      state.promptText = "";
      return;
    }

    if (data === "\x7f" || data === "\b") {
      // Backspace
      state.promptText = state.promptText.slice(0, -1);
      return;
    }

    // Regular character input
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      state.promptText += data;
    }
  }

  private cycleAgent(direction: number): void {
    const agents = this.client.agents.filter((a) => a.state !== "stopped");
    if (agents.length <= 1) return;

    const currentId = this.agentFocusState?.agent.id;
    const currentIdx = agents.findIndex((a) => a.id === currentId);
    const nextIdx = (currentIdx + direction + agents.length) % agents.length;
    const nextAgent = agents[nextIdx];

    if (nextAgent) {
      const events = this.client.agentEvents.get(nextAgent.id) ?? [];
      this.agentFocusState = createAgentFocusState(nextAgent, events);
    }
  }

  // --- L3: Ticket Focus Input ---

  private handleTicketFocusInput(data: string): void {
    if (!this.ticketFocusState) return;
    const state = this.ticketFocusState;
    const layout = getLayout(3, this.termSize.cols, this.termSize.rows);
    const viewHeight = layout.panels[0].height - 2;

    switch (data) {
      case "q":
      case "\x1b":
        this.navigateBack();
        return;

      case "j":
      case "\x1b[B":
        ticketScrollDown(state, 1, viewHeight);
        return;

      case "k":
      case "\x1b[A":
        ticketScrollUp(state, 1);
        return;

      case "G":
        ticketScrollToBottom(state, viewHeight);
        return;

      case "g":
        ticketScrollToTop(state);
        return;

      case "w":
        this.startAgentFromTicket();
        return;

      case "c":
        this.enterCreateTicketMode();
        return;

      case "e":
        this.openTicketInEditor();
        return;
    }
  }

  private startAgentFromTicket(): void {
    if (!this.ticketFocusState) return;
    const ticket = this.ticketFocusState.ticket;

    // Find the project for this ticket
    for (const [projectId, tickets] of this.client.projectTickets) {
      if (tickets.some((t) => t.id === ticket.id)) {
        this.client.send({
          type: "start_agent",
          projectId,
          workItemId: ticket.id,
        });
        break;
      }
    }
  }

  private openTicketInEditor(): void {
    if (!this.ticketFocusState) return;
    const editor = process.env.EDITOR || "vi";
    const filePath = this.ticketFocusState.ticket.filePath;

    // Temporarily leave alternate screen and raw mode
    process.stdout.write(ANSI.showCursor + ANSI.leaveAltScreen);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();

    const child = spawn(editor, [filePath], {
      stdio: "inherit",
      env: process.env,
    });

    child.on("close", () => {
      // Re-enter TUI mode
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdout.write(ANSI.enterAltScreen + ANSI.hideCursor);
      this.buf.forceRedraw();

      // Reload ticket content
      if (this.ticketFocusState) {
        loadTicketContent(this.ticketFocusState).then(() => {
          this.scheduleRender();
        }).catch(() => {});
      }

      this.scheduleRender();
    });
  }

  // --- Search mode ---

  private handleSearchInput(data: string): void {
    if (data === "\x1b") {
      // Escape - cancel search
      this.searchMode = false;
      this.searchQuery = "";
      this.dashboardState.searchQuery = "";
      clampDashboard(this.dashboardState);
      return;
    }

    if (data === "\r" || data === "\n") {
      // Enter - apply search
      this.searchMode = false;
      this.dashboardState.searchQuery = this.searchQuery;
      clampDashboard(this.dashboardState);
      return;
    }

    if (data === "\x7f" || data === "\b") {
      // Backspace
      this.searchQuery = this.searchQuery.slice(0, -1);
      this.dashboardState.searchQuery = this.searchQuery;
      clampDashboard(this.dashboardState);
      return;
    }

    // Regular character
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.searchQuery += data;
      this.dashboardState.searchQuery = this.searchQuery;
      clampDashboard(this.dashboardState);
    }
  }

  private ticketPromptLabel(): string {
    const projName = this.client.projects.find((p) => p.id === this.createTicketProjectId)?.name ?? "";
    if (this.chatTicketWorkItemId) {
      return `Chat [${projName}/${this.chatTicketWorkItemId}]: ${this.createTicketText}_  (Enter submit, Esc cancel)`;
    }
    return `Create ticket [${projName}]: ${this.createTicketText}_  (Enter submit, Esc cancel)`;
  }

  // --- Create/chat ticket mode ---

  private enterCreateTicketMode(): void {
    let projectId: string | null = null;
    let workItemId: string | null = null;

    if (this.level === 3 && this.ticketFocusState) {
      // L3 ticket focus — chat about the focused ticket
      const ticket = this.ticketFocusState.ticket;
      for (const [pid, tickets] of this.client.projectTickets) {
        if (tickets.some((t) => t.id === ticket.id)) {
          projectId = pid;
          workItemId = ticket.id;
          break;
        }
      }
    } else if (this.level === 2 && this.focusedProjectId && this.projectDetailState) {
      projectId = this.focusedProjectId;
      // If tickets panel is focused and a ticket is selected, chat about it
      if (this.projectDetailState.focusedPanel === 0) {
        const tickets = getTicketsList(this.projectDetailState);
        const ticket = tickets[this.projectDetailState.selectedIndex[0]];
        if (ticket) {
          workItemId = ticket.id;
        }
      }
    } else if (this.level === 1) {
      const state = this.dashboardState;
      if (state.focusedPanel === 1) {
        // Work items panel — chat about selected work item
        const items = getFilteredWorkItems(state);
        const dw = items[state.selectedIndex[1]];
        if (dw) {
          workItemId = dw.item.id;
          projectId = dw.projectId;
        }
      } else {
        // Projects or agents panel — create new ticket
        const project = state.projects[state.selectedIndex[0]];
        if (project) {
          projectId = project.id;
        }
      }
    }

    if (!projectId) return;

    this.createTicketMode = true;
    this.createTicketText = "";
    this.createTicketProjectId = projectId;
    this.chatTicketWorkItemId = workItemId;
  }

  private handleCreateTicketInput(data: string): void {
    if (data === "\x1b") {
      // Escape - cancel
      this.createTicketMode = false;
      this.createTicketText = "";
      this.createTicketProjectId = null;
      this.chatTicketWorkItemId = null;
      return;
    }

    if (data === "\r" || data === "\n") {
      // Enter - submit
      if (this.createTicketText.trim() && this.createTicketProjectId) {
        if (this.chatTicketWorkItemId) {
          this.submitChatTicket(this.createTicketProjectId, this.chatTicketWorkItemId, this.createTicketText.trim());
        } else {
          this.submitCreateTicket(this.createTicketProjectId, this.createTicketText.trim());
        }
      }
      this.createTicketMode = false;
      this.createTicketText = "";
      this.createTicketProjectId = null;
      this.chatTicketWorkItemId = null;
      return;
    }

    if (data === "\x7f" || data === "\b") {
      // Backspace
      this.createTicketText = this.createTicketText.slice(0, -1);
      return;
    }

    // Regular character
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.createTicketText += data;
    }
  }

  private submitCreateTicket(projectId: string, description: string): void {
    this.client.send({ type: "create_ticket", projectId, description });

    // Listen for the agent_started event to auto-navigate to agent focus
    const unsubscribe = this.client.onEvent((event) => {
      if (event.type === "agent_started") {
        unsubscribe();
        this.navigateToAgent(event.session);
        this.scheduleRender();
      }
    });
  }

  private submitChatTicket(projectId: string, workItemId: string, message: string): void {
    this.client.send({ type: "chat_ticket", projectId, workItemId, message });

    const unsubscribe = this.client.onEvent((event) => {
      if (event.type === "agent_started") {
        unsubscribe();
        this.navigateToAgent(event.session);
        this.scheduleRender();
      }
    });
  }

  // --- L3: Plan Step Focus Input ---

  private handlePlanStepFocusInput(data: string): void {
    if (!this.planStepFocusState) return;
    const state = this.planStepFocusState;
    const layout = getLayout(3, this.termSize.cols, this.termSize.rows);
    const viewHeight = layout.panels[0].height - 2;

    switch (data) {
      case "q":
      case "\x1b":
        this.navigateBack();
        return;

      case "j":
      case "\x1b[B":
        planStepScrollDown(state, 1, viewHeight);
        return;

      case "k":
      case "\x1b[A":
        planStepScrollUp(state, 1);
        return;

      case "G":
        planStepScrollToBottom(state, viewHeight);
        return;

      case "g":
        planStepScrollToTop(state);
        return;

      case "w":
        // Start agent on this step (only if ready)
        if (state.step.status === "ready") {
          this.client.send({
            type: "start_agent",
            projectId: state.step.projectId,
            workItemId: state.step.ticketId,
          });
        }
        return;

      case "a":
        // Jump to agent focus if agent assigned
        if (state.agent) {
          this.navigateToAgent(state.agent);
        }
        return;

      case "t":
        // Jump to ticket focus
        if (state.ticket) {
          this.navigateToTicket(state.ticket, state.step.projectId);
        }
        return;
    }
  }

  // --- Navigation ---

  private navigateToProject(project: ProjectStatusSnapshot): void {
    this.navStack.push({
      level: this.level,
      projectId: this.focusedProjectId ?? undefined,
    });

    this.focusedProjectId = project.id;
    this.level = 2;
    this.projectDetailState = createProjectDetailState(project);
    this.projectDetailState.agents = this.client.agents;

    // Load project config and tickets async
    this.client.getProjectConfig(project.id).then((config) => {
      if (this.projectDetailState && config) {
        this.projectDetailState.projectConfig = config;
        this.scheduleRender();
      }
    }).catch(() => {});

    this.client.getTickets(project.id).then((tickets) => {
      if (this.projectDetailState) {
        this.projectDetailState.tickets = tickets;
        clampProjectDetail(this.projectDetailState);
        this.scheduleRender();
      }
    }).catch(() => {});

    // Load cloud service statuses
    this.client.getCloudServices(project.id).then((services) => {
      if (this.projectDetailState) {
        this.projectDetailState.cloudServices = services;
        clampProjectDetail(this.projectDetailState);
        this.scheduleRender();
      }
    }).catch(() => {});
  }

  private navigateToAgent(agent: AgentSession): void {
    this.navStack.push({
      level: this.level,
      projectId: this.focusedProjectId ?? undefined,
    });

    this.level = 3;
    let events = this.client.agentEvents.get(agent.id) ?? [];

    // If no in-memory events, try loading from DB
    if (events.length === 0) {
      const historical = this.client.loadHistoricalEvents(agent.id);
      if (historical.length > 0) {
        events = historical;
        this.client.agentEvents.set(agent.id, events);
      }
    }

    this.agentFocusState = createAgentFocusState(agent, events);
    this.ticketFocusState = null;
    this.planStepFocusState = null;
    this.cloudServiceDetailState = null;
  }

  private navigateToTicket(ticket: WorkItem, projectId?: string): void {
    this.navStack.push({
      level: this.level,
      projectId: this.focusedProjectId ?? undefined,
    });

    this.level = 3;

    // Use provided projectId or fall back to reverse-lookup
    let resolvedProjectId = projectId;
    if (!resolvedProjectId) {
      for (const [pid, tickets] of this.client.projectTickets) {
        if (tickets.some((t) => t.id === ticket.id)) {
          resolvedProjectId = pid;
          break;
        }
      }
    }
    const projectConfig = resolvedProjectId
      ? this.client.projectConfigs.get(resolvedProjectId) ?? null
      : null;

    this.ticketFocusState = createTicketFocusState(ticket, projectConfig);
    this.agentFocusState = null;
    this.planStepFocusState = null;
    this.cloudServiceDetailState = null;

    // Load ticket content async
    loadTicketContent(this.ticketFocusState).then(() => {
      this.scheduleRender();
    }).catch(() => {});
  }

  private navigateToPlanStep(step: import("@opcom/types").PlanStep, plan: import("@opcom/types").Plan): void {
    this.navStack.push({
      level: this.level,
      projectId: this.focusedProjectId ?? undefined,
    });

    this.level = 3;

    // Collect all tickets across projects for blocker resolution
    const allTickets: WorkItem[] = [];
    for (const [, tickets] of this.client.projectTickets) {
      allTickets.push(...tickets);
    }

    const ticket = allTickets.find((t) => t.id === step.ticketId) ?? null;
    const agent = step.agentSessionId
      ? this.client.agents.find((a) => a.id === step.agentSessionId) ?? null
      : null;

    this.planStepFocusState = createPlanStepFocusState(
      step,
      plan,
      ticket,
      agent,
      allTickets,
      this.client.agents,
    );
    this.agentFocusState = null;
    this.ticketFocusState = null;
    this.cloudServiceDetailState = null;
  }

  // --- L3: Cloud Service Detail Input ---

  private handleCloudServiceDetailInput(data: string): void {
    if (!this.cloudServiceDetailState) return;
    const state = this.cloudServiceDetailState;
    const layout = getLayout(3, this.termSize.cols, this.termSize.rows);
    const viewHeight = layout.panels[0].height - 4;

    switch (data) {
      case "q":
      case "\x1b":
        this.navigateBack();
        return;

      case "j":
      case "\x1b[B":
        cloudScrollDown(state, 1, viewHeight);
        return;

      case "k":
      case "\x1b[A":
        cloudScrollUp(state, 1);
        return;

      case "G":
        cloudScrollToBottom(state, viewHeight);
        return;

      case "g":
        cloudScrollToTop(state);
        return;

      case "M":
        // Trigger migration on this service (if it has migrate capability)
        if (state.service.capabilities.includes("migrate")) {
          this.triggerMigrationOnService(state.service);
        }
        return;

      case "D":
        // Trigger deploy on this service (if it has deploy capability)
        if (state.service.capabilities.includes("deploy")) {
          this.triggerDeployOnService(state.service);
        }
        return;

      case "o":
        // Open console URL in browser
        if (state.service.url) {
          this.openUrl(state.service.url);
        }
        return;
    }
  }

  private navigateToCloudService(service: CloudService): void {
    this.navStack.push({
      level: this.level,
      projectId: this.focusedProjectId ?? undefined,
    });

    this.level = 3;
    const projectName = this.client.projects.find((p) => p.id === this.focusedProjectId)?.name ?? "";
    this.cloudServiceDetailState = createCloudServiceDetailState(service, projectName);
    this.agentFocusState = null;
    this.ticketFocusState = null;
    this.planStepFocusState = null;
  }

  private triggerMigration(): void {
    if (!this.projectDetailState) return;
    const state = this.projectDetailState;

    // If cloud panel is focused, migrate the selected service
    if (state.focusedPanel === 3) {
      const services = getCloudServicesList(state);
      const service = services[state.selectedIndex[3]];
      if (service && service.capabilities.includes("migrate")) {
        this.triggerMigrationOnService(service);
      }
    }
  }

  private async triggerMigrationOnService(service: CloudService): Promise<void> {
    try {
      const { getDatabaseAdapters } = await import("@opcom/core");
      const adapters = getDatabaseAdapters();
      const adapter = adapters.find((a) => a.provider === service.provider);
      if (adapter?.migrate) {
        const config = this.findCloudConfig(service);
        if (config) {
          await adapter.migrate(config, "up");
          // Refresh cloud services after migration
          if (this.focusedProjectId) {
            this.client.projectCloudServices.delete(this.focusedProjectId);
            this.client.getCloudServices(this.focusedProjectId).then(() => {
              this.syncData();
              this.scheduleRender();
            }).catch(() => {});
          }
        }
      }
    } catch {
      // Migration failed — will show in status on next refresh
    }
  }

  private async triggerDeployOnService(service: CloudService): Promise<void> {
    try {
      const { getServerlessAdapters } = await import("@opcom/core");
      const adapters = getServerlessAdapters();
      const adapter = adapters.find((a) => a.provider === service.provider);
      if (adapter?.deploy) {
        const config = this.findCloudConfig(service);
        if (config) {
          await adapter.deploy(config);
          // Refresh cloud services after deploy
          if (this.focusedProjectId) {
            this.client.projectCloudServices.delete(this.focusedProjectId);
            this.client.getCloudServices(this.focusedProjectId).then(() => {
              this.syncData();
              this.scheduleRender();
            }).catch(() => {});
          }
        }
      }
    } catch {
      // Deploy failed
    }
  }

  private findCloudConfig(service: CloudService): import("@opcom/types").CloudServiceConfig | null {
    if (!this.focusedProjectId) return null;
    const project = this.client.projectConfigs.get(this.focusedProjectId);
    if (!project) return null;
    return project.cloudServices.find(
      (c) => c.provider === service.provider && c.name === service.name,
    ) ?? null;
  }

  private openUrl(url: string): void {
    try {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
    } catch {
      // Failed to open URL
    }
  }

  private navigateBack(): void {
    const prev = this.navStack.pop();
    if (!prev) {
      if (this.level > 1) {
        this.level = 1 as NavigationLevel;
        this.projectDetailState = null;
        this.agentFocusState = null;
        this.ticketFocusState = null;
        this.planStepFocusState = null;
        this.cloudServiceDetailState = null;
        this.focusedProjectId = null;
      }
      return;
    }

    this.level = prev.level;
    this.focusedProjectId = prev.projectId ?? null;

    if (this.level <= 2) {
      this.agentFocusState = null;
      this.ticketFocusState = null;
      this.planStepFocusState = null;
      this.cloudServiceDetailState = null;
    }
    if (this.level <= 1) {
      this.projectDetailState = null;
    }
  }

  // --- Scroll helpers ---

  private adjustScroll(
    selectedIndex: number,
    scrollOffsets: number[],
    panelIndex: number,
    panelHeight: number,
  ): void {
    const visibleRows = panelHeight - 2; // account for box borders
    const scroll = scrollOffsets[panelIndex] ?? 0;

    if (selectedIndex < scroll) {
      scrollOffsets[panelIndex] = selectedIndex;
    } else if (selectedIndex >= scroll + visibleRows) {
      scrollOffsets[panelIndex] = selectedIndex - visibleRows + 1;
    }
  }

  private getPanelHeight(panelIndex: number): number {
    const layout = getLayout(this.level, this.termSize.cols, this.termSize.rows);
    const panel = layout.panels[panelIndex];
    return panel?.height ?? 10;
  }
}
