// TUI Stack Detail View (Level 3)
// Full-screen drill-down into a single stack item

import type {
  ProjectConfig,
  StackInfo,
  InfraResource,
} from "@opcom/types";
import type { Panel } from "../layout.js";
import {
  ScreenBuffer,
  drawBox,
  ANSI,
  bold,
  dim,
  color,
  truncate,
} from "../renderer.js";

/** Category of a stack item for grouping and display. */
export type StackItemCategory =
  | "language"
  | "framework"
  | "infrastructure"
  | "package-manager"
  | "version-manager"
  | "testing"
  | "service";

/** Unified stack item for navigation. */
export interface StackItem {
  name: string;
  category: StackItemCategory;
  version?: string;
  sourceFile?: string;
  port?: number;
}

export interface StackDetailState {
  item: StackItem;
  projectName: string;
  projectConfig: ProjectConfig;
  infraResources: InfraResource[];
  scrollOffset: number;
  totalLines: number;
}

/** Build a flat navigable list of stack items from a ProjectConfig. */
export function buildStackItemList(config: ProjectConfig): StackItem[] {
  const items: StackItem[] = [];
  const stack = config.stack;

  for (const lang of stack.languages) {
    items.push({
      name: lang.name,
      category: "language",
      version: lang.version,
      sourceFile: lang.sourceFile,
    });
  }
  for (const fw of stack.frameworks) {
    items.push({
      name: fw.name,
      category: "framework",
      version: fw.version,
      sourceFile: fw.sourceFile,
    });
  }
  for (const infra of stack.infrastructure) {
    items.push({
      name: infra.name,
      category: "infrastructure",
      sourceFile: infra.sourceFile,
    });
  }
  for (const pm of stack.packageManagers) {
    items.push({
      name: pm.name,
      category: "package-manager",
      sourceFile: pm.sourceFile,
    });
  }
  for (const vm of stack.versionManagers) {
    items.push({
      name: vm.name,
      category: "version-manager",
      sourceFile: vm.sourceFile,
    });
  }
  if (config.testing) {
    items.push({
      name: config.testing.framework,
      category: "testing",
    });
  }
  for (const svc of config.services) {
    items.push({
      name: svc.name,
      category: "service",
      port: svc.port,
    });
  }
  return items;
}

export function createStackDetailState(
  item: StackItem,
  projectName: string,
  projectConfig: ProjectConfig,
  infraResources: InfraResource[],
): StackDetailState {
  return {
    item,
    projectName,
    projectConfig,
    infraResources,
    scrollOffset: 0,
    totalLines: 0,
  };
}

export function renderStackDetail(
  buf: ScreenBuffer,
  panel: Panel,
  state: StackDetailState,
): void {
  const { item, projectName } = state;
  const versionStr = item.version ? ` v${item.version}` : "";
  const title = `${projectName} \u2500 ${item.name}${versionStr} \u2500 ${categoryLabel(item.category)}`;

  drawBox(buf, panel.x, panel.y, panel.width, panel.height, title, true);

  const contentWidth = panel.width - 4;
  const maxRows = panel.height - 4; // box borders + footer
  const lines = buildDetailLines(state, contentWidth);
  state.totalLines = lines.length;

  const scroll = state.scrollOffset;
  for (let i = 0; i < maxRows && i + scroll < lines.length; i++) {
    buf.writeLine(panel.y + 1 + i, panel.x + 2, lines[i + scroll], contentWidth);
  }

  // Footer
  const footerY = panel.y + panel.height - 1;
  buf.writeLine(footerY, panel.x + 2, dim("esc:back  j/k:scroll  G:bottom  g:top"), contentWidth);
}

export function buildDetailLines(state: StackDetailState, _width: number): string[] {
  const { item, projectConfig } = state;
  const lines: string[] = [];

  // Header info
  lines.push(`${bold("Name:")} ${item.name}`);
  lines.push(`${bold("Category:")} ${categoryLabel(item.category)}`);
  if (item.version) {
    lines.push(`${bold("Version:")} ${item.version}`);
  }
  if (item.sourceFile) {
    lines.push(`${bold("Source:")} ${item.sourceFile}`);
  }
  if (item.port !== undefined) {
    lines.push(`${bold("Port:")} ${item.port}`);
  }
  lines.push("");

  // Category-specific sections
  switch (item.category) {
    case "language":
      buildLanguageDetails(item, projectConfig, lines);
      break;
    case "framework":
      buildFrameworkDetails(item, projectConfig, lines);
      break;
    case "infrastructure":
      buildInfrastructureDetails(item, projectConfig, state.infraResources, lines);
      break;
    case "package-manager":
      buildPackageManagerDetails(item, projectConfig, lines);
      break;
    case "version-manager":
      buildVersionManagerDetails(item, projectConfig, lines);
      break;
    case "testing":
      buildTestingDetails(projectConfig, lines);
      break;
    case "service":
      buildServiceDetails(item, projectConfig, lines);
      break;
  }

  return lines;
}

