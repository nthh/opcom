// TUI Renderer — Core terminal rendering engine
// Uses raw ANSI escape codes with double-buffering to minimize flicker.

const ESC = "\x1b";

// --- ANSI Escape Sequences ---

export const ANSI = {
  // Screen
  enterAltScreen: `${ESC}[?1049h`,
  leaveAltScreen: `${ESC}[?1049l`,
  clearScreen: `${ESC}[2J`,
  clearLine: `${ESC}[2K`,

  // Cursor
  hideCursor: `${ESC}[?25l`,
  showCursor: `${ESC}[?25h`,
  moveTo: (row: number, col: number) => `${ESC}[${row + 1};${col + 1}H`,
  saveCursor: `${ESC}[s`,
  restoreCursor: `${ESC}[u`,

  // Style
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  italic: `${ESC}[3m`,
  underline: `${ESC}[4m`,
  reverse: `${ESC}[7m`,
  strikethrough: `${ESC}[9m`,

  // Foreground colors (basic 16)
  black: `${ESC}[30m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  white: `${ESC}[37m`,

  orange: `${ESC}[38;5;208m`,

  brightBlack: `${ESC}[90m`,
  brightRed: `${ESC}[91m`,
  brightGreen: `${ESC}[92m`,
  brightYellow: `${ESC}[93m`,
  brightBlue: `${ESC}[94m`,
  brightMagenta: `${ESC}[95m`,
  brightCyan: `${ESC}[96m`,
  brightWhite: `${ESC}[97m`,

  // Background colors (basic 16)
  bgBlack: `${ESC}[40m`,
  bgRed: `${ESC}[41m`,
  bgGreen: `${ESC}[42m`,
  bgYellow: `${ESC}[43m`,
  bgBlue: `${ESC}[44m`,
  bgMagenta: `${ESC}[45m`,
  bgCyan: `${ESC}[46m`,
  bgWhite: `${ESC}[47m`,
} as const;

// --- Style helpers ---

export function bold(text: string): string {
  return `${ANSI.bold}${text}${ANSI.reset}`;
}

export function dim(text: string): string {
  return `${ANSI.dim}${text}${ANSI.reset}`;
}

export function color(fg: string, text: string): string {
  return `${fg}${text}${ANSI.reset}`;
}

export function style(styles: string, text: string): string {
  return `${styles}${text}${ANSI.reset}`;
}

export function stateColor(state: string): string {
  switch (state) {
    case "streaming":
    case "clean":
      return ANSI.green;
    case "idle":
    case "waiting":
    case "dirty":
      return ANSI.yellow;
    case "error":
    case "stopped":
      return ANSI.red;
    default:
      return ANSI.cyan;
  }
}

// --- Box drawing characters ---

export const BOX = {
  topLeft: "\u250c",     // ┌
  topRight: "\u2510",    // ┐
  bottomLeft: "\u2514",  // └
  bottomRight: "\u2518", // ┘
  horizontal: "\u2500",  // ─
  vertical: "\u2502",    // │
  teeRight: "\u251c",    // ├
  teeLeft: "\u2524",     // ┤
  teeDown: "\u252c",     // ┬
  teeUp: "\u2534",       // ┴
  cross: "\u253c",       // ┼
} as const;

// --- Text utilities ---

// Strip ANSI escape sequences for length calculations
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

export function truncate(text: string, maxWidth: number, ellipsis = "\u2026"): string {
  const stripped = stripAnsi(text);
  if (stripped.length <= maxWidth) return text;
  if (maxWidth <= 1) return ellipsis;

  // Walk through original string, tracking visible chars
  let visible = 0;
  let i = 0;
  const target = maxWidth - 1; // leave room for ellipsis
  while (i < text.length && visible < target) {
    if (text[i] === "\x1b") {
      // Skip ANSI sequence
      const end = text.indexOf("m", i);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
    }
    visible++;
    i++;
  }
  return text.slice(0, i) + ANSI.reset + ellipsis;
}

export function padRight(text: string, width: number): string {
  const vLen = visibleLength(text);
  if (vLen >= width) return text;
  return text + " ".repeat(width - vLen);
}

export function padCenter(text: string, width: number): string {
  const vLen = visibleLength(text);
  if (vLen >= width) return text;
  const leftPad = Math.floor((width - vLen) / 2);
  const rightPad = width - vLen - leftPad;
  return " ".repeat(leftPad) + text + " ".repeat(rightPad);
}

export function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const stripped = stripAnsi(text);
  if (stripped.length <= maxWidth) return [text];

  // For plain text (no ANSI), do word-wrap
  const lines: string[] = [];
  let remaining = stripped; // wrap on stripped text to avoid splitting ANSI codes
  while (remaining.length > maxWidth) {
    // Find last space within maxWidth
    let breakAt = remaining.lastIndexOf(" ", maxWidth);
    if (breakAt <= 0) {
      // No space found, hard break
      breakAt = maxWidth;
    }
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).replace(/^ /, ""); // trim leading space
  }
  if (remaining.length > 0) {
    lines.push(remaining);
  }
  return lines;
}

// --- Screen Buffer (double-buffered rendering) ---

export class ScreenBuffer {
  private current: string[][];
  private next: string[][];
  private _cols: number;
  private _rows: number;
  private output: string[] = [];

  constructor(cols: number, rows: number) {
    this._cols = cols;
    this._rows = rows;
    this.current = this.makeGrid(cols, rows);
    this.next = this.makeGrid(cols, rows);
  }

  get cols(): number { return this._cols; }
  get rows(): number { return this._rows; }

  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    this.current = this.makeGrid(cols, rows);
    this.next = this.makeGrid(cols, rows);
  }

  clear(): void {
    this.next = this.makeGrid(this._cols, this._rows);
  }

  // Write text at position. Text may contain ANSI codes.
  write(row: number, col: number, text: string): void {
    if (row < 0 || row >= this._rows) return;
    if (col < 0 || col >= this._cols) return;

    // Store entire text at the starting column
    // We use a flat approach: each cell gets a character, but ANSI codes are tracked
    let vCol = col;
    let i = 0;
    let activeStyle = "";

    while (i < text.length && vCol < this._cols) {
      if (text[i] === "\x1b") {
        // Capture ANSI sequence
        const end = text.indexOf("m", i);
        if (end !== -1) {
          const seq = text.slice(i, end + 1);
          activeStyle += seq;
          i = end + 1;
          continue;
        }
      }
      // Write visible character with accumulated style
      if (this.next[row]) {
        this.next[row][vCol] = activeStyle + text[i] + ANSI.reset;
      }
      vCol++;
      i++;
    }
  }

  // Write a full line of styled text (more efficient for complex styling)
  writeLine(row: number, col: number, text: string, maxWidth?: number): void {
    if (row < 0 || row >= this._rows) return;
    const width = maxWidth ?? (this._cols - col);
    const truncated = truncate(text, width);
    this.write(row, col, truncated);
  }

  // Flush only changed cells to terminal
  flush(): void {
    this.output.length = 0;
    this.output.push(ANSI.hideCursor);

    for (let r = 0; r < this._rows; r++) {
      // Rebuild full line for row comparison
      const curLine = this.current[r]?.join("") ?? "";
      const nextLine = this.next[r]?.join("") ?? "";

      if (curLine !== nextLine) {
        this.output.push(ANSI.moveTo(r, 0));
        this.output.push(ANSI.clearLine);
        if (this.next[r]) {
          this.output.push(this.next[r].join(""));
        }
      }
    }

    this.output.push(ANSI.reset);
    process.stdout.write(this.output.join(""));

    // Swap buffers
    const tmp = this.current;
    this.current = this.next;
    this.next = tmp;
    // Clear next buffer for next frame
    for (let r = 0; r < this._rows; r++) {
      if (this.next[r]) {
        for (let c = 0; c < this._cols; c++) {
          this.next[r][c] = " ";
        }
      }
    }
  }

  // Force full redraw (used on resize)
  forceRedraw(): void {
    this.current = this.makeGrid(this._cols, this._rows);
  }

  private makeGrid(cols: number, rows: number): string[][] {
    const grid: string[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < cols; c++) {
        row.push(" ");
      }
      grid.push(row);
    }
    return grid;
  }
}

// --- Drawing helpers ---

export function drawBox(
  buf: ScreenBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  title?: string,
  focused = false,
): void {
  if (w < 2 || h < 2) return;

  const borderStyle = focused ? ANSI.bold + ANSI.cyan : ANSI.dim;

  // Top border
  let top = borderStyle + BOX.topLeft + BOX.horizontal.repeat(w - 2) + BOX.topRight + ANSI.reset;
  if (title) {
    const titleStr = focused
      ? ` ${ANSI.bold}${ANSI.cyan}${title}${ANSI.reset}${borderStyle} `
      : ` ${title} `;
    const titleVis = visibleLength(titleStr);
    if (titleVis + 4 <= w) {
      top = borderStyle + BOX.topLeft + BOX.horizontal
        + titleStr
        + borderStyle + BOX.horizontal.repeat(Math.max(0, w - 4 - visibleLength(titleStr) + 2))
        + BOX.topRight + ANSI.reset;
    }
  }
  buf.write(y, x, top);

  // Side borders
  for (let row = 1; row < h - 1; row++) {
    buf.write(y + row, x, borderStyle + BOX.vertical + ANSI.reset);
    buf.write(y + row, x + w - 1, borderStyle + BOX.vertical + ANSI.reset);
  }

  // Bottom border
  const bottom = borderStyle + BOX.bottomLeft + BOX.horizontal.repeat(w - 2) + BOX.bottomRight + ANSI.reset;
  buf.write(y + h - 1, x, bottom);
}

// Draw horizontal separator inside a box
export function drawSeparator(
  buf: ScreenBuffer,
  x: number,
  y: number,
  w: number,
  focused = false,
): void {
  const borderStyle = focused ? ANSI.bold + ANSI.cyan : ANSI.dim;
  const sep = borderStyle + BOX.teeRight + BOX.horizontal.repeat(w - 2) + BOX.teeLeft + ANSI.reset;
  buf.write(y, x, sep);
}

// --- Progress bar ---

export function progressBar(value: number, max: number, width: number): string {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;

  let barColor: string = ANSI.green;
  if (pct > 75) barColor = ANSI.yellow;
  if (pct > 90) barColor = ANSI.red;

  return barColor + "\u2588".repeat(filled) + ANSI.dim + "\u2591".repeat(empty) + ANSI.reset;
}
