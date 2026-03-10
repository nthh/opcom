// Team formation types

import type { VerificationMode } from "./plan.js";

export interface TeamStep {
  role: string;
  verification?: VerificationMode;
  depends_on?: string;  // role id of preceding step
  skills?: string[];    // additional skills to include in context
}

export interface TeamTriggers {
  types?: string[];
  priority_min?: number;
  tags?: Record<string, string[]>;
}

export interface TeamDefinition {
  id: string;
  name: string;
  description?: string;
  steps: TeamStep[];
  triggers?: TeamTriggers;
}
