import { listTeams, loadTeam } from "@opcom/core";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";

export async function runTeamList(): Promise<void> {
  const teams = await listTeams();
  if (teams.length === 0) {
    console.log("  No teams available.");
    return;
  }

  console.log(`\n  ${BOLD}Teams${RESET} ${DIM}(${teams.length})${RESET}\n`);
  for (const team of teams) {
    const stepsDesc = team.steps.map((s) => s.role).join(" → ");
    const desc = team.description ? ` — ${team.description}` : "";
    console.log(`  ${CYAN}${team.id}${RESET}${desc}`);
    console.log(`    ${DIM}steps: ${stepsDesc}${RESET}`);
  }
  console.log("");
}

export async function runTeamShow(teamId: string): Promise<void> {
  const team = await loadTeam(teamId);
  if (!team) {
    console.error(`  Team '${teamId}' not found.`);
    process.exit(1);
  }

  console.log(`\n  ${BOLD}${team.name}${RESET} ${DIM}(${team.id})${RESET}`);
  if (team.description) {
    console.log(`  ${team.description}`);
  }
  console.log("");

  console.log(`  ${BOLD}Steps:${RESET}`);
  for (let i = 0; i < team.steps.length; i++) {
    const step = team.steps[i];
    const parts = [`${CYAN}${step.role}${RESET}`];
    if (step.verification) parts.push(`${DIM}verification: ${step.verification}${RESET}`);
    if (step.depends_on) parts.push(`${DIM}after: ${step.depends_on}${RESET}`);
    if (step.skills?.length) parts.push(`${DIM}skills: ${step.skills.join(", ")}${RESET}`);
    console.log(`    ${i + 1}. ${parts.join("  ")}`);
  }

  if (team.triggers) {
    console.log("");
    console.log(`  ${BOLD}Triggers:${RESET}`);
    if (team.triggers.types?.length) {
      console.log(`    ${DIM}types:${RESET} ${team.triggers.types.join(", ")}`);
    }
    if (team.triggers.priority_min != null) {
      console.log(`    ${DIM}priority_min:${RESET} ${team.triggers.priority_min}`);
    }
  }
  console.log("");
}
