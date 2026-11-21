import { BreakerBank } from './gateway/circuit-breaker.ts';
import { DeliveryLedger } from './gateway/dedup.ts';
import { Dispatcher } from './gateway/dispatcher.ts';
import { GatewayMetrics } from './gateway/metrics.ts';
import { ProviderRegistry } from './gateway/registry.ts';
import { RetryPolicy } from './gateway/retry.ts';
import type { SendResult, SmsProvider } from './types.ts';

export interface SenderOptions {
  providers: SmsProvider[];
  retries: number;
  timeoutMs: number;
  /** Optional per-provider SMS price; cheaper routes are tried first. */
  costs?: Record<string, number>;
}

/** Facade kept for existing callers; the work is done by the gateway (registry, retries, breakers, ledger). */
export function createCodeSender(opts: SenderOptions) {
  const registry = new ProviderRegistry();
  opts.providers.forEach((p, i) => registry.register(p, { priority: i, costPerSms: opts.costs?.[p.name] ?? 0 }));
  const metrics = new GatewayMetrics();
  const dispatcher = new Dispatcher({
    registry,
    retry: RetryPolicy.fromRetries(opts.retries),
    breakers: new BreakerBank({ failureThreshold: 5, resetAfterMs: 30_000 }),
    ledger: new DeliveryLedger(),
    timeoutMs: opts.timeoutMs,
    hooks: [metrics],
  });
  return {
    async sendCode(to: string, code: string, requestId: string): Promise<SendResult> {
      const r = await dispatcher.dispatch({ to, text: `Код входа: ${code}. Никому его не сообщайте.` }, requestId);
      return { provider: r.provider, id: r.id };
    },
    metrics: () => metrics.snapshot(),
  };
}