function buildLanguageDetails(
  item: StackItem,
  config: ProjectConfig,
  lines: string[],
): void {
  // Frameworks using this language
  const relatedFrameworks = config.stack.frameworks;
  if (relatedFrameworks.length > 0) {
    lines.push(bold("FRAMEWORKS"));
    for (const fw of relatedFrameworks) {
      const ver = fw.version ? dim(` v${fw.version}`) : "";
      lines.push(`  ${fw.name}${ver}  ${dim(fw.sourceFile)}`);
    }
    lines.push("");
  }

  // Package managers
  const pms = config.stack.packageManagers;
  if (pms.length > 0) {
    lines.push(bold("PACKAGE MANAGERS"));
    for (const pm of pms) {
      lines.push(`  ${pm.name}  ${dim(pm.sourceFile)}`);
    }
    lines.push("");
  }

  // Version manager info
  const vms = config.stack.versionManagers;
  if (vms.length > 0) {
    lines.push(bold("VERSION MANAGERS"));
    for (const vm of vms) {
      lines.push(`  ${vm.name}  ${dim(vm.sourceFile)}`);
    }
    lines.push("");
  }

  // Related config files
  const configFiles = findRelatedConfigFiles(item.name, config);
  if (configFiles.length > 0) {
    lines.push(bold("RELATED CONFIG FILES"));
    for (const f of configFiles) {
      lines.push(`  ${f}`);
    }
    lines.push("");
  }
}

function buildFrameworkDetails(
  item: StackItem,
  config: ProjectConfig,
  lines: string[],
): void {
  // Show which language this framework is associated with
  const languages = config.stack.languages;
  if (languages.length > 0) {
    lines.push(bold("LANGUAGES"));
    for (const lang of languages) {
      const ver = lang.version ? dim(` v${lang.version}`) : "";
      lines.push(`  ${lang.name}${ver}  ${dim(lang.sourceFile)}`);
    }
    lines.push("");
  }

  // Related config files
  const configFiles = findRelatedConfigFiles(item.name, config);
  if (configFiles.length > 0) {
    lines.push(bold("RELATED CONFIG FILES"));
    for (const f of configFiles) {
      lines.push(`  ${f}`);
    }
    lines.push("");
  }
}

function buildInfrastructureDetails(
  item: StackItem,
  config: ProjectConfig,
  infraResources: InfraResource[],
  lines: string[],
): void {
  // Related config files
  const configFiles = findRelatedConfigFiles(item.name, config);
  if (configFiles.length > 0) {
    lines.push(bold("CONFIG FILES"));
    for (const f of configFiles) {
      lines.push(`  ${f}`);
    }
    lines.push("");
  }

  // Cross-reference live infrastructure data
  if (infraResources.length > 0) {
    const pods = infraResources.filter((r) => r.kind === "pod");
    const services = infraResources.filter((r) => r.kind === "service");
    const deployments = infraResources.filter(
      (r) => r.kind === "deployment" || r.kind === "statefulset" || r.kind === "daemonset",
    );
    const ingresses = infraResources.filter((r) => r.kind === "ingress");

    const parts: string[] = [];
    if (pods.length > 0) parts.push(`${pods.length} pod${pods.length > 1 ? "s" : ""}`);
    if (services.length > 0) parts.push(`${services.length} service${services.length > 1 ? "s" : ""}`);
    if (deployments.length > 0) parts.push(`${deployments.length} deployment${deployments.length > 1 ? "s" : ""}`);
    if (ingresses.length > 0) parts.push(`${ingresses.length} ingress${ingresses.length > 1 ? "es" : ""}`);

    if (parts.length > 0) {
      lines.push(bold("LIVE RESOURCES"));
      lines.push(`  ${parts.join(", ")}`);
      lines.push("");

      // Show resource names
      for (const r of infraResources.slice(0, 10)) {
        const statusColor = r.status === "healthy" ? ANSI.green
          : r.status === "degraded" ? ANSI.yellow
          : r.status === "unhealthy" ? ANSI.red
          : ANSI.dim;
        const icon = r.status === "healthy" ? "\u25CF"
          : r.status === "degraded" ? "\u25D0"
          : r.status === "unhealthy" ? "\u25CB"
          : "\u25CC";
        lines.push(`  ${color(statusColor, icon)} ${r.name} (${r.kind})`);
      }
      if (infraResources.length > 10) {
        lines.push(dim(`  ... ${infraResources.length - 10} more`));
      }
      lines.push("");
    }
  }
}

