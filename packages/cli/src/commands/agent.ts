import { SessionManager } from "@opcom/core";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

export async function runAgentList(): Promise<void> {
  const sm = new SessionManager();
  await sm.init();

  const sessions = sm.listSessions();
  if (sessions.length === 0) {
    console.log("\n  No active agents.\n");
    return;
  }

  console.log(`\n  ${BOLD}AGENTS${RESET} (${sessions.length})\n`);

  for (const s of sessions) {
    const stateColor = s.state === "streaming" ? GREEN
      : s.state === "idle" ? CYAN
      : s.state === "error" ? RED
      : YELLOW;

    const elapsed = elapsedSince(s.startedAt);
    const ticket = s.workItemId ? `/${s.workItemId}` : "";

    console.log(`  ${BOLD}${s.projectId}${ticket}${RESET}`);
    console.log(`    ${s.backend}  ${stateColor}${s.state}${RESET}  ${DIM}${elapsed}${RESET}  ${DIM}${s.id.slice(0, 8)}${RESET}`);

    if (s.contextUsage) {
      const pct = s.contextUsage.percentage;
      const bar = progressBar(pct, 20);
      console.log(`    ctx: ${bar} ${pct}%`);
    }
    console.log("");
  }
}

export async function runAgentStop(sessionId: string): Promise<void> {
  const sm = new SessionManager();
  await sm.init();

  // Support partial ID matching
  const sessions = sm.listSessions();
  const match = sessions.find((s) => s.id === sessionId || s.id.startsWith(sessionId));

  if (!match) {
    console.error(`  No session matching '${sessionId}'.`);
    process.exit(1);
  }

  await sm.stopSession(match.id);
  console.log(`  Stopped session ${match.id.slice(0, 8)} (${match.projectId}/${match.workItemId ?? "no ticket"})`);
}

export async function runAgentPrompt(sessionId: string, message: string): Promise<void> {
  const sm = new SessionManager();
  await sm.init();

  const sessions = sm.listSessions();
  const match = sessions.find((s) => s.id === sessionId || s.id.startsWith(sessionId));

  if (!match) {
    console.error(`  No session matching '${sessionId}'.`);
    process.exit(1);
  }

  await sm.promptSession(match.id, message);
  console.log(`  Sent to ${match.id.slice(0, 8)}: "${message.slice(0, 60)}${message.length > 60 ? "..." : ""}"`);
}

function elapsedSince(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h${min % 60}m`;
}

function progressBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `${"█".repeat(filled)}${"░".repeat(empty)}`;
}
