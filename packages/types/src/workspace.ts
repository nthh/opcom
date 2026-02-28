export interface WorkspaceConfig {
  id: string;
  name: string;
  description?: string;
  projectIds: string[];
  createdAt: string;
}

export interface GlobalConfig {
  defaultWorkspace: string;
}
