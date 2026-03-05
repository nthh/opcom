// Changeset types for tracking file changes per agent session / ticket

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  insertions: number;
  deletions: number;
  oldPath?: string; // for renames
}

export interface Changeset {
  sessionId: string;
  ticketId: string;
  projectId: string;
  commitShas: string[];
  files: FileChange[];
  totalInsertions: number;
  totalDeletions: number;
  timestamp: string;
}

export interface ChangesetQuery {
  ticketId?: string;
  sessionId?: string;
  projectId?: string;
}
