/** Categories of integration modules. */
export type IntegrationCategory =
  | "work-sources"
  | "notifications"
  | "cicd"
  | "agent-backends"
  | "features";

/** Interface every integration module implements. */
export interface IntegrationModule {
  /** Unique key, e.g. "github-issues", "slack" */
  id: string;
  /** Which category this module belongs to */
  category: IntegrationCategory;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** Called on station start if enabled */
  init(config?: Record<string, unknown>): Promise<void>;
  /** Called on station stop */
  teardown(): Promise<void>;
}

/** Config shape for the integrations section in workspace/global config. */
export interface IntegrationsConfig {
  "work-sources"?: string[];
  notifications?: string[];
  cicd?: string[];
  "agent-backends"?: string[];
  features?: string[];
}
