import type { SmsProvider } from '../types.ts';
import type { RegisteredProvider } from './types.ts';

export interface RegisterOptions {
  priority?: number;
  costPerSms?: number;
  prefixes?: string[];
  enabled?: boolean;
}

/**
 * Keeps the set of SMS routes and picks candidates for a destination.
 * Routes are ordered by cost first, then by priority, so the cheapest healthy route is tried first.
 */
export class ProviderRegistry {
  private readonly routes = new Map<string, RegisteredProvider>();

  register(provider: SmsProvider, opts: RegisterOptions = {}): this {
    if (this.routes.has(provider.name)) throw new Error(`provider ${provider.name} is already registered`);
    this.routes.set(provider.name, {
      provider,
      priority: opts.priority ?? this.routes.size,
      costPerSms: opts.costPerSms ?? 0,
      prefixes: opts.prefixes ?? [],
      enabled: opts.enabled ?? true,
    });
    return this;
  }

  disable(name: string): void {
    const r = this.routes.get(name);
    if (r) r.enabled = false;
  }

  enable(name: string): void {
    const r = this.routes.get(name);
    if (r) r.enabled = true;
  }

  get size(): number {
    return this.routes.size;
  }

  /** Candidates for a phone number, best first. */
  select(to: string): RegisteredProvider[] {
    return [...this.routes.values()]
      .filter((r) => r.enabled && (r.prefixes.length === 0 || r.prefixes.some((p) => to.startsWith(p))))
      .sort((a, b) => a.costPerSms - b.costPerSms || a.priority - b.priority);
  }
}
