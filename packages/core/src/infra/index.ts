export {
  KubernetesAdapter,
  mapDeploymentStatus,
  mapStatefulSetStatus,
  mapDaemonSetStatus,
  mapPodStatus,
  mapJobStatus,
  mapCronJobStatus,
  mapServiceStatus,
  mapIngressStatus,
  mapConditions,
  mapContainerStatus,
  parseLogLine,
  resolveK8sConfig,
  resolveNamespace,
  resolveLabelSelector,
  computeInfraHealthSummary,
} from "./kubernetes.js";

export {
  detectInfrastructure,
  getInfraAdapters,
  getInfraAdapter,
} from "./detect.js";
export type { InfraDetectionResult } from "./detect.js";
