import { listSkills, loadSkill } from "@opcom/core";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";

export async function runSkillsList(): Promise<void> {
  const skills = await listSkills();
  if (skills.length === 0) {
    console.log("  No skills available.");
    return;
  }

  console.log(`\n  ${BOLD}Skills${RESET} ${DIM}(${skills.length})${RESET}\n`);
  for (const skill of skills) {
    const roles = skill.compatibleRoles.length > 0
      ? ` ${DIM}roles: ${skill.compatibleRoles.join(", ")}${RESET}`
      : "";
    console.log(`  ${CYAN}${skill.id}${RESET} ${DIM}v${skill.version}${RESET} — ${skill.description}${roles}`);
  }
  console.log("");
}

export async function runSkillsShow(skillId: string): Promise<void> {
  const skill = await loadSkill(skillId);
  if (!skill) {
    console.error(`  Skill '${skillId}' not found.`);
    process.exit(1);
  }

  console.log(`\n  ${BOLD}${skill.name}${RESET} ${DIM}v${skill.version}${RESET}`);
  console.log(`  ${skill.description}`);
  console.log("");
  if (skill.triggers.length > 0) {
    console.log(`  ${DIM}Triggers:${RESET} ${skill.triggers.join(", ")}`);
  }
  if (skill.compatibleRoles.length > 0) {
    console.log(`  ${DIM}Compatible roles:${RESET} ${skill.compatibleRoles.join(", ")}`);
  }
  if (skill.projects.length > 0) {
    console.log(`  ${DIM}Projects:${RESET} ${skill.projects.join(", ")}`);
  }
  console.log("");
  console.log(skill.content);
  console.log("");
}
