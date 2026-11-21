import { ProviderError } from '../types.ts';
import type { BreakerBank } from './circuit-breaker.ts';
import type { DeliveryLedger } from './dedup.ts';
import type { ProviderRegistry } from './registry.ts';
import type { RetryPolicy } from './retry.ts';
import type { DispatchContext, DispatchResult, GatewayHooks, OutgoingMessage } from './types.ts';

export interface DispatcherDeps {
  registry: ProviderRegistry;
  retry: RetryPolicy;
  breakers: BreakerBank;
  ledger: DeliveryLedger;
  timeoutMs: number;
  hooks?: GatewayHooks[];
  sleep?: (ms: number) => Promise<void>;
}

export class AllRoutesFailedError extends Error {
  constructor(readonly requestId: string, readonly causes: unknown[]) {
    super(`all SMS routes failed for ${requestId}: ${causes.map((c) => (c as Error)?.message ?? String(c)).join('; ')}`);
  }
}

/** Routes one message through the registry with retries, breakers, timeouts and a delivery ledger. */
export class Dispatcher {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: DispatcherDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private emit<K extends keyof GatewayHooks>(name: K, ...args: Parameters<NonNullable<GatewayHooks[K]>>): void {
    for (const h of this.deps.hooks ?? []) (h[name] as ((...a: unknown[]) => void) | undefined)?.call(h, ...args);
  }

  private async withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, label: string): Promise<T> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.deps.timeoutMs);
    try {
      return await run(ac.signal);
    } catch (e) {
      if (ac.signal.aborted) throw new ProviderError(`${label}: timeout after ${this.deps.timeoutMs} ms`, true);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async dispatch(message: OutgoingMessage, requestId: string): Promise<DispatchResult> {
    const cached = this.deps.ledger.get(requestId);
    if (cached) return cached;

    const started = Date.now();
    const causes: unknown[] = [];
    let attempts = 0;
    for (const route of this.deps.registry.select(message.to)) {
      const breaker = this.deps.breakers.for(route.provider.name);
      if (!breaker.allows()) continue;
      for (let attempt = 1; attempt <= this.deps.retry.maxAttempts; attempt++) {
        attempts++;
        const ctx: DispatchContext = { requestId, attempt, provider: route.provider.name, startedAt: Date.now() };
        this.emit('onAttempt', ctx);
        try {
          const r = await this.withTimeout(
            (signal) => route.provider.send({ ...message, idempotencyKey: `${requestId}:${route.provider.name}:${attempt}` }, signal),
            route.provider.name,
          );
          breaker.success();
          const result: DispatchResult = { provider: route.provider.name, id: r.id, attempts, durationMs: Date.now() - started };
          this.deps.ledger.record(requestId, result);
          this.emit('onSuccess', ctx, result);
          return result;
        } catch (e) {
          causes.push(e);
          breaker.failure();
          this.emit('onFailure', ctx, e);
          if (!this.deps.retry.shouldRetry(e, attempt)) break;
          await this.sleep(this.deps.retry.delayFor(attempt));
        }
      }
    }
    throw new AllRoutesFailedError(requestId, causes);
  }
}