function buildPackageManagerDetails(
  _item: StackItem,
  config: ProjectConfig,
  lines: string[],
): void {
  // Show what languages/frameworks are managed
  if (config.stack.languages.length > 0) {
    lines.push(bold("LANGUAGES"));
    for (const lang of config.stack.languages) {
      const ver = lang.version ? dim(` v${lang.version}`) : "";
      lines.push(`  ${lang.name}${ver}`);
    }
    lines.push("");
  }
}

function buildVersionManagerDetails(
  _item: StackItem,
  config: ProjectConfig,
  lines: string[],
): void {
  // Show managed language versions
  if (config.stack.languages.length > 0) {
    lines.push(bold("MANAGED LANGUAGES"));
    for (const lang of config.stack.languages) {
      const ver = lang.version ? dim(` v${lang.version}`) : "";
      lines.push(`  ${lang.name}${ver}`);
    }
    lines.push("");
  }
}

function buildTestingDetails(
  config: ProjectConfig,
  lines: string[],
): void {
  if (config.testing) {
    if (config.testing.command) {
      lines.push(`${bold("Command:")} ${config.testing.command}`);
    }
    if (config.testing.testDir) {
      lines.push(`${bold("Test directory:")} ${config.testing.testDir}`);
    }
    lines.push("");
  }

  // Show linting tools alongside testing
  if (config.linting.length > 0) {
    lines.push(bold("LINTING"));
    for (const lint of config.linting) {
      lines.push(`  ${lint.name}  ${dim(lint.sourceFile)}`);
    }
    lines.push("");
  }
}

function buildServiceDetails(
  item: StackItem,
  config: ProjectConfig,
  lines: string[],
): void {
  const svc = config.services.find((s) => s.name === item.name);
  if (!svc) return;

  if (svc.command) {
    lines.push(`${bold("Command:")} ${svc.command}`);
  }
  if (svc.cwd) {
    lines.push(`${bold("Working dir:")} ${svc.cwd}`);
  }
  if (svc.dependsOn && svc.dependsOn.length > 0) {
    lines.push(`${bold("Depends on:")} ${svc.dependsOn.join(", ")}`);
  }
  if (svc.healthCheck) {
    const hc = svc.healthCheck;
    lines.push(`${bold("Health check:")} ${hc.strategy}${hc.httpPath ? ` ${hc.httpPath}` : ""}`);
  }
  if (svc.env && Object.keys(svc.env).length > 0) {
    lines.push("");
    lines.push(bold("ENVIRONMENT"));
    for (const [key, val] of Object.entries(svc.env)) {
      lines.push(`  ${key}=${dim(val)}`);
    }
  }
  lines.push("");
}

/** Find config files related to a stack item by name. */
function findRelatedConfigFiles(itemName: string, config: ProjectConfig): string[] {
  const files: string[] = [];
  const nameLower = itemName.toLowerCase();

  // Collect all source files from linting configs
  for (const lint of config.linting) {
    files.push(lint.sourceFile);
  }

  // Check common config file patterns based on the item name
  const allSourceFiles = new Set<string>();
  for (const lang of config.stack.languages) {
    if (lang.sourceFile) allSourceFiles.add(lang.sourceFile);
  }
  for (const fw of config.stack.frameworks) {
    if (fw.sourceFile) allSourceFiles.add(fw.sourceFile);
  }
  for (const pm of config.stack.packageManagers) {
    if (pm.sourceFile) allSourceFiles.add(pm.sourceFile);
  }
  for (const infra of config.stack.infrastructure) {
    if (infra.sourceFile) allSourceFiles.add(infra.sourceFile);
  }
  for (const vm of config.stack.versionManagers) {
    if (vm.sourceFile) allSourceFiles.add(vm.sourceFile);
  }

  // Return files that seem related to this item
  const related: string[] = [];
  for (const f of allSourceFiles) {
    const fLower = f.toLowerCase();
    if (fLower.includes(nameLower) || nameLower.includes(fLower.replace(/[^a-z]/g, ""))) {
      related.push(f);
    }
  }

  return related;
}

function categoryLabel(category: StackItemCategory): string {
  switch (category) {
    case "language": return "Language";
    case "framework": return "Framework";
    case "infrastructure": return "Infrastructure";
    case "package-manager": return "Package Manager";
    case "version-manager": return "Version Manager";
    case "testing": return "Testing";
    case "service": return "Service";
  }
}

// --- Scroll helpers ---

export function scrollUp(state: StackDetailState, amount: number): void {
  state.scrollOffset = Math.max(0, state.scrollOffset - amount);
}

export function scrollDown(state: StackDetailState, amount: number, viewHeight: number): void {
  const maxScroll = Math.max(0, state.totalLines - viewHeight);
  state.scrollOffset = Math.min(maxScroll, state.scrollOffset + amount);
}

export function scrollToTop(state: StackDetailState): void {
  state.scrollOffset = 0;
}

export function scrollToBottom(state: StackDetailState, viewHeight: number): void {
  state.scrollOffset = Math.max(0, state.totalLines - viewHeight);
}
