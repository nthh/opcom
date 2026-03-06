// Agent role types

export interface RoleDefinition {
  id: string;
  name?: string;
  permissionMode?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  allowedBashPatterns?: string[];
  instructions?: string;
  doneCriteria?: string;
  runTests?: boolean;
  runOracle?: boolean | null;
}

export interface ResolvedRoleConfig {
  roleId: string;
  name: string;
  permissionMode: string;
  allowedTools: string[];
  disallowedTools: string[];
  allowedBashPatterns: string[];
  instructions: string;
  doneCriteria: string;
  runTests: boolean;
  runOracle: boolean;
}
