export type BreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetAfterMs: number;
  now?: () => number;
}

/** Per-route breaker: after N consecutive failures the route is skipped until resetAfterMs passes. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: BreakerState = 'closed';
  private readonly now: () => number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  get current(): BreakerState {
    if (this.state === 'open' && this.now() - this.openedAt >= this.opts.resetAfterMs) this.state = 'half-open';
    return this.state;
  }

  allows(): boolean {
    return this.current !== 'open';
  }

  success(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  failure(): void {
    this.failures++;
    if (this.state === 'half-open' || this.failures >= this.opts.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }
}

export class BreakerBank {
  private readonly breakers = new Map<string, CircuitBreaker>();
  constructor(private readonly opts: CircuitBreakerOptions) {}

  for(name: string): CircuitBreaker {
    let b = this.breakers.get(name);
    if (!b) {
      b = new CircuitBreaker(this.opts);
      this.breakers.set(name, b);
    }
    return b;
  }
}
