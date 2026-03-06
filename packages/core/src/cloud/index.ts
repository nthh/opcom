export { TursoAdapter, detectTurso, getTursoStatus, parseTursoUrl } from "./turso.js";
export type { TursoConfig } from "./turso.js";

export { NeonAdapter, detectNeon, getNeonStatus, parseNeonUrl, isNeonUrl } from "./neon.js";
export type { NeonConfig } from "./neon.js";

export { R2Adapter, detectR2, getR2Status, parseR2Buckets } from "./r2.js";
export type { R2Config } from "./r2.js";

export { GCSAdapter, detectGCS, getGCSStatus, parseGsutilSize, parseFirebaseStorageBucket } from "./gcs.js";
export type { GCSConfig } from "./gcs.js";

export {
  detectPrisma,
  parseMigrateStatus,
  getPrismaMigrationStatus,
  runPrismaMigrate,
  augmentWithPrisma,
} from "./prisma.js";
export type { PrismaOverlayConfig } from "./prisma.js";

export {
  CloudflareWorkersAdapter,
  detectWorkers,
  getWorkersStatus,
  parseWranglerRoutes,
  parseWranglerCrons,
  parseWranglerName,
} from "./workers.js";
export type { WorkersConfig } from "./workers.js";

export {
  FirebaseFunctionsAdapter,
  detectFirebaseFunctions,
  getFirebaseFunctionsStatus,
  parseFirebaseFunctions,
  readFirebaseProject,
  detectScheduledFunctions,
} from "./firebase-functions.js";
export type { FirebaseFunctionsConfig } from "./firebase-functions.js";

export {
  FirebaseHostingAdapter,
  detectFirebaseHosting,
  getFirebaseHostingStatus,
  parseFirebaseHosting,
  detectHostingFramework,
} from "./firebase-hosting.js";
export type { FirebaseHostingConfig } from "./firebase-hosting.js";

export {
  ExpoEASAdapter,
  detectExpoEAS,
  getExpoEASStatus,
  parseAppJson,
  parseEasJson,
  detectPublishCommand,
} from "./expo-eas.js";
export type { ExpoEASConfig } from "./expo-eas.js";

export {
  detectCloudServices,
  getDatabaseAdapters,
  getStorageAdapters,
  getServerlessAdapters,
  getHostingAdapters,
  getMobileAdapters,
} from "./detect.js";
export type { CloudDetectionResult } from "./detect.js";
