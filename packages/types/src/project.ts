import type { CloudServiceConfig } from "./cloud-services.js";
import type { HealthCheckConfig } from "./environments.js";

export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
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

export type WorkSystemType = "trk" | "tickets-dir" | "github-issues" | "jira" | "linear";

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
}
