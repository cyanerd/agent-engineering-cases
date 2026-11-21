import { alphaSms } from '../providers/alpha.ts';
import { betaSms } from '../providers/beta.ts';
import type { SmsProvider } from '../types.ts';
import { ProviderRegistry } from './registry.ts';

export interface RouteConfig {
  name: 'alpha-sms' | 'beta-sms';
  token: string;
  baseUrl?: string;
  costPerSms?: number;
  priority?: number;
  prefixes?: string[];
  enabled?: boolean;
}

/** SMS_ROUTES='[{"name":"alpha-sms","token":"...","costPerSms":120}, ...]' */
export function routesFromEnv(env: Record<string, string | undefined> = process.env): RouteConfig[] {
  const raw = env.SMS_ROUTES;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as RouteConfig[];
  if (!Array.isArray(parsed)) throw new Error('SMS_ROUTES must be a JSON array');
  return parsed;
}

const FACTORIES: Record<RouteConfig['name'], (token: string, baseUrl?: string) => SmsProvider> = {
  'alpha-sms': (t, u) => alphaSms(t, u),
  'beta-sms': (t, u) => betaSms(t, u),
};

export function buildRegistry(routes: RouteConfig[]): ProviderRegistry {
  const registry = new ProviderRegistry();
  routes.forEach((r, i) =>
    registry.register(FACTORIES[r.name](r.token, r.baseUrl), {
      priority: r.priority ?? i,
      costPerSms: r.costPerSms ?? 0,
      prefixes: r.prefixes ?? [],
      enabled: r.enabled ?? true,
    }),
  );
  return registry;
}
