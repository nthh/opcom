import type { StackInfo } from "@opcom/types";

/**
 * Merge multiple partial StackInfo objects, deduplicating by name.
 */
export function mergeStacks(...stacks: Partial<StackInfo>[]): StackInfo {
  const result: StackInfo = {
    languages: [],
    frameworks: [],
    packageManagers: [],
    infrastructure: [],
    versionManagers: [],
  };

  const seen = {
    languages: new Set<string>(),
    frameworks: new Set<string>(),
    packageManagers: new Set<string>(),
    infrastructure: new Set<string>(),
    versionManagers: new Set<string>(),
  };

  for (const stack of stacks) {
    for (const lang of stack.languages ?? []) {
      if (!seen.languages.has(lang.name)) {
        seen.languages.add(lang.name);
        result.languages.push(lang);
      } else if (lang.version) {
        // Update version if more specific
        const existing = result.languages.find((l) => l.name === lang.name);
        if (existing && !existing.version) {
          existing.version = lang.version;
        }
      }
    }

    for (const fw of stack.frameworks ?? []) {
      if (!seen.frameworks.has(fw.name)) {
        seen.frameworks.add(fw.name);
        result.frameworks.push(fw);
      }
    }

    for (const pm of stack.packageManagers ?? []) {
      if (!seen.packageManagers.has(pm.name)) {
        seen.packageManagers.add(pm.name);
        result.packageManagers.push(pm);
      }
    }

    for (const infra of stack.infrastructure ?? []) {
      if (!seen.infrastructure.has(infra.name)) {
        seen.infrastructure.add(infra.name);
        result.infrastructure.push(infra);
      }
    }

    for (const vm of stack.versionManagers ?? []) {
      if (!seen.versionManagers.has(vm.name)) {
        seen.versionManagers.add(vm.name);
        result.versionManagers.push(vm);
      }
    }
  }

  return result;
}
