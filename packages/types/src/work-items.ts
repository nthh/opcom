export interface WorkItem {
  id: string;
  title: string;
  status: "open" | "in-progress" | "closed" | "deferred";
  priority: number;
  type: string;
  filePath: string;
  parent?: string;
  created?: string;
  due?: string;
  scheduled?: string;
  deps: string[];
  links: string[];
  tags: Record<string, string[]>;
  role?: string;
}

export interface WorkSummary {
  total: number;
  open: number;
  inProgress: number;
  closed: number;
  deferred: number;
}

export interface TicketFrontmatter {
  id: string;
  title?: string;
  status: string;
  type?: string;
  priority?: number;
  created?: string;
  due?: string;
  scheduled?: string;
  milestone?: string;
  services?: string[];
  domains?: string[];
  links?: string[];
  deps?: string[];
  assignee?: string;
  role?: string;
}
