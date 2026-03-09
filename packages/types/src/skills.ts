// Skill capability package types

/**
 * Raw shape of a SKILL.md frontmatter + content.
 * Skills are standalone capability packages that any role can use.
 */
export interface SkillDefinition {
  /** Unique identifier, matches directory name. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short description of what this skill does. */
  description: string;
  /** Semver version string. */
  version: string;
  /** Keywords that trigger automatic inclusion when found in work item type/tags/title. */
  triggers: string[];
  /** Role IDs this skill is compatible with. Empty = compatible with all. */
  compatibleRoles: string[];
  /** Full markdown content of the skill (the body after frontmatter). */
  content: string;
  /** Optional project scoping — skill only applies to these project IDs. Empty = all projects. */
  projects: string[];
}

/** Compact skill reference included in a ContextPacket. */
export interface SkillEntry {
  name: string;
  content: string;
}
