// Cloud Services normalized types
// Adapter interface and types for cloud provider status tracking.

import type { StackInfo } from "./project.js";

// --- Provider ---

export type CloudProvider =
  // Databases
  | "turso"
  | "neon"
  | "planetscale"
  | "supabase"
  // Object storage
  | "cloudflare-r2"
  | "gcs"
  | "s3"
  // Serverless
  | "cloudflare-workers"
  | "firebase-functions"
  // Hosting
  | "firebase-hosting"
  | "vercel"
  | "netlify"
  | "cloudflare-pages"
  // Mobile
  | "expo-eas"
  | "firebase-app-distribution";

export type CloudServiceKind =
  | "database"
  | "storage"
  | "serverless"
  | "hosting"
  | "mobile";

export type CloudServiceHealth =
  | "healthy"
  | "degraded"
  | "unreachable"
  | "unknown";

export type CloudCapability =
  | "logs"
  | "deploy"
  | "migrate"
  | "metrics"
  | "restart";

// --- Service ---

export interface CloudService {
  id: string;                        // provider:name (e.g. "firebase-hosting:prod")
  projectId: string;
  provider: CloudProvider;
  kind: CloudServiceKind;
  name: string;
  status: CloudServiceHealth;
  detail: CloudServiceDetail;
  capabilities: CloudCapability[];
  lastCheckedAt: string;
  url?: string;
}

// --- Kind-Specific Detail Types ---

export type CloudServiceDetail =
  | DatabaseDetail
  | StorageDetail
  | ServerlessDetail
  | HostingDetail
  | MobileDetail;

export interface DatabaseDetail {
  kind: "database";
  engine: "sqlite" | "postgres" | "mysql";
  connectionUrl?: string;
  sizeBytes?: number;
  tableCount?: number;
  migration?: MigrationStatus;
  replicas?: number;
  region?: string;
}

export interface MigrationStatus {
  tool: "prisma" | "drizzle" | "knex" | "raw";
  applied: number;
  pending: number;
  lastAppliedAt?: string;
  lastMigrationName?: string;
}

export interface StorageDetail {
  kind: "storage";
  buckets: BucketInfo[];
}

export interface BucketInfo {
  name: string;
  sizeBytes?: number;
  objectCount?: number;
  region?: string;
  publicAccess: boolean;
}

export interface ServerlessDetail {
  kind: "serverless";
  functions: FunctionInfo[];
  runtime?: string;
}

export interface FunctionInfo {
  name: string;
  status: "deployed" | "failed" | "draft";
  trigger: "http" | "schedule" | "event" | "queue";
  route?: string;
  lastDeployedAt?: string;
  region?: string;
}

export interface HostingDetail {
  kind: "hosting";
  domains: DomainInfo[];
  lastDeployedAt?: string;
  deployedRef?: string;
  framework?: string;
}

export interface DomainInfo {
  hostname: string;
  ssl: boolean;
  primary: boolean;
}

export interface MobileDetail {
  kind: "mobile";
  platform: "ios" | "android" | "both";
  currentVersion?: string;
  lastPublishedAt?: string;
  updateChannel?: string;
  distribution: "ota" | "store" | "ad-hoc";
}

// --- Adapter Config ---

export interface CloudServiceConfig {
  provider: CloudProvider;
  kind: CloudServiceKind;
  name: string;
  [key: string]: unknown;
}

// --- Adapter Interface ---

export interface LogOptions {
  follow?: boolean;
  tailLines?: number;
  since?: string;
  functionName?: string;
}

export interface LogLine {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  source?: string;
}

export interface DeployOptions {
  ref?: string;
  environment?: string;
}

export interface DeployResult {
  success: boolean;
  deploymentId?: string;
  url?: string;
  error?: string;
}

export interface MigrateResult {
  applied: string[];
  pending: string[];
  error?: string;
}

export interface TimeRange {
  start: string;
  end: string;
}

export interface MetricsResult {
  requests?: number;
  errors?: number;
  latencyP50Ms?: number;
  latencyP99Ms?: number;
  storageBytes?: number;
  computeMs?: number;
  period: TimeRange;
}

export interface CloudServiceAdapter {
  readonly provider: CloudProvider;
  readonly kind: CloudServiceKind;

  detect(projectPath: string, stack: StackInfo): Promise<CloudServiceConfig | null>;
  status(config: CloudServiceConfig): Promise<CloudService>;
  logs?(config: CloudServiceConfig, opts: LogOptions): AsyncIterable<LogLine>;
  deploy?(config: CloudServiceConfig, opts?: DeployOptions): Promise<DeployResult>;
  migrate?(config: CloudServiceConfig, direction: "up" | "status"): Promise<MigrateResult>;
  metrics?(config: CloudServiceConfig, range: TimeRange): Promise<MetricsResult>;
}

// --- Events ---

export type CloudServiceEvent =
  | { type: "cloud_service_updated"; projectId: string; service: CloudService }
  | { type: "cloud_service_alert"; projectId: string; serviceId: string; message: string };
