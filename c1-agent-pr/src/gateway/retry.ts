export interface RetryPolicyOptions {
  /** Total attempts per route, the first one included. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Decides whether an error is worth another attempt. Defaults to retrying everything: gateways are flaky. */
  retryOn?: (error: unknown) => boolean;
  jitter?: boolean;
}

export class RetryPolicy {
  constructor(private readonly opts: RetryPolicyOptions) {
    if (opts.maxAttempts < 1) throw new Error('maxAttempts must be >= 1');
  }

  get maxAttempts(): number {
    return this.opts.maxAttempts;
  }

  shouldRetry(error: unknown, attempt: number): boolean {
    if (attempt >= this.opts.maxAttempts) return false;
    return this.opts.retryOn ? this.opts.retryOn(error) : true;
  }

  delayFor(attempt: number): number {
    const exp = Math.min(this.opts.maxDelayMs, this.opts.baseDelayMs * 2 ** (attempt - 1));
    return this.opts.jitter ? Math.round(exp * (0.5 + Math.random() / 2)) : exp;
  }

  static fromRetries(retries: number, baseDelayMs = 0): RetryPolicy {
    return new RetryPolicy({ maxAttempts: retries + 1, baseDelayMs, maxDelayMs: 5_000 });
  }
}
