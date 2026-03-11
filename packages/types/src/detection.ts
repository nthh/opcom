import type { StackInfo, WorkSystemInfo, ServiceDefinition, TestSuite, LintConfig, SubProject, GitInfo, ProjectDocs, ProjectProfileConfig } from "./project.js";
import type { CloudServiceConfig } from "./cloud-services.js";

export type DetectionConfidence = "high" | "medium" | "low";

export interface DetectionResult {
  path: string;
  name: string;
  confidence: DetectionConfidence;
  stack: StackInfo;
  git: GitInfo | null;
  workSystem: WorkSystemInfo | null;
  docs: ProjectDocs;
  services: ServiceDefinition[];
  testing: TestSuite[];
  linting: LintConfig[];
  subProjects: SubProject[];
  cloudServices: CloudServiceConfig[];
  profile?: Partial<ProjectProfileConfig>;
  evidence: DetectionEvidence[];
}

export interface DetectionEvidence {
  file: string;
  detectedAs: string;
  details?: string;
}
