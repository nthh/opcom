import type {
  IntegrationModule,
  IntegrationCategory,
  IntegrationsConfig,
} from "@opcom/types";

export interface IntegrationInfo {
  id: string;
  category: IntegrationCategory;
  name: string;
  description: string;
  enabled: boolean;
}

/**
 * Registry of all available integration modules.
 * Station reads config and activates what's listed.
 */
export class IntegrationRegistry {
  private modules = new Map<string, IntegrationModule>();
  private active = new Set<string>();

  /** Register a module as available (does not enable it). */
  register(mod: IntegrationModule): void {
    this.modules.set(mod.id, mod);
  }

  /** Get a registered module by id. */
  get(id: string): IntegrationModule | undefined {
    return this.modules.get(id);
  }

  /** List all registered modules with their enabled status. */
  list(): IntegrationInfo[] {
    return Array.from(this.modules.values()).map((mod) => ({
      id: mod.id,
      category: mod.category,
      name: mod.name,
      description: mod.description,
      enabled: this.active.has(mod.id),
    }));
  }

  /** List modules filtered by category. */
  listByCategory(category: IntegrationCategory): IntegrationInfo[] {
    return this.list().filter((m) => m.category === category);
  }

  /** Check if a module is currently enabled. */
  isEnabled(id: string): boolean {
    return this.active.has(id);
  }

  /**
   * Initialize modules based on config. Only modules listed in the config
   * (or all if config is undefined) are activated.
   */
  async initFromConfig(
    config: IntegrationsConfig | undefined,
    moduleConfig?: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    const enabledIds = this.resolveEnabledIds(config);

    for (const id of enabledIds) {
      const mod = this.modules.get(id);
      if (!mod) continue;
      await mod.init(moduleConfig?.[id]);
      this.active.add(id);
    }
  }

  /** Enable a single module (init + mark active). */
  async enable(id: string, config?: Record<string, unknown>): Promise<void> {
    const mod = this.modules.get(id);
    if (!mod) {
      throw new Error(`Unknown integration: ${id}`);
    }
    if (this.active.has(id)) return; // already enabled
    await mod.init(config);
    this.active.add(id);
  }

  /** Disable a single module (teardown + mark inactive). */
  async disable(id: string): Promise<void> {
    const mod = this.modules.get(id);
    if (!mod) {
      throw new Error(`Unknown integration: ${id}`);
    }
    if (!this.active.has(id)) return; // already disabled
    await mod.teardown();
    this.active.delete(id);
  }

  /** Teardown all active modules. */
  async teardownAll(): Promise<void> {
    for (const id of this.active) {
      const mod = this.modules.get(id);
      if (mod) {
        await mod.teardown();
      }
    }
    this.active.clear();
  }

  /**
   * Build an IntegrationsConfig snapshot of currently enabled modules,
   * suitable for persisting to config.yaml.
   */
  toConfig(): IntegrationsConfig {
    const config: IntegrationsConfig = {};
    for (const mod of this.modules.values()) {
      if (!this.active.has(mod.id)) continue;
      const key = mod.category as keyof IntegrationsConfig;
      if (!config[key]) {
        config[key] = [];
      }
      config[key]!.push(mod.id);
    }
    return config;
  }

  /**
   * Resolve which module ids should be enabled.
   * If config is undefined, enable all registered modules (backwards compat).
   * If config has a category key, only those ids are enabled for that category.
   */
  private resolveEnabledIds(config: IntegrationsConfig | undefined): string[] {
    if (!config) {
      return Array.from(this.modules.keys());
    }

    const enabled: string[] = [];
    for (const mod of this.modules.values()) {
      const categoryList = config[mod.category as keyof IntegrationsConfig];
      if (categoryList === undefined) {
        // Category not specified in config — enable by default for backwards compat
        enabled.push(mod.id);
      } else if (Array.isArray(categoryList) && categoryList.includes(mod.id)) {
        enabled.push(mod.id);
      }
    }
    return enabled;
  }
}
