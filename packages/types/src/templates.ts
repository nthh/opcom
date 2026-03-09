// Project template types

export interface TemplateVariable {
  name: string;
  prompt: string;
  default?: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  variables?: TemplateVariable[];
  directories?: string[];
  /** Ticket files: filename → content (markdown with {{variable}} placeholders) */
  tickets: Record<string, string>;
  /** AGENTS.md content with {{variable}} placeholders */
  agentsMd: string;
}
