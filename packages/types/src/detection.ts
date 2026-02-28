import type { StackInfo, WorkSystemInfo, ServiceDefinition, TestingConfig, LintConfig, SubProject, GitInfo, ProjectDocs } from "./project.js";

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
  testing: TestingConfig | null;
  linting: LintConfig[];
  subProjects: SubProject[];
  evidence: DetectionEvidence[];
}

export interface DetectionEvidence {
  file: string;
  detectedAs: string;
  details?: string;
}
