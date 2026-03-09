// Structured state file types — separate JSONL files by concern

/** A strategic decision made during plan execution */
export interface DecisionEntry {
  timestamp: string;
  planId: string;
  stepId?: string;
  agent: string;          // "engineer", "oracle", "executor", etc.
  decision: string;       // what was decided
  rationale: string;      // why
  confidence?: number;    // 0-1
}

/** An operational metric captured during execution */
export interface MetricEntry {
  timestamp: string;
  planId: string;
  stepId?: string;
  metric: string;         // "step_duration_ms", "test_pass_rate", "attempts", etc.
  value: number;
  detail?: string;        // human-readable context
}

/** An output artifact produced during execution */
export interface ArtifactEntry {
  timestamp: string;
  planId: string;
  stepId?: string;
  type: string;           // "commit", "file", "merge", "deploy"
  ref?: string;           // git SHA, deploy ID, etc.
  path?: string;          // file path or branch name
  agent?: string;         // which agent produced it
}

/** Filter options for reading state entries */
export interface StateFilter {
  planId?: string;
  stepId?: string;
}

export interface DecisionFilter extends StateFilter {}

export interface MetricFilter extends StateFilter {
  metric?: string;
}

export interface ArtifactFilter extends StateFilter {
  type?: string;
}
