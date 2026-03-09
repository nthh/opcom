// TUI Layout — Panel geometry for each navigation level

export interface Panel {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
}

export interface Layout {
  panels: Panel[];
  statusBarY: number;
}

export type NavigationLevel = 1 | 2 | 3;

const STATUS_BAR_HEIGHT = 1;
const MIN_PANEL_HEIGHT = 4;

/**
 * Compute layout panels based on current navigation level and terminal size.
 *
 * Level 1 (Dashboard):
 *   Left column (60%): Projects (top 50%) | Work Queue (bottom 50%)
 *   Right column (40%): Agents (top 50%) | Chat (bottom 50%)
 *
 * Level 2 (Project Detail):
 *   Left column (55%): Tickets
 *   Right column (45%): Agents | Specs | Stack | Cloud | CI/CD | Chat
 *
 * Level 3 (Agent/Ticket Focus):
 *   Full-screen single panel
 */
export function getLayout(level: NavigationLevel, cols: number, rows: number): Layout {
  const usableRows = rows - STATUS_BAR_HEIGHT;
  const statusBarY = usableRows;

  switch (level) {
    case 1:
      return layoutDashboard(cols, usableRows, statusBarY);
    case 2:
      return layoutProjectDetail(cols, usableRows, statusBarY);
    case 3:
      return layoutFocus(cols, usableRows, statusBarY);
  }
}

function layoutDashboard(cols: number, rows: number, statusBarY: number): Layout {
  const leftWidth = Math.max(30, Math.floor(cols * 0.6));
  const rightWidth = cols - leftWidth;
  const topHeight = Math.max(MIN_PANEL_HEIGHT, Math.floor(rows * 0.5));
  const bottomHeight = Math.max(MIN_PANEL_HEIGHT, rows - topHeight);

  // Right column: agents top, chat bottom
  const rightTopHeight = Math.max(MIN_PANEL_HEIGHT, Math.floor(rows * 0.5));
  const rightBottomHeight = Math.max(MIN_PANEL_HEIGHT, rows - rightTopHeight);

  return {
    panels: [
      {
        id: "projects",
        x: 0,
        y: 0,
        width: leftWidth,
        height: topHeight,
        title: "Projects",
      },
      {
        id: "workqueue",
        x: 0,
        y: topHeight,
        width: leftWidth,
        height: bottomHeight,
        title: "Work Queue",
      },
      {
        id: "agents",
        x: leftWidth,
        y: 0,
        width: rightWidth,
        height: rightTopHeight,
        title: "Agents",
      },
      {
        id: "chat",
        x: leftWidth,
        y: rightTopHeight,
        width: rightWidth,
        height: rightBottomHeight,
        title: "Chat",
      },
    ],
    statusBarY,
  };
}

function layoutProjectDetail(cols: number, rows: number, statusBarY: number): Layout {
  const leftWidth = Math.max(30, Math.floor(cols * 0.55));
  const rightWidth = cols - leftWidth;
  // 7 right-column panels: agents, specs, stack, cloud, cicd, infra, chat
  const sectionCount = 7;
  const sectionH = Math.max(MIN_PANEL_HEIGHT, Math.floor(rows / sectionCount));
  const rightH1 = sectionH;
  const rightH2 = sectionH;
  const rightH3 = sectionH;
  const rightH4 = sectionH;
  const rightH5 = sectionH;
  const rightH6 = sectionH;
  const rightH7 = Math.max(MIN_PANEL_HEIGHT, rows - rightH1 - rightH2 - rightH3 - rightH4 - rightH5 - rightH6);

  return {
    panels: [
      {
        id: "tickets",
        x: 0,
        y: 0,
        width: leftWidth,
        height: rows,
        title: "Tickets",
      },
      {
        id: "agents",
        x: leftWidth,
        y: 0,
        width: rightWidth,
        height: rightH1,
        title: "Agents",
      },
      {
        id: "specs",
        x: leftWidth,
        y: rightH1,
        width: rightWidth,
        height: rightH2,
        title: "Specs",
      },
      {
        id: "stack",
        x: leftWidth,
        y: rightH1 + rightH2,
        width: rightWidth,
        height: rightH3,
        title: "Stack",
      },
      {
        id: "cloud",
        x: leftWidth,
        y: rightH1 + rightH2 + rightH3,
        width: rightWidth,
        height: rightH4,
        title: "Cloud",
      },
      {
        id: "cicd",
        x: leftWidth,
        y: rightH1 + rightH2 + rightH3 + rightH4,
        width: rightWidth,
        height: rightH5,
        title: "CI/CD",
      },
      {
        id: "infra",
        x: leftWidth,
        y: rightH1 + rightH2 + rightH3 + rightH4 + rightH5,
        width: rightWidth,
        height: rightH6,
        title: "Infrastructure",
      },
      {
        id: "chat",
        x: leftWidth,
        y: rightH1 + rightH2 + rightH3 + rightH4 + rightH5 + rightH6,
        width: rightWidth,
        height: rightH7,
        title: "Chat",
      },
    ],
    statusBarY,
  };
}

function layoutFocus(cols: number, rows: number, statusBarY: number): Layout {
  return {
    panels: [
      {
        id: "focus",
        x: 0,
        y: 0,
        width: cols,
        height: rows,
        title: "Focus",
      },
    ],
    statusBarY,
  };
}

// Track terminal size and notify on resize
export class TerminalSize {
  cols: number;
  rows: number;
  private listeners: Array<(cols: number, rows: number) => void> = [];

  constructor() {
    this.cols = process.stdout.columns || 80;
    this.rows = process.stdout.rows || 24;

    process.stdout.on("resize", () => {
      this.cols = process.stdout.columns || 80;
      this.rows = process.stdout.rows || 24;
      for (const listener of this.listeners) {
        listener(this.cols, this.rows);
      }
    });
  }

  onResize(fn: (cols: number, rows: number) => void): void {
    this.listeners.push(fn);
  }

  removeListener(fn: (cols: number, rows: number) => void): void {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }
}
