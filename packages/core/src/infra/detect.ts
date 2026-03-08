import type {
  InfraAdapter,
  InfraProvider,
  ProjectConfig,
  DetectionEvidence,
} from "@opcom/types";
import { KubernetesAdapter } from "./kubernetes.js";

/** All registered infrastructure adapters. */
const INFRA_ADAPTERS: InfraAdapter[] = [
  new KubernetesAdapter(),
];

export interface InfraDetectionResult {
  adapters: InfraAdapter[];
  evidence: DetectionEvidence[];
}

/**
 * Detect which infrastructure adapters apply to a project.
 * Returns the matching adapters and detection evidence.
 */
export async function detectInfrastructure(
  project: ProjectConfig,
): Promise<InfraDetectionResult> {
  const adapters: InfraAdapter[] = [];
  const evidence: DetectionEvidence[] = [];

  const detections = await Promise.all(
    INFRA_ADAPTERS.map(async (adapter) => {
      const detected = await adapter.detect(project);
      return { adapter, detected };
    }),
  );

  for (const { adapter, detected } of detections) {
    if (detected) {
      adapters.push(adapter);
      evidence.push({
        file: getDetectionSource(adapter.provider),
        detectedAs: `infra:${adapter.provider}`,
        details: `runtime infrastructure: ${adapter.provider}`,
      });
    }
  }

  return { adapters, evidence };
}

function getDetectionSource(provider: InfraProvider): string {
  switch (provider) {
    case "kubernetes":
      return "k8s/ or kubernetes/ directory";
    case "ecs":
      return "ecs task definition";
    case "fly":
      return "fly.toml";
    case "cloudflare-workers":
      return "wrangler.toml";
    default:
      return "infrastructure config";
  }
}

/**
 * Get all registered infrastructure adapters.
 */
export function getInfraAdapters(): InfraAdapter[] {
  return [...INFRA_ADAPTERS];
}

/**
 * Get the infrastructure adapter for a specific provider.
 */
export function getInfraAdapter(provider: InfraProvider): InfraAdapter | undefined {
  return INFRA_ADAPTERS.find((a) => a.provider === provider);
}
