import type { CloudServiceConfig } from "./cloud-services.js";
import type { HealthCheckConfig } from "./environments.js";

export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
  description?: string;
  stack: StackInfo;
  git: GitInfo | null;
  workSystem: WorkSystemInfo | null;
  docs: ProjectDocs;
  services: ServiceDefinition[];
  environments: EnvironmentConfig[];
  testing: TestingConfig | null;
  linting: LintConfig[];
  subProjects: SubProject[];
  cloudServices: CloudServiceConfig[];
  lastScannedAt: string;
  overrides?: Partial<ProjectConfigOverrides>;
  profile?: ProjectProfileConfig;
}

export interface StackInfo {
  languages: LanguageInfo[];
  frameworks: FrameworkInfo[];
  packageManagers: PackageManagerInfo[];
  infrastructure: InfrastructureInfo[];
  versionManagers: VersionManagerInfo[];
}

export interface LanguageInfo {
  name: string;
  version?: string;
  sourceFile: string;
}

export interface FrameworkInfo {
  name: string;
  version?: string;
  sourceFile: string;
}

export interface PackageManagerInfo {
  name: string;
  sourceFile: string;
}

export interface InfrastructureInfo {
  name: string;
  sourceFile: string;
}

export interface VersionManagerInfo {
  name: string;
  sourceFile: string;
}

export interface GitInfo {
  remote: string | null;
  branch: string;
  clean: boolean;
  lastCommitAt?: string;
  uncommittedCount?: number;
}

export type WorkSystemType = "trk" | "tickets-dir" | "github-issues" | "jira" | "linear" | "calendar";

export interface WorkSystemInfo {
  type: WorkSystemType;
  ticketDir: string;
}

export interface ProjectDocs {
  agentConfig?: string;       // AGENTS.md, CLAUDE.md, .cursorrules, CONVENTIONS.md, etc.
  readme?: string;            // README.md
  specsDir?: string;          // docs/spec/
  decisionsDir?: string;      // docs/decisions/, docs/adr/
  vision?: string;            // docs/VISION.md, VISION.md
  architecture?: string;      // docs/ARCHITECTURE.md, ARCHITECTURE.md
  contributing?: string;      // CONTRIBUTING.md
  changelog?: string;         // CHANGELOG.md
  runbooksDir?: string;       // docs/runbooks/
  codeowners?: string;        // .github/CODEOWNERS, CODEOWNERS
}

export interface ServiceDefinition {
  name: string;
  command?: string;
  port?: number;
  cwd?: string;
  dependsOn?: string[];
  healthCheck?: HealthCheckConfig;
  env?: Record<string, string>;
  readyPattern?: string;
}

export interface EnvironmentConfig {
  name: string;
  url?: string;
  type: "local" | "staging" | "production";
}

export interface TestingConfig {
  framework: string;
  command?: string;
  testDir?: string;
}

export interface LintConfig {
  name: string;
  sourceFile: string;
}

export interface SubProject {
  name: string;
  path: string;
  relativePath: string;
}

export interface ProjectConfigOverrides {
  name: string;
  services: ServiceDefinition[];
  environments: EnvironmentConfig[];
  integrations: import("./integrations.js").IntegrationsConfig;
  infrastructure: import("./infrastructure.js").InfraConfig;
}

/** A named project command (build, test, dev, lint, deploy, etc.). */
export interface ProjectCommand {
  name: string;
  command: string;
  description?: string;
}

/**
 * Maps a ticket frontmatter field to a WorkItem property.
 * - "use-case": values become links (e.g. docs/use-cases/<value>.md)
 * - "tag": values stay as tags (default behavior)
 */
export interface FieldMapping {
  field: string;
  type: "use-case" | "tag";
  targetPath?: string;
}

/** A constraint that governs how agents should work with this project. */
export interface AgentConstraint {
  name: string;
  rule: string;
}

/**
 * Operational view of a project for agent context.
 * Extracted from ProjectConfig, contains everything an agent needs to know
 * about how the project works: what it is, how to build/test/run it, and
 * where it deploys.
 */
export interface ProjectProfile {
  name: string;
  path: string;
  description?: string;
  stack: StackInfo;
  testing: TestingConfig | null;
  linting: LintConfig[];
  services: ServiceDefinition[];
  environments?: EnvironmentConfig[];
  commands?: ProjectCommand[];
  fieldMappings?: FieldMapping[];
  agentConstraints?: AgentConstraint[];
}

/** Persisted profile section in project YAML config. */
export interface ProjectProfileConfig {
  commands?: ProjectCommand[];
  fieldMappings?: FieldMapping[];
  agentConstraints?: AgentConstraint[];
}
