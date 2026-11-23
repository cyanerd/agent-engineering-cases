import type { DispatchContext, DispatchResult, GatewayHooks } from './types.ts';

export interface RouteStats {
  attempts: number;
  successes: number;
  failures: number;
  totalMs: number;
}

/** In-process counters per route; exported as hooks for the dispatcher. */
export class GatewayMetrics implements GatewayHooks {
  readonly routes = new Map<string, RouteStats>();

  private stats(name: string): RouteStats {
    let s = this.routes.get(name);
    if (!s) {
      s = { attempts: 0, successes: 0, failures: 0, totalMs: 0 };
      this.routes.set(name, s);
    }
    return s;
  }

  onAttempt(ctx: DispatchContext): void {
    this.stats(ctx.provider).attempts++;
  }

  onSuccess(ctx: DispatchContext, result: DispatchResult): void {
    const s = this.stats(ctx.provider);
    s.successes++;
    s.totalMs += result.durationMs;
  }

  onFailure(ctx: DispatchContext): void {
    this.stats(ctx.provider).failures++;
  }

  snapshot(): Record<string, RouteStats> {
    return Object.fromEntries([...this.routes.entries()].map(([k, v]) => [k, { ...v }]));
  }
}
